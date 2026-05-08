import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {batchGetUsers} from '../../lib/batch_utils';
import {throwUnauthorized} from '../../lib/errors';
import {loadEventOrThrow, requireManageEvent} from '../../lib/access';
import {
  loadManagementDatasetWithinLimit,
  runManagementDatasetLoaders,
} from '../../lib/management_limits';
import {
  isCancelledResaleListingStatus,
  isCompletedResaleListingStatus,
  isListedResaleListingStatus,
  isPendingResaleListingStatus,
} from '../../lib/resale_listing_transitions';
import type {
  ManagementPurchases,
  ManagementResaleData,
  ManagementSummary,
} from './types';
import {summarizeEventOrderFinancials} from '../../lib/orders/financial_reporting';
import {toEventDocShape} from '../../lib/events/read_models';
import {
  isActiveTicketStatus,
  isUsedTicketStatus,
} from '../../lib/validators/ticketing';
import {toDateKeyInEventTimeZone} from '../../lib/timezone';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

type ManagementAuthArgs = {
  eventId: Id<'events'>;
  requestUserId: Id<'users'>;
};

/**
 * Shared auth preamble for every management surface. Loads the requesting
 * user + event, then delegates to `access.requireManageEvent` for the
 * canonical authz decision. Each management builder calls this before any
 * dataset read so the three surfaces cannot drift on who is allowed to
 * view them. Kept as a thin wrapper (not re-implemented inline) so every
 * authz log / telemetry added to `access.requireManageEvent` applies here
 * without a separate update.
 *
 * Intentionally does NOT use `requireEventForManage`: these internal queries
 * receive `requestUserId` as an explicit argument (caller-supplied identity)
 * rather than deriving it from the session via `requireUser(ctx)`. This is
 * required because the management internal queries are invoked via
 * `ctx.runQuery` from the public-facing query handlers, and the internal
 * query's auth context may not carry the caller's session in all runtimes.
 */
async function loadAndRequireManageEvent(
  ctx: QueryCtx,
  args: ManagementAuthArgs,
): Promise<{user: Doc<'users'>; event: Doc<'events'>}> {
  const user = await ctx.db.get('users', args.requestUserId);
  if (!user) throwUnauthorized();
  const event = await loadEventOrThrow(ctx, args.eventId);
  await requireManageEvent(ctx, user._id, event);
  return {user, event};
}

export async function buildManagementSummary(
  ctx: QueryCtx,
  args: ManagementAuthArgs,
): Promise<ManagementSummary> {
  const {event} = await loadAndRequireManageEvent(ctx, args);

  // Load the three datasets this surface needs in parallel. Each is bounded
  // by its dataset limit so oversized events fail loudly rather than silently
  // truncating revenue / tier counts. `runManagementDatasetLoaders` surfaces
  // EVERY offending dataset at once rather than failing fast on the first one,
  // so operators pruning an oversized event see the full punch list.
  const {tickets, financialEvents, completedOrders} =
    await runManagementDatasetLoaders({
      tickets: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'tickets',
          load: (limit) =>
            ctx.db
              .query('tickets')
              .withIndex('by_event_status', (q) =>
                q.eq('eventId', args.eventId),
              )
              .take(limit),
        }),
      financialEvents: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'orderFinancialEvents',
          load: (limit) =>
            ctx.db
              .query('order_financial_events')
              .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
              .take(limit),
        }),
      completedOrders: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'orders',
          load: (limit) =>
            ctx.db
              .query('ticket_orders')
              .withIndex('by_event_and_state', (q) =>
                q.eq('eventId', args.eventId).eq('state', 'completed'),
              )
              .take(limit),
        }),
    });

  const activeTickets = tickets.filter((ticket) =>
    isActiveTicketStatus(ticket.status),
  );

  const inventory = event.inventoryId
    ? await ctx.db.get('event_inventory', event.inventoryId)
    : null;
  const canonicalSoldCount = inventory?.soldCount ?? activeTickets.length;
  const canonicalHeldCount = inventory?.heldCount ?? 0;
  const canonicalRemainingCount = Math.max(
    0,
    event.totalTickets - canonicalSoldCount - canonicalHeldCount,
  );
  const canonicalIsSoldOut = canonicalRemainingCount === 0;

  const tierCounts: ManagementSummary['tierCounts'] = {
    regular: 0,
    notaflof: 0,
    supporter: 0,
  };
  let checkedIn = 0;
  const bucketMap = new Map<number, number>();

  for (const ticket of activeTickets) {
    tierCounts[ticket.tier] += 1;
    if (isUsedTicketStatus(ticket.status) && ticket.checkedInAt !== undefined) {
      checkedIn += 1;
      const bucketKey =
        Math.floor(ticket.checkedInAt / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
      bucketMap.set(bucketKey, (bucketMap.get(bucketKey) ?? 0) + 1);
    }
  }

  const buckets = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, count]) => ({time, count}));

  const checkInStats = {
    checkedIn,
    checkInRate: canonicalSoldCount > 0 ? checkedIn / canonicalSoldCount : 0,
    buckets,
  };

  const eventOrders = summarizeEventOrderFinancials(
    completedOrders,
    financialEvents,
  );

  const ticketsByOrderId = new Map<Id<'ticket_orders'>, typeof activeTickets>();
  for (const ticket of tickets) {
    if (!ticket.orderId) continue;
    const orderTickets = ticketsByOrderId.get(ticket.orderId) ?? [];
    orderTickets.push(ticket);
    ticketsByOrderId.set(ticket.orderId, orderTickets);
  }

  const salesByDayMap = new Map<string, number>();
  let grossCents = 0;
  let processingFeeCents = 0;
  let platformFeeCents = 0;
  let refundedCents = 0;
  let lostProcessingFeeCents = 0;
  const revenueByTier: ManagementSummary['revenueByTier'] = {
    regular: {grossCents: 0, netCents: 0, quantity: 0},
    notaflof: {grossCents: 0, netCents: 0, quantity: 0},
    supporter: {grossCents: 0, netCents: 0, quantity: 0},
  };

  for (const order of eventOrders) {
    const createdAt = order.createdAt;
    const dateKey = toDateKeyInEventTimeZone(new Date(createdAt));
    salesByDayMap.set(
      dateKey,
      (salesByDayMap.get(dateKey) ?? 0) + order.quantity,
    );

    const recognizedQuantityFromTickets = (
      ticketsByOrderId.get(order.orderId) ?? []
    ).filter((ticket) => isActiveTicketStatus(ticket.status)).length;
    const recognizedQuantity =
      recognizedQuantityFromTickets > 0
        ? recognizedQuantityFromTickets
        : order.recognizedQuantity;

    grossCents += order.capturedAmountCents;
    processingFeeCents += order.processorFeeCents;
    platformFeeCents += order.platformFeeCents;
    refundedCents += order.refundedAmountCents;
    lostProcessingFeeCents += order.lostProcessingFeeCents;

    revenueByTier[order.tier].grossCents += order.capturedAmountCents;
    revenueByTier[order.tier].netCents += order.netRevenueCents;
    revenueByTier[order.tier].quantity += recognizedQuantity;
  }

  const salesByDay = Array.from(salesByDayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, quantity]) => ({date, quantity}));

  return {
    event: toEventDocShape(event),
    soldCount: canonicalSoldCount,
    heldCount: canonicalHeldCount,
    remainingCount: canonicalRemainingCount,
    isSoldOut: canonicalIsSoldOut,
    totalTickets: event.totalTickets,
    tierCounts,
    revenue: {
      grossCents,
      processingFeeCents,
      platformFeeCents,
      refundedCents,
      lostProcessingFeeCents,
      netCents:
        grossCents -
        processingFeeCents -
        platformFeeCents -
        refundedCents -
        lostProcessingFeeCents,
    },
    revenueByTier,
    salesByDay,
    checkInStats,
  };
}

export async function buildManagementPurchases(
  ctx: QueryCtx,
  args: ManagementAuthArgs,
): Promise<ManagementPurchases> {
  const {event} = await loadAndRequireManageEvent(ctx, args);

  // All three datasets participate in the per-surface cap contract so an
  // oversized event throws MANAGEMENT_DATA_TOO_LARGE instead of silently
  // truncating per-order ticket summaries. `runManagementDatasetLoaders`
  // aggregates multi-dataset violations into a single error so operators see
  // the full list of offenders on one query.
  const {tickets, completedOrders, financialEvents} =
    await runManagementDatasetLoaders({
      tickets: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'tickets',
          load: (limit) =>
            ctx.db
              .query('tickets')
              .withIndex('by_event_status', (q) =>
                q.eq('eventId', args.eventId),
              )
              .take(limit),
        }),
      completedOrders: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'orders',
          load: (limit) =>
            ctx.db
              .query('ticket_orders')
              .withIndex('by_event_and_state', (q) =>
                q.eq('eventId', args.eventId).eq('state', 'completed'),
              )
              .take(limit),
        }),
      financialEvents: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'orderFinancialEvents',
          load: (limit) =>
            ctx.db
              .query('order_financial_events')
              .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
              .take(limit),
        }),
    });

  const eventOrders = summarizeEventOrderFinancials(
    completedOrders,
    financialEvents,
  );

  const userIds = eventOrders
    .map((order) => order.userId)
    .filter((userId): userId is Id<'users'> => userId !== undefined);
  const userMap = await batchGetUsers(ctx, userIds);

  type PurchaseTicketWithCreation =
    ManagementPurchases['purchases'][number]['tickets'][number] & {
      createdAt: number;
    };
  const ticketsByOrderId = new Map<
    Id<'ticket_orders'>,
    PurchaseTicketWithCreation[]
  >();

  for (const ticket of tickets) {
    if (!ticket.orderId) continue;

    const orderTickets = ticketsByOrderId.get(ticket.orderId) ?? [];
    orderTickets.push({
      id: ticket._id,
      status: ticket.status,
      tier: ticket.tier,
      createdAt: ticket._creationTime,
    });
    ticketsByOrderId.set(ticket.orderId, orderTickets);
  }

  const purchases: ManagementPurchases['purchases'] = [];
  for (const order of eventOrders) {
    const buyer = order.userId ? userMap.get(order.userId) : undefined;
    const orderTickets = (ticketsByOrderId.get(order.orderId) ?? [])
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({createdAt: _createdAt, ...ticket}) => ticket);

    purchases.push({
      id: order.orderId,
      userId: order.userId,
      userName: buyer?.name || buyer?.email || 'Guest',
      userEmail: buyer?.email ?? undefined,
      quantity: order.quantity,
      amount: order.capturedAmountCents,
      refundedAmountCents:
        order.refundedAmountCents > 0 ? order.refundedAmountCents : undefined,
      tier: order.tier,
      status: order.status,
      createdAt: order.createdAt,
      tickets: orderTickets,
    });
  }
  purchases.sort(
    (a: (typeof purchases)[number], b: (typeof purchases)[number]) => {
      return b.createdAt - a.createdAt;
    },
  );

  return {
    event: toEventDocShape(event),
    purchases,
  };
}

export async function buildManagementResale(
  ctx: QueryCtx,
  args: ManagementAuthArgs,
): Promise<ManagementResaleData> {
  const {event} = await loadAndRequireManageEvent(ctx, args);

  // Both datasets participate in the cap contract; aggregation surfaces both
  // offenders in one response when an event has simultaneously exceeded the
  // listing and notification limits.
  const {resaleListingsRaw, resaleNotifications} =
    await runManagementDatasetLoaders({
      resaleListingsRaw: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'resaleListings',
          load: (limit) =>
            ctx.db
              .query('resale_listings')
              .withIndex('by_event_status', (q) =>
                q.eq('eventId', args.eventId),
              )
              .take(limit),
        }),
      resaleNotifications: () =>
        loadManagementDatasetWithinLimit({
          dataset: 'resaleNotifications',
          load: (limit) =>
            ctx.db
              .query('resale_notifications')
              .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
              .take(limit),
        }),
    });

  const resaleUserIds = new Set(
    resaleListingsRaw.map((listing) => listing.sellerId),
  );
  for (const listing of resaleListingsRaw) {
    if (listing.buyerId) resaleUserIds.add(listing.buyerId);
  }
  const resaleUserMap = await batchGetUsers(ctx, resaleUserIds);

  const resaleListings = resaleListingsRaw.map((listing) => {
    const seller = resaleUserMap.get(listing.sellerId);
    const buyer = listing.buyerId
      ? resaleUserMap.get(listing.buyerId)
      : undefined;

    return {
      _id: listing._id,
      _creationTime: listing._creationTime,
      ticketId: listing.ticketId,
      eventId: listing.eventId,
      sellerId: listing.sellerId,
      sellerName: seller?.name || seller?.email || 'Unknown',
      sellerEmail: seller?.email ?? undefined,
      status: listing.status,
      buyerId: listing.buyerId,
      buyerName: buyer ? buyer.name || buyer.email || 'Unknown' : undefined,
      completedAt: listing.completedAt,
      cancelledAt: listing.cancelledAt,
      resaleFeeCents: listing.resaleFeeCents,
      sellerRefundAmountCents: listing.sellerRefundAmountCents,
      lostProcessingFeeCents: listing.lostProcessingFeeCents,
      sellerRefundState: listing.sellerRefundState,
      sellerRefundAttempts: listing.sellerRefundAttempts,
      sellerRefundCompletedAt: listing.sellerRefundCompletedAt,
      sellerRefundFailedAt: listing.sellerRefundFailedAt,
      sellerRefundNextRetryAt: listing.sellerRefundNextRetryAt,
      sellerRefundLastError: listing.sellerRefundLastError,
    };
  });

  const completedListings = resaleListingsRaw.filter((listing) =>
    isCompletedResaleListingStatus(listing.status),
  );

  return {
    event: toEventDocShape(event),
    resaleMetrics: {
      totalListings: resaleListingsRaw.length,
      activeListings: resaleListingsRaw.filter((listing) =>
        isListedResaleListingStatus(listing.status),
      ).length,
      pendingListings: resaleListingsRaw.filter((listing) =>
        isPendingResaleListingStatus(listing.status),
      ).length,
      completedResales: completedListings.length,
      cancelledListings: resaleListingsRaw.filter((listing) =>
        isCancelledResaleListingStatus(listing.status),
      ).length,
      totalRefundedToSellersCents: completedListings.reduce(
        (sum, listing) => sum + (listing.sellerRefundAmountCents ?? 0),
        0,
      ),
      totalResaleFeesCents: completedListings.reduce(
        (sum, listing) => sum + (listing.resaleFeeCents ?? 0),
        0,
      ),
      totalLostProcessingFeesCents: completedListings.reduce(
        (sum, listing) => sum + (listing.lostProcessingFeeCents ?? 0),
        0,
      ),
      notificationSubscribers: resaleNotifications.length,
    },
    resaleListings,
  };
}
