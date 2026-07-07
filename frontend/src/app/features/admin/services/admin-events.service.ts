import {Injectable} from '@angular/core';
import {ConvexError} from 'convex/values';
import {injectConvex} from 'convex-angular';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {api} from '@convex/_generated/api';
import {type Doc, type Id} from '@convex/_generated/dataModel';
import {
  type EventManagementPurchases,
  type EventManagementResale,
  type EventManagementSummary,
  type EventTierPricingStats,
  type Guest,
  type GuestType,
  type ImportBatchResult,
  type ImportBatchRemovalResult,
  type ImportedTicketHolder,
  type TicketReminderAudience,
  type TicketReminderSendResult,
} from '../models/event-management.model';

// Argument shapes are pulled straight from the generated API so the frontend
// stays locked to the backend contract (never redefine bulk-import rows).
type BulkAddGuestsArgs = FunctionArgs<typeof api.events.guests.addMany>;
type ImportTicketBatchArgs = FunctionArgs<
  typeof api.events.imported_tickets.importBatch
>;
export type BulkGuestRow = BulkAddGuestsArgs['rows'][number];
export type ImportTicketRow = ImportTicketBatchArgs['rows'][number];
import {isManagementDataTooLargeError} from '../utils/management-data-errors';
import {isNonRetryableReadError, retryWithDelays} from '@/utils/async-control';

export type TicketSalesStatus = NonNullable<Doc<'events'>['ticketSalesStatus']>;

const MANAGEMENT_READ_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;
const TICKET_SALES_STATUS_RETRY_DELAYS_MS = [0, 300, 900] as const;

interface ManagementSurface {
  event: {
    _id: Id<'events'>;
  };
}

type ManagementSurfaceWithEventId<T extends ManagementSurface> = Omit<
  T,
  'event'
> & {
  event: T['event'] & {id: Id<'events'>};
};

function isNonRetryableManagementError(error: unknown): boolean {
  return (
    isNonRetryableReadError(error) ||
    (error instanceof ConvexError && isManagementDataTooLargeError(error))
  );
}

/**
 * Service for admin-only event management operations.
 *
 * Provides methods for managing events, guests, ticket sales, and PDF generation.
 * All methods require admin authentication.
 */
@Injectable({
  providedIn: 'root',
})
export class AdminEventsService {
  private convex = injectConvex();

  private async readManagementSurface<T extends ManagementSurface>(
    run: () => Promise<T>,
  ): Promise<ManagementSurfaceWithEventId<T>> {
    const data = await retryWithDelays({
      delaysMs: MANAGEMENT_READ_RETRY_DELAYS_MS,
      run,
      shouldRetry: (error, attemptIndex) => {
        if (isNonRetryableManagementError(error)) return false;
        return attemptIndex < MANAGEMENT_READ_RETRY_DELAYS_MS.length - 1;
      },
    });

    return {
      ...data,
      event: {
        ...data.event,
        id: data.event._id,
      },
    };
  }

  /**
   * Fetches the summary/check-in surface for the admin event management page.
   *
   * All three management surfaces (summary, purchases, resale) are actions that
   * write an `event.management.view` audit log before returning data. Retries
   * transient errors but never `ArgumentValidationError` or
   * `MANAGEMENT_DATA_TOO_LARGE` (non-retryable).
   *
   * @param eventId - The ID of the event to fetch summary data for.
   */
  async getManagementSummary(eventId: string): Promise<EventManagementSummary> {
    return this.readManagementSurface(() =>
      this.convex.action(api.events.management.getManagementSummary, {
        eventId: eventId as Id<'events'>,
      }),
    );
  }

  /**
   * Fetches the purchases surface for the admin event management page.
   *
   * Action covering completed orders with financial summaries, ticket
   * summaries, and buyer fields. Writes an `event.management.view` audit log.
   * Bounded by the per-surface dataset limit — throws
   * `MANAGEMENT_DATA_TOO_LARGE` when exceeded.
   */
  async getManagementPurchases(
    eventId: string,
  ): Promise<EventManagementPurchases> {
    return this.readManagementSurface(() =>
      this.convex.action(api.events.management.getManagementPurchases, {
        eventId: eventId as Id<'events'>,
      }),
    );
  }

  /**
   * Fetches the resale surface for the admin event management page.
   *
   * Action covering resale listings, resale metrics, and the resale
   * notification subscriber count. Writes an `event.management.view` audit log.
   * Bounded by the per-surface dataset limit — throws
   * `MANAGEMENT_DATA_TOO_LARGE` when exceeded.
   */
  async getManagementResale(eventId: string): Promise<EventManagementResale> {
    return this.readManagementSurface(() =>
      this.convex.action(api.events.management.getManagementResale, {
        eventId: eventId as Id<'events'>,
      }),
    );
  }

  /**
   * Fetches exact tier pricing stats for a sliding-scale event.
   *
   * This is loaded on demand via `resource()` rather than a live subscription
   * because the backend computes it from the canonical order ledger.
   */
  getTierPricingStats(eventId: string): Promise<EventTierPricingStats> {
    return this.convex.query(api.events.pricing.getEventTierPricingStats, {
      eventId: eventId as Id<'events'>,
    });
  }

  /**
   * Fetches a preview of the reminder audience for vetted/approved users who
   * have not purchased a ticket for this event.
   */
  getTicketReminderAudience(eventId: string): Promise<TicketReminderAudience> {
    return this.convex.query(api.events.reminders.getTicketReminderAudience, {
      eventId: eventId as Id<'events'>,
    });
  }

  /**
   * Sends a custom reminder email to vetted/approved users who have not
   * purchased a ticket for this event.
   */
  sendTicketPurchaseReminder(
    eventId: string,
    subject: string,
    message: string,
  ): Promise<TicketReminderSendResult> {
    return this.convex.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId: eventId as Id<'events'>,
        subject,
        message,
      },
    );
  }

  /**
   * Updates the ticket sales status for an event.
   *
   * Allows admins to control ticket availability by pausing, resuming, or
   * permanently ending sales for an event.
   *
   * @param eventId - The ID of the event to update.
   * @param status - The new sales status: 'active', 'paused', or 'ended'.
   *
   * @remarks
   * Side effects:
   * - 'paused' prevents new reservations but existing purchases remain valid
   * - 'ended' permanently closes sales (cannot be reversed to 'active')
   */
  updateTicketSalesStatus(
    eventId: string,
    status: TicketSalesStatus,
  ): Promise<void> {
    return retryWithDelays({
      delaysMs: TICKET_SALES_STATUS_RETRY_DELAYS_MS,
      run: async () => {
        await this.convex.mutation(api.events.management.update, {
          id: eventId as Id<'events'>,
          ticketSalesStatus: status,
        });
      },
      shouldRetry: (_error, attemptIndex) =>
        attemptIndex < TICKET_SALES_STATUS_RETRY_DELAYS_MS.length - 1,
    });
  }

  /**
   * Updates resale settings for an event.
   *
   * Allows admins to enable/disable resale and adjust the resale fee percentage.
   *
   * @param eventId - The ID of the event to update.
   * @param settings - Resale settings to apply.
   */
  async updateResaleSettings(
    eventId: string,
    settings: {resaleEnabled?: boolean; resaleFeePct?: number},
  ): Promise<void> {
    await this.convex.mutation(api.events.management.update, {
      id: eventId as Id<'events'>,
      ...settings,
    });
  }

  /**
   * Refunds the refundable portion of an order.
   *
   * Uses the standard refund flow, which refunds only unused tickets when a
   * paid order contains a mix of valid and used tickets.
   *
   * @param orderId - The ID of the order to refund.
   * @returns Whether the refund succeeded.
   */
  async refundPayment(orderId: string): Promise<boolean> {
    const result = await this.convex.action(api.payments.refunds.refund, {
      orderId: orderId as Id<'ticket_orders'>,
    });
    return result.success;
  }

  /**
   * Refunds one ticket from a multi-ticket order.
   *
   * Uses the admin-only backend action that computes the proportional
   * per-ticket amount and marks only the selected ticket as refunded.
   *
   * @param ticketId - The ID of the ticket to refund.
   * @returns Whether the single-ticket refund succeeded.
   */
  async refundTicket(ticketId: string): Promise<boolean> {
    const result = await this.convex.action(api.payments.refunds.refundTicket, {
      ticketId: ticketId as Id<'tickets'>,
    });
    return result.success;
  }

  /**
   * Force-refunds the full order amount and marks every ticket as refunded.
   *
   * This admin-only path is intended for exceptional cases where used tickets
   * must also be invalidated and refunded.
   *
   * @param orderId - The ID of the order to fully refund.
   * @returns Whether the force refund succeeded.
   */
  async forceRefundAll(orderId: string): Promise<boolean> {
    const result = await this.convex.action(
      api.payments.refunds.forceRefundAll,
      {
        orderId: orderId as Id<'ticket_orders'>,
      },
    );
    return result.success;
  }

  /**
   * Fetches all guests for an event.
   *
   * @param eventId - The ID of the event to fetch guests for.
   * @returns Array of guest records for the event.
   */
  getGuests(eventId: string): Promise<Guest[]> {
    return retryWithDelays({
      delaysMs: MANAGEMENT_READ_RETRY_DELAYS_MS,
      run: () =>
        this.convex.query(api.events.guests.listByEvent, {
          eventId: eventId as Id<'events'>,
        }),
      shouldRetry: (_error, attemptIndex) =>
        attemptIndex < MANAGEMENT_READ_RETRY_DELAYS_MS.length - 1,
    });
  }

  /**
   * Adds a guest to an event's guest list.
   *
   * Creates a new guest record for complimentary admission or VIP access.
   * Guests bypass the normal ticket purchase flow.
   *
   * @param eventId - The ID of the event to add the guest to.
   * @param guest - Guest details including name, optional email, type, and notes.
   * @param guest.name - Full name of the guest.
   * @param guest.email - Optional email for sending guest ticket.
   * @param guest.type - Guest type (e.g., 'comp', 'vip', 'performer').
   * @param guest.notes - Optional internal notes about the guest.
   * @returns The ID of the newly created guest record.
   */
  addGuest(
    eventId: string,
    guest: {name: string; email?: string; type: GuestType; notes?: string},
  ): Promise<FunctionReturnType<typeof api.events.guests.add>> {
    return this.convex.mutation(api.events.guests.add, {
      eventId: eventId as Id<'events'>,
      ...guest,
    });
  }

  /**
   * Updates an existing guest's name, email, type, and notes.
   *
   * `eventId` is not editable, and check-in/email metadata is preserved
   * server-side regardless of what is submitted here.
   *
   * @param guestId - The ID of the guest record to update.
   * @param guest - Updated guest details including name, optional email, type, and notes.
   * @param guest.name - Full name of the guest.
   * @param guest.email - Optional email for sending guest ticket.
   * @param guest.type - Guest type (e.g., 'guest', 'artist guest', 'staff').
   * @param guest.notes - Optional internal notes about the guest.
   */
  updateGuest(
    guestId: string,
    guest: {name: string; email?: string; type: GuestType; notes?: string},
  ): Promise<FunctionReturnType<typeof api.events.guests.update>> {
    return this.convex.mutation(api.events.guests.update, {
      id: guestId as Id<'guests'>,
      ...guest,
    });
  }

  /**
   * Removes a guest from an event's guest list.
   *
   * @param guestId - The ID of the guest record to remove.
   */
  async removeGuest(guestId: string): Promise<void> {
    await this.convex.mutation(api.events.guests.remove, {
      id: guestId as Id<'guests'>,
    });
  }

  /**
   * Bulk-adds guests from a validated CSV/paste import.
   *
   * One transaction — subscribers see a single invalidation, not one per row.
   * Idempotent under retry via `batchKey`. Returns the server-authoritative
   * structured result (inserted/skipped counts + per-row outcomes).
   *
   * @param eventId - The event to add guests to.
   * @param batchKey - Client-generated idempotency key for the import.
   * @param rows - Normalized guest rows (name required; email/type/notes optional).
   */
  bulkAddGuests(
    eventId: string,
    batchKey: string,
    rows: BulkGuestRow[],
  ): Promise<ImportBatchResult> {
    return this.convex.mutation(api.events.guests.addMany, {
      eventId: eventId as Id<'events'>,
      batchKey,
      rows,
    });
  }

  /**
   * Imports a batch of external ticket holders (e.g. an RA export).
   *
   * Imported entries are a distinct, inert record type — never a purchase.
   * One transaction, idempotent under retry via `batchKey`. `dedupMode`
   * controls barcode dedup against prior imports; `sourceLabel` attributes the
   * batch. Returns the server-authoritative structured result.
   */
  importTicketBatch(
    eventId: string,
    batchKey: string,
    dedupMode: ImportTicketBatchArgs['dedupMode'],
    rows: ImportTicketRow[],
    sourceLabel?: string,
  ): Promise<ImportBatchResult> {
    return this.convex.mutation(api.events.imported_tickets.importBatch, {
      eventId: eventId as Id<'events'>,
      batchKey,
      dedupMode,
      sourceLabel,
      rows,
    });
  }

  /**
   * Lists imported external ticket holders for an event (one-shot `convex.query`
   * — not a live subscription; callers reload it explicitly).
   *
   * Powers both the buyers-list merge (with source badge) and the preview dedup
   * hints. Roster-view authorized.
   */
  listImportedTickets(eventId: string): Promise<ImportedTicketHolder[]> {
    return this.convex.query(api.events.imported_tickets.listByEvent, {
      eventId: eventId as Id<'events'>,
    });
  }

  /**
   * Removes a single imported ticket-holder entry. Event-edit authorized,
   * audit-logged.
   */
  async removeImportedEntry(entryId: string): Promise<void> {
    await this.convex.mutation(api.events.imported_tickets.removeEntry, {
      id: entryId as Id<'importedTicketHolders'>,
    });
  }

  /**
   * Removes an entire import batch by its batch key. Returns the removed and
   * checked-in counts so the confirm dialog can warn about checked-in entries.
   */
  removeImportedBatch(
    eventId: string,
    batchKey: string,
  ): Promise<ImportBatchRemovalResult> {
    return this.convex.mutation(api.events.imported_tickets.removeBatch, {
      eventId: eventId as Id<'events'>,
      batchKey,
    });
  }

  /**
   * Sends a ticket email to a guest.
   *
   * Triggers an email with the guest's ticket and QR code to the guest's
   * registered email address. Requires the guest to have an email on file.
   *
   * The backend atomically claims each send, so concurrent admins/tabs cannot
   * double-send the same guest. `skipIfAlreadyEmailed` is used by the batch
   * "send all" path so a stale client cannot re-email guests another admin
   * already handled; a single resend omits it. The returned status reflects
   * whether the send actually happened (`sent`) or was skipped because it was
   * already sent / in flight (`skipped`).
   *
   * @param guestId - The ID of the guest to send the ticket to.
   * @param options.skipIfAlreadyEmailed - Skip guests already emailed.
   *
   * @remarks
   * Side effects:
   * - Sends an email to the guest's email address (unless skipped)
   */
  sendGuestTicket(
    guestId: string,
    options?: {skipIfAlreadyEmailed?: boolean},
  ): Promise<FunctionReturnType<typeof api.events.guest_actions.sendTicket>> {
    return this.convex.action(api.events.guest_actions.sendTicket, {
      guestId: guestId as Id<'guests'>,
      ...(options?.skipIfAlreadyEmailed ? {skipIfAlreadyEmailed: true} : {}),
    });
  }

  /**
   * Generates and returns a PDF ticket for an order.
   *
   * Creates a downloadable PDF containing all tickets associated with an order,
   * including QR codes for event check-in.
   *
   * @param orderId - The ID of the order to generate tickets for.
   * @returns Base64-encoded PDF data URL.
   */
  getTicketPdf(orderId: string): Promise<string> {
    return this.convex.action(api.tickets.actions['generateTicketPdf'], {
      orderId: orderId as Id<'ticket_orders'>,
    });
  }

  /**
   * Generates and returns a PDF ticket for a guest.
   *
   * Creates a downloadable PDF containing the guest's ticket with QR code
   * for event check-in.
   *
   * @param guestId - The ID of the guest to generate a ticket for.
   * @returns Base64-encoded PDF data URL.
   */
  getGuestTicketPdf(guestId: string): Promise<string> {
    return this.convex.action(api.events.guest_actions.getGuestTicketPdf, {
      guestId: guestId as Id<'guests'>,
    });
  }
}
