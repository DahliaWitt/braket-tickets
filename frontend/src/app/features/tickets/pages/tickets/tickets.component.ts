import {
  afterNextRender,
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  resource,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import {UpperCasePipe} from '@angular/common';
import {AuthService} from '@/core/services/auth.service';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {AppQrComponent} from '../../components/qr/qr.component';
import {RouterLink} from '@angular/router';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {injectQuery, skipToken} from 'convex-angular';

import {type Ticket} from '../../models/ticket.model';
import {
  EMPTY_BATCH_AVAILABILITY,
  EventsService,
  type BatchAvailability,
} from '@/features/admin/services/events.service';
import type {ResaleListingStatus} from '@shared/domain/resale-listing-status';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {formatUsdCents} from '@shared/pricing/pricing-summary';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {
  TicketTransferControlsComponent,
  type TicketTransferConfirmation,
} from './ticket-transfer-controls.component';

/** Resale listing data mapped to a ticket */
interface TicketResaleInfo {
  listingId: string;
  status: ResaleListingStatus;
}

@Component({
  selector: 'app-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventDatePipe,
    UpperCasePipe,
    RouterLink,
    ZardCardComponent,
    AppQrComponent,
    ZardButtonComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    ZardTooltipDirective,
    EmptyStateComponent,
    ContentLayoutComponent,
    TicketTransferControlsComponent,
  ],
  templateUrl: './tickets.component.html',
})
export class TicketsComponent {
  private auth = inject(AuthService);
  private paymentService = inject(PaymentService);
  private resaleService = inject(ResaleService);
  private eventsService = inject(EventsService);
  private browser = inject(BrowserPlatformService);
  private injector = inject(Injector);

  // Consume the service-based resource. `ticketsResource.value` is a plain
  // computed signal (not an Angular resource), so it never throws on error —
  // safe to read directly.
  readonly tickets = this.paymentService.ticketsResource.value;
  isLoading = this.paymentService.ticketsResource.isLoading;
  readonly copiedId = signal<string | null>(null);
  readonly isDownloadingPdf = signal<string | null>(null);
  readonly transferFlowTicketId = signal<string | null>(null);
  readonly isValidatingTransfer = signal<string | null>(null);
  readonly isTransferringTicket = signal<string | null>(null);
  readonly transferConfirmation = signal<TicketTransferConfirmation | null>(
    null,
  );
  readonly transferError = signal<string | null>(null);
  readonly transferErrorTicketId = signal<string | null>(null);
  private readonly transferEmailByTicketId = signal<
    ReadonlyMap<string, string>
  >(new Map());

  // Resale state
  readonly isListingForResale = signal<string | null>(null);
  readonly isCancellingListing = signal<string | null>(null);
  readonly resaleConfirmationTicketId = signal<string | null>(null);
  private readonly optimisticResaleMap = signal<
    ReadonlyMap<string, TicketResaleInfo>
  >(new Map());
  private readonly hiddenResaleListingIds = signal<ReadonlySet<string>>(
    new Set(),
  );

  /** Unique event IDs from the user's tickets (for batch queries) */
  private readonly uniqueEventIds = computed(() => {
    const ids = new Set(this.tickets().map((t) => t.eventId));
    return [...ids];
  });

  /** Availability data per event loaded via chunking-aware service */
  private readonly availabilityResource = resource({
    params: () => ({eventIds: this.uniqueEventIds()}),
    loader: ({params}): Promise<BatchAvailability> => {
      if (params.eventIds.length === 0) {
        return Promise.resolve(EMPTY_BATCH_AVAILABILITY);
      }

      return this.eventsService.getBatchAvailability(params.eventIds);
    },
  });

  /** True when either the tickets query or the availability batch has errored */
  readonly hasLoadError = computed(
    () =>
      !!this.paymentService.ticketsResource.error() ||
      this.availabilityResource.status() === 'error',
  );

  /** Realtime resale listings for the user's tickets, keyed by event */
  private readonly resaleListingsQuery = injectQuery(
    api.resale.listings.getMyResaleListingsBatch,
    () => {
      const eventIds = this.uniqueEventIds();
      if (eventIds.length === 0) return skipToken;
      return {
        eventIds,
      };
    },
  );

  /** Map of ticketId -> active resale info for O(1) lookup */
  private readonly resaleMap = computed(() => {
    const listings = this.resaleListingsQuery.data() ?? {};
    const hiddenListingIds = this.hiddenResaleListingIds();
    const map = new Map<string, TicketResaleInfo>();
    for (const eventListings of Object.values(listings)) {
      for (const listing of eventListings) {
        if (
          !hiddenListingIds.has(listing._id) &&
          (listing.status === 'listed' || listing.status === 'pending')
        ) {
          map.set(listing.ticketId, {
            listingId: listing._id,
            status: listing.status,
          });
        }
      }
    }
    for (const [ticketId, resale] of this.optimisticResaleMap()) {
      if (!hiddenListingIds.has(resale.listingId) && !map.has(ticketId)) {
        map.set(ticketId, resale);
      }
    }
    return map;
  });

  /** Get resale info for a specific ticket */
  getResaleInfo(ticketId: string): TicketResaleInfo | undefined {
    return this.resaleMap().get(ticketId);
  }

  /** Check if resale is enabled for a ticket's event */
  isResaleEnabled(ticket: Ticket): boolean {
    // Check from resolved event first (avoids waiting for availability fetch)
    const eventDoc = ticket.resolvedEvent;
    if (eventDoc && 'resaleEnabled' in eventDoc) {
      return eventDoc.resaleEnabled === true;
    }
    // Fallback to availability data — helper returns undefined while errored/loading
    const avail = safeResourceValue(this.availabilityResource);
    if (avail) {
      const eventAvail = avail[ticket.eventId];
      if (eventAvail && 'resaleEnabled' in eventAvail) {
        return eventAvail.resaleEnabled === true;
      }
    }
    return false;
  }

  /** Check if an event is sold out */
  isEventSoldOut(eventId: string): boolean {
    const avail = safeResourceValue(this.availabilityResource);
    if (avail) {
      const eventAvail = avail[eventId];
      if (eventAvail && 'isSoldOut' in eventAvail) {
        return eventAvail.isSoldOut;
      }
    }
    return false;
  }

  /** Get the number of resale listings in queue for an event */
  getResaleQueueCount(eventId: string): number {
    const avail = safeResourceValue(this.availabilityResource);
    if (avail) {
      const eventAvail = avail[eventId];
      if (eventAvail && 'resaleAvailable' in eventAvail) {
        return eventAvail.resaleAvailable ?? 0;
      }
    }
    return 0;
  }

  resaleDisclosure(ticket: Ticket): {
    originalPrice: string;
    feePercent: string;
    feeAmount: string;
    expectedRefund: string;
    lostProcessingFee: string;
  } | null {
    const settlement = ticket.resaleSellerSettlement;
    const resaleFeePct = ticket.resolvedEvent?.resaleFeePct ?? 0;
    if (!settlement) return null;

    return {
      originalPrice: formatUsdCents(settlement.sellerPaidAmount),
      feePercent: resaleFeePct.toFixed(1).replace(/\.0$/, ''),
      feeAmount: formatUsdCents(settlement.resaleFeeCents),
      expectedRefund: formatUsdCents(settlement.sellerRefundAmount),
      lostProcessingFee: formatUsdCents(settlement.lostProcessingFeeCents),
    };
  }

  canConfirmResaleListing(ticket: Ticket): boolean {
    return ticket.resaleSellerSettlement !== undefined;
  }

  canListTicketForResale(ticket: Ticket): boolean {
    return ticket.status === 'valid' && ticket.orderId !== undefined;
  }

  canTransferTicket(ticket: Ticket): boolean {
    return ticket.status === 'valid' && !this.getResaleInfo(ticket._id);
  }

  ticketQrData(ticket: Ticket): string {
    return `TICKET:${ticket.qrCode ?? ticket._id}`;
  }

  isTransferBusy(): boolean {
    return (
      this.isValidatingTransfer() !== null ||
      this.isTransferringTicket() !== null
    );
  }

  openTransferFlow(ticketId: string): void {
    if (this.isTransferBusy()) return;
    this.resaleConfirmationTicketId.set(null);
    this.transferFlowTicketId.set(ticketId);
    this.transferConfirmation.set(null);
    this.clearTransferError();
  }

  closeTransferFlow(ticketId: string): void {
    if (this.isTransferringTicket() === ticketId) return;
    if (this.transferFlowTicketId() === ticketId) {
      this.transferFlowTicketId.set(null);
      this.transferConfirmation.set(null);
      this.clearTransferError();
    }
  }

  transferEmail(ticketId: string): string {
    return this.transferEmailByTicketId().get(ticketId) ?? '';
  }

  updateTransferEmail(ticketId: string, email: string): void {
    this.transferEmailByTicketId.update((current) => {
      const next = new Map(current);
      next.set(ticketId, email);
      return next;
    });
    if (this.transferConfirmation()?.ticketId === ticketId) {
      this.transferConfirmation.set(null);
    }
    this.clearTransferError();
  }

  clearTransferConfirmation(): void {
    this.transferConfirmation.set(null);
  }

  private clearTransferError(): void {
    this.transferError.set(null);
    this.transferErrorTicketId.set(null);
  }

  private setTransferError(ticketId: string, message: string): void {
    this.transferError.set(message);
    this.transferErrorTicketId.set(ticketId);
  }

  async validateTransferRecipient(ticket: Ticket): Promise<void> {
    if (this.isTransferBusy()) return;
    const email = this.transferEmail(ticket._id).trim();
    if (!email) {
      this.setTransferError(ticket._id, 'Enter a recipient email.');
      return;
    }

    this.isValidatingTransfer.set(ticket._id);
    this.transferConfirmation.set(null);
    this.clearTransferError();
    try {
      const recipient =
        await this.paymentService.validateTicketTransferRecipient(
          ticket._id as Id<'tickets'>,
          email,
        );
      this.transferConfirmation.set({
        ticketId: ticket._id,
        recipientEmail: recipient.email,
        ...(recipient.name ? {recipientName: recipient.name} : {}),
      });
    } catch (err: unknown) {
      const message = extractErrorMessage(err);
      this.setTransferError(ticket._id, message);
      logger.error('Failed to validate ticket transfer recipient', err);
    } finally {
      this.isValidatingTransfer.set(null);
    }
  }

  async confirmTransferTicket(ticket: Ticket): Promise<void> {
    const confirmation = this.transferConfirmation();
    if (
      !confirmation ||
      confirmation.ticketId !== ticket._id ||
      this.isTransferringTicket() !== null
    ) {
      return;
    }

    this.isTransferringTicket.set(ticket._id);
    this.clearTransferError();
    try {
      const recipient = await this.paymentService.transferTicket(
        ticket._id as Id<'tickets'>,
        confirmation.recipientEmail,
      );
      this.transferConfirmation.set(null);
      this.transferFlowTicketId.set(null);
      this.paymentService.triggerRefresh();
      toast.success(
        `Ticket transferred to ${recipient.name || recipient.email}.`,
      );
    } catch (err: unknown) {
      const message = extractErrorMessage(err);
      this.setTransferError(ticket._id, message);
      toast.error(message);
      logger.error('Failed to transfer ticket', err);
    } finally {
      this.isTransferringTicket.set(null);
    }
  }

  openResaleListingFlow(ticketId: string) {
    if (this.isListingForResale() !== null || this.getResaleInfo(ticketId))
      return;
    const ticket = this.tickets().find(
      (candidate) => candidate._id === ticketId,
    );
    if (!ticket || !this.canListTicketForResale(ticket)) return;
    this.transferFlowTicketId.set(null);
    this.transferConfirmation.set(null);
    this.clearTransferError();
    this.resaleConfirmationTicketId.set(ticketId);
    this.focusConfirmResaleButton(ticketId);
  }

  closeResaleListingFlow(ticketId: string) {
    if (this.isListingForResale() === ticketId) return;
    if (this.resaleConfirmationTicketId() === ticketId) {
      this.resaleConfirmationTicketId.set(null);
    }
  }

  async confirmListForResale(ticketId: string) {
    if (this.isListingForResale() !== null || this.getResaleInfo(ticketId))
      return;
    const ticket = this.tickets().find(
      (candidate) => candidate._id === ticketId,
    );
    if (
      !ticket ||
      !this.canListTicketForResale(ticket) ||
      !this.canConfirmResaleListing(ticket)
    ) {
      toast.error(
        "We can't calculate the resale payout for this ticket yet. Contact support before listing it.",
      );
      return;
    }
    this.isListingForResale.set(ticketId);
    try {
      const listingId = await this.resaleService.listTicketForResale(ticketId);
      this.optimisticResaleMap.update((current) => {
        const next = new Map(current);
        next.set(ticketId, {listingId, status: 'listed'});
        return next;
      });
      this.resaleConfirmationTicketId.set(null);
      toast.success('Ticket listed for resale');
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to list ticket for resale', err);
    } finally {
      this.isListingForResale.set(null);
    }
  }

  resaleConfirmButtonId(ticketId: string): string {
    return `ticket-resale-confirm-${ticketId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  }

  private focusConfirmResaleButton(ticketId: string): void {
    runInInjectionContext(this.injector, () => {
      afterNextRender({
        write: () => {
          if (this.resaleConfirmationTicketId() !== ticketId) return;
          this.browser.focusElementById(this.resaleConfirmButtonId(ticketId));
        },
      });
    });
  }

  async cancelResaleListing(listingId: string, ticketId: string) {
    this.isCancellingListing.set(ticketId);
    try {
      await this.resaleService.cancelResaleListing(listingId);
      this.hiddenResaleListingIds.update((current) => {
        const next = new Set(current);
        next.add(listingId);
        return next;
      });
      this.optimisticResaleMap.update((current) => {
        const next = new Map(current);
        next.delete(ticketId);
        return next;
      });
      toast.success('Resale listing cancelled');
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to cancel resale listing', err);
    } finally {
      this.isCancellingListing.set(null);
    }
  }

  async downloadTicketPdf(ticketId: string) {
    this.isDownloadingPdf.set(ticketId);
    try {
      const dataUrl = await this.paymentService.getMyTicketPdf(
        ticketId as Id<'tickets'>,
      );
      this.browser.navigateWithAnchor(dataUrl, `ticket-${ticketId}.pdf`);
      toast.success('Ticket PDF download started.');
    } catch (err: unknown) {
      logger.error('Failed to download ticket PDF', err);
      toast.error('Failed to generate ticket PDF');
    } finally {
      this.isDownloadingPdf.set(null);
    }
  }

  copyId(id: string) {
    this.browser.writeClipboardText(id).then(
      () => {
        this.copiedId.set(id);
        toast.success('Ticket ID copied.');
        setTimeout(() => {
          if (this.copiedId() === id) {
            this.copiedId.set(null);
          }
        }, 2000);
      },
      (err) => {
        logger.error('Failed to copy ticket ID', err);
        toast.error('Failed to copy ticket ID.');
      },
    );
  }
}
