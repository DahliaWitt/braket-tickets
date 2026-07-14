import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
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
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
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

/** Max guest ticket sends dispatched at once by "Send All". */
const SEND_ALL_CONCURRENCY = 8;

/**
 * Runs `worker` over `items` with at most `limit` in flight at a time, returning
 * results in input order. `worker` is expected to swallow its own errors (this
 * pool does not) so one failure never rejects the whole batch.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    {length: Math.min(limit, items.length)},
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

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
    EmptyStateComponent,
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
  private readonly alertDialog = inject(BraAlertDialogService);
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
      toast.success('guest added');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to add guest', error);
      toast.error('failed to add guest');
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
      toast.success('guest updated');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to update guest', error);
      toast.error('failed to update guest');
    }
  }

  removeGuest(guest: Guest): void {
    const name = guest.name || guest.email || 'this guest';
    this.alertDialog.confirm({
      zTitle: 'remove guest',
      zDescription: `remove ${name} from the guest list? their ticket stops working. this can't be undone.`,
      zOkText: 'remove guest',
      zCancelText: 'keep them',
      zOkDestructive: true,
      zMaskClosable: false,
      // Returning the promise lets tests (and future callers) await the work.
      zOnOk: () => this.performRemoveGuest(guest._id),
    });
  }

  private async performRemoveGuest(guestId: string): Promise<void> {
    try {
      await this.adminEventsService.removeGuest(guestId);
      if (this.destroyRef.destroyed) return;
      toast.success('guest removed');
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to remove guest', error);
      if (this.destroyRef.destroyed) return;
      toast.error('failed to remove guest');
    }
  }

  async sendGuestTicket(guestId: string): Promise<void> {
    if (this.sendingTicketIds().has(guestId)) return;

    // Single send is a deliberate (re)send, so it does not skip already-emailed
    // guests — but the backend still dedupes it against concurrent in-flight
    // sends, which surfaces here as 'skipped'.
    const outcome = await this.dispatchSendTicket(guestId, false);
    if (this.destroyRef.destroyed) return;
    if (outcome === 'sent') {
      toast.success('ticket sent');
      this.dataChanged.emit();
    } else if (outcome === 'skipped') {
      toast.info('this ticket is already being sent');
    } else {
      toast.error('failed to send guest ticket');
    }
  }

  sendAllTickets(): void {
    if (this.isSendingAll()) return;

    const targets = this.pendingSendGuests().filter(
      (guest) => !this.sendingTicketIds().has(guest._id),
    );
    if (targets.length === 0) return;

    const noun = targets.length === 1 ? 'guest' : 'guests';
    this.alertDialog.confirm({
      zTitle: 'send all tickets',
      zDescription: `email tickets to ${targets.length} ${noun} who haven't received one yet?`,
      zOkText: `send ${targets.length === 1 ? 'ticket' : 'tickets'}`,
      zCancelText: 'not yet',
      zMaskClosable: false,
      // Returning the promise lets tests (and future callers) await the batch.
      zOnOk: () => this.performSendAllTickets(targets),
    });
  }

  private async performSendAllTickets(
    targets: readonly Guest[],
  ): Promise<void> {
    if (this.isSendingAll()) return;

    this.isSendingAll.set(true);
    try {
      // Batch mode skips guests already emailed, enforced atomically on the
      // backend so a stale roster cannot re-email guests another admin handled.
      // Cap in-flight sends: each is a Convex action that generates a PDF and
      // hits Resend, so an unbounded fan-out over a large roster would pile up
      // action concurrency and provider rate limits.
      const outcomes = await mapWithConcurrency(
        targets,
        SEND_ALL_CONCURRENCY,
        (guest) => this.dispatchSendTicket(guest._id, true),
      );
      const sent = outcomes.filter((outcome) => outcome === 'sent').length;
      const skipped = outcomes.filter(
        (outcome) => outcome === 'skipped',
      ).length;
      const failed = outcomes.filter((outcome) => outcome === 'failed').length;
      if (sent > 0) {
        toast.success(`sent ${sent} ticket${sent === 1 ? '' : 's'}`);
      }
      if (skipped > 0) {
        toast.info(
          `skipped ${skipped} already-sent guest${skipped === 1 ? '' : 's'}`,
        );
      }
      if (failed > 0) {
        toast.error(
          `failed to send ${failed} ticket${failed === 1 ? '' : 's'}`,
        );
      }
      // Reconcile the roster whenever server state advanced — sends we made or
      // sends a concurrent admin already made (surfaced as skips).
      if (sent > 0 || skipped > 0) {
        this.dataChanged.emit();
      }
    } finally {
      this.isSendingAll.set(false);
    }
  }

  private async dispatchSendTicket(
    guestId: string,
    skipIfAlreadyEmailed: boolean,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    this.updateIdSet(this.sendingTicketIds, guestId, true);
    try {
      const result = await this.adminEventsService.sendGuestTicket(guestId, {
        skipIfAlreadyEmailed,
      });
      return result.status;
    } catch (error) {
      logger.error('Failed to send guest ticket', error);
      return 'failed';
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
      toast.success('guest ticket download started');
    } catch (error) {
      logger.error('Failed to download guest ticket', error);
      toast.error('failed to download guest ticket');
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
