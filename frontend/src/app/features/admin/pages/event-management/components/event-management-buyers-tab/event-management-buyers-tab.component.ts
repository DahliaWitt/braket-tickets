import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {
  type EventManagementPurchase,
  type Guest,
  type ImportedTicketHolder,
} from '@/features/admin/models/event-management.model';
import {TicketReminderTabComponent} from '@/features/admin/components/ticket-reminder-tab/ticket-reminder-tab.component';
import {EventManagementPurchasesPanelComponent} from '../event-management-purchases-panel/event-management-purchases-panel.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';
import {BUYER_IMPORT_CONFIG} from '@/features/admin/import/import-config';
// Import the surface directly (not via the barrel) so @defer can code-split it:
// a barrel that also exports the eagerly-used config keeps the component eager.
import {ImportSurfaceComponent} from '@/features/admin/import/import-surface.component';
import type {
  ImportConfirmPayload,
  ImportReport,
} from '@/features/admin/import/import-surface.types';
import {buildImportErrorReport, buildImportReport} from '../import-report.util';

@Component({
  selector: 'app-event-management-buyers-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TicketReminderTabComponent,
    EventManagementPurchasesPanelComponent,
    ImportSurfaceComponent,
    ZardButtonComponent,
    ZardIconComponent,
  ],
  templateUrl: './event-management-buyers-tab.component.html',
})
export class EventManagementBuyersTabComponent {
  private readonly adminEventsService = inject(AdminEventsService);

  readonly eventId = input.required<string>();
  readonly communityId = input.required<string>();
  readonly eventTitle = input.required<string>();
  readonly eventDate = input.required<string>();
  readonly purchases = input.required<EventManagementPurchase[]>();
  readonly guests = input<Guest[]>([]);
  readonly importedEntries = input<ImportedTicketHolder[]>([]);
  readonly reloadToken = input(0);
  readonly dataChanged = output<void>();

  /** Config for the shared import surface (buyer / external-ticket target). */
  readonly buyerImportConfig = BUYER_IMPORT_CONFIG;

  /** Whether the import surface is open (lazily rendered via @defer). */
  readonly isImporting = signal(false);

  /** Server report fed back to the surface after the import mutation returns. */
  readonly importReport = signal<ImportReport | null>(null);

  /**
   * Strong dedup keys (external reference / barcode, lowercased) already
   * imported for this event, matching `BUYER_IMPORT_CONFIG.dedupKey`. Feeds the
   * preview's auto-skip duplicate hints from the live imported-entries query.
   */
  readonly existingStrongKeys = computed<ReadonlySet<string>>(() => {
    const keys = new Set<string>();
    for (const entry of this.importedEntries()) {
      // Derive through the config so preview hints can't drift from the
      // surface's within-batch dedup.
      const key = BUYER_IMPORT_CONFIG.dedupKey({
        name: entry.name,
        externalRef: entry.externalRef,
      });
      if (key !== null) keys.add(key);
    }
    return keys;
  });

  /**
   * Weak dedup keys (name+email, lowercased) for barcode-less rows, matching
   * `BUYER_IMPORT_CONFIG.weakDedupKey`. Only produces "possible duplicate"
   * hints — never auto-skips.
   */
  readonly existingWeakKeys = computed<ReadonlySet<string>>(() => {
    const keys = new Set<string>();
    for (const entry of this.importedEntries()) {
      const key = BUYER_IMPORT_CONFIG.weakDedupKey?.({
        name: entry.name,
        email: entry.email,
      });
      if (key != null) keys.add(key);
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

  async onTicketImportConfirmed(payload: ImportConfirmPayload): Promise<void> {
    try {
      const result = await this.adminEventsService.importTicketBatch(
        this.eventId(),
        payload.batchKey,
        payload.dedupMode,
        payload.rows.map((row) => ({
          name: row.name,
          email: row.email,
          externalRef: row.externalRef,
          orderRef: row.orderRef,
          ticketTypeLabel: row.ticketTypeLabel,
          purchaseDateRaw: row.purchaseDateRaw,
        })),
        payload.sourceLabel,
      );
      this.importReport.set(buildImportReport(result));
      if (result.insertedCount > 0) {
        // The management purchases view is a non-reactive action — refetch it
        // (and the reactive imported-entries query) so the merged list updates.
        this.dataChanged.emit();
      }
    } catch (error) {
      // Route through the central PII-scrubbing logger — never log row values.
      logger.error('Failed to import external tickets', error);
      this.importReport.set(
        buildImportErrorReport(
          error,
          "couldn't import those tickets — try again in a bit",
        ),
      );
    }
  }
}
