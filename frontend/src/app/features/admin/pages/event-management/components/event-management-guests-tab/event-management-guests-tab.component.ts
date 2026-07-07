import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
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
import {GUEST_IMPORT_CONFIG} from '@/features/admin/import/import-config';
// Import the surface directly (not via the barrel) so @defer can code-split it:
// a barrel that also exports the eagerly-used config keeps the component eager.
import {ImportSurfaceComponent} from '@/features/admin/import/import-surface.component';
import type {
  ImportConfirmPayload,
  ImportReport,
} from '@/features/admin/import/import-surface.types';
import {buildImportErrorReport, buildImportReport} from '../import-report.util';

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
    ImportSurfaceComponent,
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

  readonly isGeneratingGuestPdf = signal<string | null>(null);
  readonly isSendingTicket = signal<string | null>(null);

  /** Config for the shared import surface (guest target). */
  readonly guestImportConfig = GUEST_IMPORT_CONFIG;

  /** Whether the bulk-import surface is open (lazily rendered via @defer). */
  readonly isImporting = signal(false);

  /** Server report fed back to the surface after the bulk mutation returns. */
  readonly importReport = signal<ImportReport | null>(null);

  /**
   * Strong dedup keys (name+email, lowercased) for the current guest list,
   * matching `GUEST_IMPORT_CONFIG.dedupKey`. Feeds the preview's duplicate
   * hints from the live guest subscription. The server re-checks at commit.
   */
  readonly existingGuestKeys = computed<ReadonlySet<string>>(() => {
    const keys = new Set<string>();
    for (const guest of this.guests()) {
      // Derive the key through the config so the tab's preview hints can never
      // drift from the surface's within-batch dedup.
      const key = GUEST_IMPORT_CONFIG.dedupKey({
        name: guest.name,
        email: guest.email,
      });
      if (key !== null) keys.add(key);
    }
    return keys;
  });

  openImportSurface(): void {
    this.importReport.set(null);
    this.isImporting.set(true);
  }

  closeImportSurface(): void {
    this.isImporting.set(false);
    this.importReport.set(null);
  }

  async onGuestImportConfirmed(payload: ImportConfirmPayload): Promise<void> {
    try {
      const result = await this.adminEventsService.bulkAddGuests(
        this.eventId(),
        payload.batchKey,
        payload.rows.map((row) => ({
          name: row.name,
          email: row.email,
          type: row.guestType,
          notes: row.notes,
        })),
      );
      this.importReport.set(buildImportReport(result));
      if (result.insertedCount > 0) {
        this.dataChanged.emit();
      }
    } catch (error) {
      // Route through the central PII-scrubbing logger — never log row values.
      logger.error('Failed to bulk add guests', error);
      this.importReport.set(
        buildImportErrorReport(
          error,
          "couldn't add those guests — try again in a bit",
        ),
      );
    }
  }

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
    if (this.isSendingTicket()) return;

    this.isSendingTicket.set(guestId);
    try {
      await this.adminEventsService.sendGuestTicket(guestId);
      toast.success('Ticket sent successfully');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to send guest ticket', error);
      toast.error('Failed to send guest ticket');
    } finally {
      this.isSendingTicket.set(null);
    }
  }

  async downloadGuestTicket(guestId: string): Promise<void> {
    if (this.isGeneratingGuestPdf()) return;

    this.isGeneratingGuestPdf.set(guestId);
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
      this.isGeneratingGuestPdf.set(null);
    }
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
