import {v} from 'convex/values';
import {
  resaleListingStatusValidator,
  sellerRefundStateValidator,
} from '../../lib/validators/ticketing';

export const resaleListingFields = {
  _id: v.id('resale_listings'),
  _creationTime: v.number(),
  ticketId: v.id('tickets'),
  eventId: v.id('events'),
  sellerId: v.id('users'),
  status: resaleListingStatusValidator,
  buyerId: v.optional(v.id('users')),
  pendingOrderId: v.optional(v.id('ticket_orders')),
  sellerRefundAmountCents: v.optional(v.number()),
  lostProcessingFeeCents: v.optional(v.number()),
  resaleFeeCents: v.optional(v.number()),
  sellerRefundState: v.optional(sellerRefundStateValidator),
  sellerRefundAttempts: v.optional(v.number()),
  sellerRefundCompletedAt: v.optional(v.number()),
  sellerRefundFailedAt: v.optional(v.union(v.number(), v.null())),
  sellerRefundNextRetryAt: v.optional(v.union(v.number(), v.null())),
  sellerRefundLastError: v.optional(v.union(v.string(), v.null())),
  completedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
};

export const resaleListingValidator = v.object(resaleListingFields);

export const resaleListingListValidator = v.array(resaleListingValidator);

export const resaleListingsByEventValidator = v.record(
  v.string(),
  resaleListingListValidator,
);

export const resaleReservationResultValidator = v.object({
  orderId: v.id('ticket_orders'),
  listingId: v.id('resale_listings'),
});
