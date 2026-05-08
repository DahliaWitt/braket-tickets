import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {
  calculateLostProcessingFeeCents,
  calculatePerTicketRefundAmount,
  getProcessorFeeCents,
} from '../payments/refunds';
import {
  assertValidListingTransition,
  buildReopenPatch,
} from '../../lib/resale_listing_transitions';
import {isRefundedTicketStatus} from '../../lib/validators/ticketing';

type QueryableDb = Pick<QueryCtx['db'], 'query'>;
type ReopenableDb = Pick<MutationCtx['db'], 'patch' | 'get'>;

export async function findFirstListedResaleForBuyer(
  db: QueryableDb,
  eventId: Id<'events'>,
  buyerId: Id<'users'>,
): Promise<Doc<'resale_listings'> | null> {
  for await (const listing of db
    .query('resale_listings')
    .withIndex('by_event_status', (q) =>
      q.eq('eventId', eventId).eq('status', 'listed'),
    )
    .order('asc')) {
    if (listing.sellerId !== buyerId) {
      return listing;
    }
  }

  return null;
}

export async function areAllOrderTicketsRefunded(
  db: QueryableDb,
  orderId: Id<'ticket_orders'>,
): Promise<boolean> {
  let hasTickets = false;

  for await (const ticket of db
    .query('tickets')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))) {
    hasTickets = true;
    if (!isRefundedTicketStatus(ticket.status)) {
      return false;
    }
  }

  return hasTickets;
}

export async function reopenResaleListing(
  db: ReopenableDb,
  listingId: Id<'resale_listings'>,
): Promise<void> {
  const listing = await db.get('resale_listings', listingId);
  if (!listing) return;

  assertValidListingTransition(listing.status, 'listed');
  await db.patch('resale_listings', listingId, buildReopenPatch());
}

export function calculateResaleSellerSettlement(
  sellerOrder: Pick<
    Doc<'ticket_orders'>,
    'amountCents' | 'quantity' | 'stripePaymentIntentId'
  > | null,
  sellerOriginalProcessorFeeCents: number | undefined,
  resaleFeePct: number | undefined,
): {
  sellerPaidAmount: number;
  resaleFeeCents: number;
  sellerRefundAmount: number;
  lostProcessingFeeCents: number;
} {
  if (!sellerOrder) {
    return {
      sellerPaidAmount: 0,
      resaleFeeCents: 0,
      sellerRefundAmount: 0,
      lostProcessingFeeCents: 0,
    };
  }

  const sellerQuantity = Math.max(sellerOrder.quantity, 1);
  const sellerPaidAmount = calculatePerTicketRefundAmount(
    sellerOrder.amountCents,
    sellerQuantity,
  );
  const resaleFeeCents = Math.round(
    sellerPaidAmount * ((resaleFeePct ?? 0) / 100),
  );

  return {
    sellerPaidAmount,
    resaleFeeCents,
    sellerRefundAmount: sellerPaidAmount - resaleFeeCents,
    lostProcessingFeeCents: calculateLostProcessingFeeCents({
      refundedAmount: sellerPaidAmount,
      totalAmount: sellerOrder.amountCents,
      storedProcessorFeeCents:
        sellerOriginalProcessorFeeCents ??
        getProcessorFeeCents({amount: sellerOrder.amountCents}),
    }),
  };
}
