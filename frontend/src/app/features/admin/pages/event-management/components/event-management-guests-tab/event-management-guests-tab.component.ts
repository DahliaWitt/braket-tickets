import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
  type WritableSignal,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {toast} from 'ngx-sonner';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {type Guest} from '@/features/admin/models/event-management.model';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  AddGuestDialogComponent,
  type AddGuestDialogResult,
} from '../add-guest-dialog/add-guest-dialog.component';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {logger} from '@/utils/logger';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';

function pdfDataUrlToBlob(dataUrl: string): Blob {
  const [metadata, base64] = dataUrl.split(',');
  if (!metadata?.startsWith('data:application/pdf;base64') || !base64) {
    throw new Error('Invalid PDF data URL');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {type: 'application/pdf'});
}

function isAddGuestDialogResult(value: unknown): value is AddGuestDialogResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    (candidate.email === undefined || typeof candidate.email === 'string') &&
    (candidate.notes === undefined || typeof candidate.notes === 'string') &&
    (candidate.type === 'guest' ||
      candidate.type === 'artist guest' ||
      candidate.type === 'staff')
  );
}

@Component({
  selector: 'app-event-management-guests-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BraStatusBadgeComponent,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    ZardTooltipDirective,
  ],
  templateUrl: './event-management-guests-tab.component.html',
})
export class EventManagementGuestsTabComponent {
  private readonly adminEventsService = inject(AdminEventsService);
  private readonly dialogService = inject(BraDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = inject(BrowserPlatformService);

  readonly eventId = input.required<string>();
  readonly guests = input<Guest[]>([]);
  readonly isLoading = input(false);
  readonly dataChanged = output<void>();

  readonly generatingPdfIds = signal<ReadonlySet<string>>(new Set());
  readonly sendingTicketIds = signal<ReadonlySet<string>>(new Set());
  readonly isSendingAll = signal(false);

  readonly pendingSendGuests = computed(() =>
    this.guests().filter((guest) => guest.email && !guest.emailedAt),
  );

  guestActionLabel(guest: Guest): string {
    const name = guest.name || guest.email || 'guest';
    const email = guest.email && guest.email !== name ? `, ${guest.email}` : '';
    return `${name}${email}, ${guest.type}, id ${this.idSuffix(guest._id)}`;
  }

  openAddGuestDialog(): void {
    const dialogRef = this.dialogService.create({
      zTitle: 'Add Guest',
      zDescription: 'Add a new guest to the guest list',
      zContent: AddGuestDialogComponent,
      zData: {eventId: this.eventId()},
      zHideFooter: true,
      zWidth: '420px',
    });

    dialogRef.afterClosed$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        void this.handleGuestDialogClose(result);
      });
  }

  private async handleGuestDialogClose(result: unknown): Promise<void> {
    if (!isAddGuestDialogResult(result)) {
      return;
    }

    try {
      await this.adminEventsService.addGuest(this.eventId(), result);
      toast.success('Guest added');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to add guest', error);
      toast.error('Failed to add guest');
    }
  }

  editGuest(guest: Guest): void {
    const dialogRef = this.dialogService.create({
      zTitle: 'Edit Guest',
      zDescription: "Update this guest's details",
      zContent: AddGuestDialogComponent,
      zData: {
        eventId: this.eventId(),
        guest: {
          name: guest.name,
          email: guest.email,
          type: guest.type,
          notes: guest.notes,
        },
      },
      zHideFooter: true,
      zWidth: '420px',
    });

    dialogRef.afterClosed$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        void this.handleEditGuestDialogClose(guest._id, result);
      });
  }

  private async handleEditGuestDialogClose(
    guestId: string,
    result: unknown,
  ): Promise<void> {
    if (!isAddGuestDialogResult(result)) {
      return;
    }

    try {
      await this.adminEventsService.updateGuest(guestId, result);
      toast.success('Guest updated');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to update guest', error);
      toast.error('Failed to update guest');
    }
  }

  async removeGuest(guestId: string): Promise<void> {
    if (!confirm('Are you sure you want to remove this guest?')) return;

    try {
      await this.adminEventsService.removeGuest(guestId);
      toast.success('Guest removed');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to remove guest', error);
      toast.error('Failed to remove guest');
    }
  }

  async sendGuestTicket(guestId: string): Promise<void> {
    if (this.sendingTicketIds().has(guestId)) return;

    const sent = await this.dispatchSendTicket(guestId);
    if (sent) {
      toast.success('Ticket sent successfully');
      this.dataChanged.emit();
    } else {
      toast.error('Failed to send guest ticket');
    }
  }

  async sendAllTickets(): Promise<void> {
    if (this.isSendingAll()) return;

    const targets = this.pendingSendGuests().filter(
      (guest) => !this.sendingTicketIds().has(guest._id),
    );
    if (targets.length === 0) return;

    const noun = targets.length === 1 ? 'guest' : 'guests';
    if (!confirm(`Send tickets to ${targets.length} ${noun}?`)) return;

    this.isSendingAll.set(true);
    try {
      const results = await Promise.all(
        targets.map((guest) => this.dispatchSendTicket(guest._id)),
      );
      const sent = results.filter(Boolean).length;
      const failed = results.length - sent;
      if (sent > 0) {
        toast.success(`Sent ${sent} ticket${sent === 1 ? '' : 's'}`);
        this.dataChanged.emit();
      }
      if (failed > 0) {
        toast.error(
          `Failed to send ${failed} ticket${failed === 1 ? '' : 's'}`,
        );
      }
    } finally {
      this.isSendingAll.set(false);
    }
  }

  private async dispatchSendTicket(guestId: string): Promise<boolean> {
    this.updateIdSet(this.sendingTicketIds, guestId, true);
    try {
      await this.adminEventsService.sendGuestTicket(guestId);
      return true;
    } catch (error) {
      logger.error('Failed to send guest ticket', error);
      return false;
    } finally {
      this.updateIdSet(this.sendingTicketIds, guestId, false);
    }
  }

  async downloadGuestTicket(guestId: string): Promise<void> {
    if (this.generatingPdfIds().has(guestId)) return;

    this.updateIdSet(this.generatingPdfIds, guestId, true);
    try {
      const pdfDataUrl =
        await this.adminEventsService.getGuestTicketPdf(guestId);
      this.browser.downloadBlob(
        pdfDataUrlToBlob(pdfDataUrl),
        `guest-ticket-${guestId}.pdf`,
      );
      toast.success('Guest ticket download started.');
    } catch (error) {
      logger.error('Failed to download guest ticket', error);
      toast.error('Failed to download guest ticket.');
    } finally {
      this.updateIdSet(this.generatingPdfIds, guestId, false);
    }
  }

  private updateIdSet(
    idSet: WritableSignal<ReadonlySet<string>>,
    id: string,
    present: boolean,
  ): void {
    idSet.update((ids) => {
      const next = new Set(ids);
      if (present) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
