import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {
  resaleListingStatusValidator,
  sellerRefundStateValidator,
} from '../lib/validators/ticketing';
import type {ResaleListingStatus} from '@shared/domain/resale-listing-status';
import {testingMutation} from './wrappers';

interface InsertSeedResaleListingArgs {
  ticketId: Id<'tickets'>;
  eventId: Id<'events'>;
  sellerId: Id<'users'>;
  status: ResaleListingStatus;
  buyerId?: Id<'users'>;
  pendingOrderId?: Id<'ticket_orders'>;
  sellerRefundAmountCents?: number;
  lostProcessingFeeCents?: number;
  resaleFeeCents?: number;
  sellerRefundState?: 'pending' | 'retrying' | 'completed' | 'failed';
  sellerRefundAttempts?: number;
  sellerRefundCompletedAt?: number;
  sellerRefundFailedAt?: number | null;
  sellerRefundNextRetryAt?: number | null;
  sellerRefundLastError?: string | null;
  completedAt?: number;
  cancelledAt?: number;
}

export async function insertSeedResaleListing(
  ctx: MutationCtx,
  args: InsertSeedResaleListingArgs,
): Promise<Id<'resale_listings'>> {
  if (args.status === 'listed' || args.status === 'pending') {
    const ticket = await ctx.db.get('tickets', args.ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status !== 'valid') {
      throw new Error(
        `Cannot list ticket with status "${ticket.status}" for resale. Only "valid" tickets can be listed.`,
      );
    }
  }

  const event = await ctx.db.get('events', args.eventId);
  if (event && !event.resaleEnabled) {
    throw new Error(
      `Cannot list ticket for resale — event "${event.title}" does not have resaleEnabled.`,
    );
  }

  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper for direct resale listing states.
  const listingId = await ctx.db.insert('resale_listings', {
    ticketId: args.ticketId,
    eventId: args.eventId,
    sellerId: args.sellerId,
    status: args.status,
    buyerId: args.buyerId,
    pendingOrderId: args.pendingOrderId,
    sellerRefundAmountCents: args.sellerRefundAmountCents,
    lostProcessingFeeCents: args.lostProcessingFeeCents,
    resaleFeeCents: args.resaleFeeCents,
    sellerRefundState: args.sellerRefundState,
    sellerRefundAttempts: args.sellerRefundAttempts,
    sellerRefundCompletedAt: args.sellerRefundCompletedAt,
    sellerRefundFailedAt: args.sellerRefundFailedAt,
    sellerRefundNextRetryAt: args.sellerRefundNextRetryAt,
    sellerRefundLastError: args.sellerRefundLastError,
    completedAt: args.completedAt,
    cancelledAt: args.cancelledAt,
  });
  return listingId;
}

/**
 * Forces a resale listing into a target status, simulating a state transition
 * that happens outside the order-hold path (e.g. the listing settled/sold or was
 * cancelled through another flow). Production code reaches these states through
 * settlement/cancellation mutations that also mutate related tickets/orders; this
 * helper sets only the listing status so tests can reproduce an intentionally
 * inconsistent listing state without raw-mutating the DB in the test file.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const setResaleListingStatus = testingMutation({
  args: {
    listingId: v.id('resale_listings'),
    status: resaleListingStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const listing = await ctx.db.get('resale_listings', args.listingId);
    if (!listing) throw new Error('Resale listing not found');
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper: simulate a resale listing leaving its prior status outside the order-hold path.
    await ctx.db.patch('resale_listings', args.listingId, {
      status: args.status,
    });
    return null;
  },
});

/**
 * Seeds a resale listing directly in the database, bypassing RLS and validation.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedResaleListing = testingMutation({
  args: {
    ticketId: v.id('tickets'),
    eventId: v.id('events'),
    sellerId: v.id('users'),
    status: resaleListingStatusValidator,
    buyerId: v.optional(v.id('users')),
    sellerRefundAmountCents: v.optional(v.number()),
    lostProcessingFeeCents: v.optional(v.number()),
    resaleFeeCents: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    sellerRefundState: v.optional(sellerRefundStateValidator),
    sellerRefundAttempts: v.optional(v.number()),
    sellerRefundCompletedAt: v.optional(v.number()),
    sellerRefundFailedAt: v.optional(v.union(v.number(), v.null())),
    sellerRefundNextRetryAt: v.optional(v.union(v.number(), v.null())),
    sellerRefundLastError: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.id('resale_listings'),
  handler: async (ctx, args) => {
    return insertSeedResaleListing(ctx, args);
  },
});
