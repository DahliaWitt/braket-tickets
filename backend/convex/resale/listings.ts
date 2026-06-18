import {v} from 'convex/values';
import type {DataModel} from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from '../_generated/server';
import {internal} from '../_generated/api';
import {getAuthUserId, requireUser} from '../lib/auth_identity';
import {isPlatformAdmin, loadEventOrThrow} from '../lib/access';
import {hasEventDatePassed} from '../lib/timezone';
import {rateLimiter} from '../lib/rate_limits';
import {findMatchingInQuery} from '../lib/query_scan';
import {getGroupedResaleListingsByEvent} from '../lib/resale/read_models';
import {
  assertValidListingTransition,
  buildCancellationPatch,
  buildNewListingStatusFields,
  isActiveResaleListingStatus,
} from '../lib/resale_listing_transitions';
import {isValidTicketStatus} from '../lib/validators/ticketing';
import {cleanupStaleResaleListingsState} from '../lib/resale/cleanup';
import {
  notifySubscribersForListedTicketState,
  subscribeToResaleNotificationsState,
  unsubscribeFromResaleNotificationsState,
} from '../lib/resale/notifications';
import {
  handleSellerRefundCompletionState,
  processSellerRefundState,
  type SellerRefundWorkContext,
} from '../lib/resale/settlement';
import {
  resaleListingListValidator,
  resaleListingsByEventValidator,
} from '../lib/resale/validators';
import {stripePool} from '../lib/resilience';
import {
  throwConflict,
  throwForbidden,
  throwInvalidState,
  throwNotFound,
} from '../lib/errors';

/**
 * List a ticket for resale.
 *
 * Creates a new resale listing in 'listed' status. The listing becomes
 * purchasable only when the event sells out and sales are active.
 *
 * Validates:
 * - User owns the ticket
 * - Ticket status is 'valid'
 * - Event has resale enabled
 * - No existing active listing for this ticket
 * - Ticket sales haven't ended
 * - Event date hasn't passed
 *
 * @param ticketId - The ticket to list for resale
 * @returns The ID of the created resale listing
 */
export const listTicketForResale = mutation({
  args: {ticketId: v.id('tickets')},
  returns: v.id('resale_listings'),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    const ticket = await ctx.db.get('tickets', args.ticketId);
    if (!ticket) throwNotFound('Ticket');
    if (ticket.userId !== userId)
      throwForbidden('You can only list your own tickets');
    if (!isValidTicketStatus(ticket.status))
      throwInvalidState('Only valid tickets can be listed for resale');
    // TODO(ticket-transfer-resale-payout): allow transferred tickets to be
    // listed once proceeds can be paid to the current holder without relying on
    // the original buyer's order/card.
    if (!ticket.orderId)
      throwInvalidState(
        'Tickets without purchase settlement cannot be listed for resale yet',
      );

    const event = await loadEventOrThrow(ctx, ticket.eventId);
    if (!event.resaleEnabled)
      throwInvalidState('Resale is not enabled for this event');

    const salesStatus = event.ticketSalesStatus ?? 'active';
    if (salesStatus === 'ended') throwInvalidState('Ticket sales have ended');

    // Check event date hasn't passed
    if (hasEventDatePassed(event.date))
      throwInvalidState('Event has already occurred');

    // Check for existing active listing (listed or pending)
    const existingListing = await findMatchingInQuery(
      ctx.db
        .query('resale_listings')
        .withIndex('by_ticket', (q) => q.eq('ticketId', args.ticketId)),
      (listing) => isActiveResaleListingStatus(listing.status),
      100,
    );
    if (existingListing)
      throwConflict('This ticket is already listed for resale');

    const listingId = await ctx.db.insert('resale_listings', {
      ticketId: args.ticketId,
      eventId: ticket.eventId,
      sellerId: userId,
      ...buildNewListingStatusFields(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.resale.listings.notifySubscribersForListedTicket,
      {
        eventId: ticket.eventId,
        sellerId: userId,
      },
    );

    return listingId;
  },
});

/**
 * Cancel a resale listing.
 *
 * Sellers (and platform admins) can cancel a 'listed' resale listing. Listings
 * in 'pending', 'completed', or 'cancelled' status cannot be cancelled — the
 * FSM rejects non-listed transitions (pending protects buyers mid-checkout;
 * completed/cancelled are terminal).
 *
 * @param listingId - The listing to cancel
 */
export const cancelResaleListing = mutation({
  args: {listingId: v.id('resale_listings')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    const listing = await ctx.db.get('resale_listings', args.listingId);
    if (!listing) throwNotFound('Listing');

    // Authorization: seller or root admin
    if (listing.sellerId !== userId) {
      if (!(await isPlatformAdmin(ctx, userId)))
        throwForbidden('You can only cancel your own listings');
    }

    assertValidListingTransition(listing.status, 'cancelled');
    await ctx.db.patch(
      'resale_listings',
      args.listingId,
      buildCancellationPatch({now: Date.now()}),
    );
    return null;
  },
});

/**
 * Get the current user's resale listings for an event.
 *
 * Returns all listings (any status) for the authenticated user and event,
 * ordered by creation time (newest first).
 *
 * @param eventId - The event to check
 * @returns Array of the user's resale listings
 */
export const getMyResaleListings = query({
  args: {eventId: v.id('events')},
  returns: resaleListingListValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Bounded to one user's resale listings on one event. A user can own at most
    // `event.maxTicketsPerUser` tickets (default 4, ≤ 10 in practice), and
    // each ticket yields at most one resale listing.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    return ctx.db
      .query('resale_listings')
      .withIndex('by_seller_event', (q) =>
        q.eq('sellerId', userId).eq('eventId', args.eventId),
      )
      .collect();
  },
});

/**
 * Get the current user's resale listings for multiple events.
 *
 * Returns listings grouped by event ID for the authenticated user.
 * This supports realtime tickets page subscriptions with a single query.
 */
export const getMyResaleListingsBatch = query({
  args: {eventIds: v.array(v.id('events'))},
  returns: resaleListingsByEventValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || args.eventIds.length === 0) return {};

    return getGroupedResaleListingsByEvent(ctx.db, userId, args.eventIds);
  },
});

/**
 * Process a seller refund via Stripe.
 * Durable order/listing state changes happen in the workpool completion mutation.
 *
 * @internal
 */
export const processSellerRefund = internalAction({
  args: {
    sellerOrderId: v.id('ticket_orders'),
    sellerOrderStripePaymentIntentId: v.optional(v.string()),
    listingId: v.id('resale_listings'),
    eventId: v.id('events'),
    refundAmountCents: v.number(),
    lostProcessingFeeCents: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    stripeRefundId: v.string(),
  }),
  handler: async (ctx, args) => await processSellerRefundState(ctx, args),
});

const sellerRefundWorkContextValidator = v.object({
  sellerOrderId: v.id('ticket_orders'),
  sellerOrderStripePaymentIntentId: v.optional(v.string()),
  listingId: v.id('resale_listings'),
  eventId: v.id('events'),
  refundAmountCents: v.number(),
  lostProcessingFeeCents: v.number(),
  idempotencyKey: v.string(),
  retryCount: v.number(),
});

/**
 * Durable completion handler for seller refund work items.
 *
 * Marks the seller order refunded only after processor confirmation and
 * re-enqueues failed work with backoff instead of silently stopping.
 *
 * @internal
 */
export const onSellerRefundComplete = stripePool.defineOnComplete<
  DataModel,
  typeof sellerRefundWorkContextValidator
>({
  context: sellerRefundWorkContextValidator,
  handler: async (
    ctx,
    args: {
      workId: string;
      context: SellerRefundWorkContext;
      result:
        | {kind: 'success'; returnValue: {stripeRefundId: string}}
        | {kind: 'failed'; error: string}
        | {kind: 'canceled'};
    },
  ) => {
    await handleSellerRefundCompletionState(ctx, args);
  },
});

/**
 * Queue resale availability emails for subscribers when a ticket is listed.
 *
 * @internal
 */
export const notifySubscribersForListedTicket = internalMutation({
  args: {
    eventId: v.id('events'),
    sellerId: v.id('users'),
  },
  returns: v.number(),
  handler: async (ctx, args) =>
    await notifySubscribersForListedTicketState(ctx, args),
});

/**
 * Subscribe to resale notifications for an event.
 *
 * Creates a notification record so the user is alerted when resale tickets
 * become available for a sold-out event. Idempotent — returns existing
 * subscription if already subscribed.
 *
 * @param eventId - The event to subscribe to
 * @returns The notification subscription ID
 */
export const subscribeToResaleNotifications = mutation({
  args: {eventId: v.id('events')},
  returns: v.id('resale_notifications'),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    // Rate limit: 10 subscriptions per user per minute
    await rateLimiter.limit(ctx, 'subscribeResaleNotifications', {
      key: userId,
      throws: true,
    });

    return await subscribeToResaleNotificationsState(ctx, {
      eventId: args.eventId,
      userId,
    });
  },
});

/**
 * Unsubscribe from resale notifications for an event.
 *
 * Removes the notification subscription. No-op if not subscribed.
 *
 * @param eventId - The event to unsubscribe from
 */
export const unsubscribeFromResaleNotifications = mutation({
  args: {eventId: v.id('events')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    await unsubscribeFromResaleNotificationsState(ctx.db, {
      eventId: args.eventId,
      userId,
    });
    return null;
  },
});

/**
 * Cleanup stale resale listings stuck in 'pending' status.
 *
 * Reverts listings whose linked order has expired
 * back to 'listed' so they re-enter the FIFO queue. This handles cases where
 * the buyer abandoned checkout or payment processing timed out.
 *
 * @internal - Called by the cleanup cron job
 */
export const cleanupStaleResaleListings = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => await cleanupStaleResaleListingsState(ctx),
});
