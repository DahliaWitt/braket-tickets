import {internal} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {canPurchaseEvent} from '../../lib/access/purchase';
import {
  captureBackendEvent,
  guestDistinctId,
  userDistinctId,
} from '../../lib/analytics';
import type {CallerIdentity} from '../../lib/caller_identity';
import {
  DEFAULT_CURRENCY,
  ORDER_HOLD_EXPIRATION_MS,
  ORDER_RELEASE_GRACE_MS,
} from '../../lib/constants';
import {
  assertValidListingTransition,
  buildAcquirePatch,
} from '../../lib/resale_listing_transitions';
import {
  isActiveTicketStatus,
  isValidTicketStatus,
  type TicketTier,
} from '../../lib/validators/ticketing';
import {validateTierPricing} from '../payments/pricing';
import {getOrganizerChargeReadiness} from '../stripe_connect_state';
import {
  assertPositiveInteger,
  assertPurchasableEvent,
  getOwnerFieldsForInsert,
  throwOrderError,
} from './access';
import {
  getRemainingPrimaryInventory,
  reservePrimaryInventoryHold,
  requireEventWithInventory,
} from './inventory';
import {
  type OrderOwnerKey,
  cleanupExpiredOpenOrdersForOwnerAndEvent,
  releaseOpenOrder,
} from './release';
import {assertOrderTrustMetadata} from './trust';

/**
 * Snapshot the connected account id for a direct-charge order, or
 * `undefined` when the event is platform-owned or the organizer has not
 * connected Stripe yet. Stored on `ticket_orders.connectedAccountId` so
 * downstream refund / sync / ledger paths can route through the correct
 * account without re-querying the organizer.
 *
 * Platform-owned events resolve to `undefined` even if the organizer row
 * carries a `stripeConnectedAccountId`: the charge path for platform
 * events intentionally uses the platform account.
 */
async function resolveOrderConnectedAccountId(
  db: MutationCtx['db'],
  event: Doc<'events'>,
): Promise<string | undefined> {
  const organizer = await db.get('organizers', event.organizerId);
  if (!organizer || organizer.isPlatformOrganizer) {
    return undefined;
  }
  return organizer.stripeConnectedAccountId;
}

async function assertPaidEventPaymentReady(
  db: MutationCtx['db'],
  event: Doc<'events'>,
  amountCents: number,
): Promise<void> {
  if (amountCents <= 0) {
    return;
  }

  const organizer = await db.get('organizers', event.organizerId);
  const readiness = getOrganizerChargeReadiness(organizer);
  if (!readiness.ok) {
    const message =
      readiness.code === 'ORGANIZER_STRIPE_NOT_CONNECTED'
        ? 'Organizer has not connected a Stripe account.'
        : readiness.code === 'ORGANIZER_STRIPE_CHARGES_DISABLED'
          ? 'Organizer Stripe account is not enabled for charges yet.'
          : 'Organizer Stripe account onboarding is incomplete.';
    throwOrderError(readiness.code, message);
  }
}

function getOwnerKey(identity: CallerIdentity): OrderOwnerKey {
  return identity.type === 'user'
    ? {type: 'user', userId: identity.userId}
    : {type: 'guest', guestSessionId: identity.guestSessionId};
}

function getCheckoutKind(args: {
  identity: CallerIdentity;
  amountCents: number;
  kind: 'primary' | 'resale';
}): 'primary' | 'guest' | 'free' | 'resale' {
  if (args.kind === 'resale') return 'resale';
  if (args.amountCents === 0) return 'free';
  return args.identity.type === 'guest' ? 'guest' : 'primary';
}

async function distinctIdForIdentity(
  identity: CallerIdentity,
): Promise<string> {
  return identity.type === 'user'
    ? userDistinctId(identity.userId)
    : await guestDistinctId(identity.guestOwnerKey);
}

function isEquivalentOpenOrder(
  order: Pick<
    Doc<'ticket_orders'>,
    'kind' | 'quantity' | 'tier' | 'amountCents' | 'resaleListingId'
  >,
  args: {
    kind: Doc<'ticket_orders'>['kind'];
    quantity: number;
    tier: TicketTier;
    amountCents: number;
    resaleListingId?: Id<'resale_listings'>;
  },
): boolean {
  return (
    order.kind === args.kind &&
    order.quantity === args.quantity &&
    order.tier === args.tier &&
    order.amountCents === args.amountCents &&
    order.resaleListingId === args.resaleListingId
  );
}

async function countActiveOwnedTicketsForEvent(
  db: MutationCtx['db'],
  owner: OrderOwnerKey,
  eventId: Id<'events'>,
): Promise<number> {
  const query =
    owner.type === 'user'
      ? db
          .query('tickets')
          .withIndex('by_user_event', (q) =>
            q.eq('userId', owner.userId).eq('eventId', eventId),
          )
      : db
          .query('tickets')
          .withIndex('by_guestSession_event', (q) =>
            q.eq('guestSessionId', owner.guestSessionId).eq('eventId', eventId),
          );

  const tickets = await query.take(200);
  return tickets.filter((ticket) => isActiveTicketStatus(ticket.status)).length;
}

function assertTicketLimit(
  alreadyOwned: number,
  requestedQuantity: number,
  maxPerUser: number,
): void {
  if (alreadyOwned + requestedQuantity > maxPerUser) {
    throwOrderError(
      'INVALID_STATE',
      `Maximum ${maxPerUser} tickets per user. You already have ${alreadyOwned}.`,
    );
  }
}

async function requirePrimaryPurchaseAccessForOrder(
  ctx: MutationCtx,
  identity: CallerIdentity,
  event: Doc<'events'>,
): Promise<{
  trustSource: Doc<'ticket_orders'>['trustSource'];
  trustViaOrganizerId?: Id<'organizers'>;
}> {
  const access = await canPurchaseEvent(ctx, identity, event);
  if (!access.allowed) {
    if (identity.type === 'guest') {
      throwOrderError(
        'FORBIDDEN',
        'Guest checkout is only available for fully public events',
      );
    }
    throwOrderError(
      'FORBIDDEN',
      'You must be approved through the community vetting process to purchase tickets for this event',
    );
  }

  return {
    trustSource: access.source,
    trustViaOrganizerId:
      access.source === 'shared' ? access.viaOrganizerId : undefined,
  };
}

async function findEligibleResaleListing(
  db: MutationCtx['db'],
  args: {
    eventId: Id<'events'>;
    buyerUserId: Id<'users'>;
    tier: TicketTier;
  },
): Promise<{
  listing: Doc<'resale_listings'>;
  sellerTicket: Doc<'tickets'>;
} | null> {
  // Bound the scan to 50 candidate listings. If none match, the caller
  // throws `LISTING_UNAVAILABLE` instead of iterating unbounded history.
  const listings = await db
    .query('resale_listings')
    .withIndex('by_event_status', (q) =>
      q.eq('eventId', args.eventId).eq('status', 'listed'),
    )
    .take(50);

  for (const listing of listings) {
    if (listing.sellerId === args.buyerUserId) {
      continue;
    }

    const sellerTicket = await db.get('tickets', listing.ticketId);
    if (!sellerTicket) {
      continue;
    }
    if (sellerTicket.eventId !== args.eventId) {
      continue;
    }
    if (sellerTicket.userId !== listing.sellerId) {
      continue;
    }
    if (!isValidTicketStatus(sellerTicket.status)) {
      continue;
    }
    if (sellerTicket.tier !== args.tier) {
      continue;
    }

    return {listing, sellerTicket};
  }

  return null;
}

export async function openPrimaryOrderState(
  ctx: MutationCtx,
  args: {
    identity: CallerIdentity;
    eventId: Id<'events'>;
    quantity: number;
    tier: TicketTier;
    amountCents: number;
    now?: number;
  },
): Promise<Doc<'ticket_orders'>> {
  assertPositiveInteger(args.quantity, 'Quantity');

  const now = args.now ?? Date.now();
  const owner = getOwnerKey(args.identity);
  const existingOrders = await cleanupExpiredOpenOrdersForOwnerAndEvent(
    ctx,
    owner,
    args.eventId,
    now,
  );

  const {event} = await requireEventWithInventory({db: ctx.db}, args.eventId);
  assertPurchasableEvent(event);

  const trust = await requirePrimaryPurchaseAccessForOrder(
    ctx,
    args.identity,
    event,
  );
  assertOrderTrustMetadata(trust);

  for (const order of existingOrders) {
    if (
      isEquivalentOpenOrder(order, {
        kind: 'primary',
        quantity: args.quantity,
        tier: args.tier,
        amountCents: args.amountCents,
      })
    ) {
      return order;
    }
  }

  validateTierPricing(event, {
    tier: args.tier,
    totalAmount: args.amountCents,
    quantity: args.quantity,
    errorCode: 'PRICE_MISMATCH',
  });
  await assertPaidEventPaymentReady(ctx.db, event, args.amountCents);

  const maxPerUser = event.maxTicketsPerUser ?? 4;
  const activeTicketCount = await countActiveOwnedTicketsForEvent(
    ctx.db,
    owner,
    args.eventId,
  );
  assertTicketLimit(activeTicketCount, args.quantity, maxPerUser);

  const expiresAt = now + ORDER_HOLD_EXPIRATION_MS;
  const connectedAccountId = await resolveOrderConnectedAccountId(
    ctx.db,
    event,
  );

  for (const order of existingOrders) {
    await releaseOpenOrder(ctx.db, order, 'superseded', now);
  }

  await reservePrimaryInventoryHold(
    {db: ctx.db},
    {event, quantity: args.quantity},
  );

  const orderId = await ctx.db.insert('ticket_orders', {
    ...getOwnerFieldsForInsert(args.identity),
    eventId: args.eventId,
    kind: 'primary',
    quantity: args.quantity,
    tier: args.tier,
    amountCents: args.amountCents,
    currency: DEFAULT_CURRENCY,
    state: 'open',
    expiresAt,
    trustSource: trust.trustSource,
    trustViaOrganizerId: trust.trustViaOrganizerId,
    ...(connectedAccountId !== undefined ? {connectedAccountId} : {}),
  });

  await ctx.scheduler.runAfter(
    Math.max(0, expiresAt - now + ORDER_RELEASE_GRACE_MS),
    internal.orders.core.expire,
    {orderId},
  );

  const order = await ctx.db.get('ticket_orders', orderId);
  if (!order) {
    throwOrderError(
      'INVALID_STATE',
      'Order could not be loaded after creation',
    );
  }
  await captureBackendEvent(ctx, {
    distinctId: await distinctIdForIdentity(args.identity),
    event: 'ticket_order_opened',
    uuid: `ticket_order_opened:${orderId}`,
    properties: {
      actor_role: args.identity.type === 'user' ? 'user' : 'guest',
      auth_state: args.identity.type === 'user' ? 'signed_in' : 'guest',
      order_id: orderId,
      event_id: event._id,
      checkout_kind: getCheckoutKind({
        identity: args.identity,
        amountCents: args.amountCents,
        kind: 'primary',
      }),
      ticket_count: args.quantity,
      amount_cents: args.amountCents,
      currency: DEFAULT_CURRENCY.toLowerCase(),
      purchase_access_source: trust.trustSource,
      connected_account_present: Boolean(connectedAccountId),
    },
  });
  return order;
}

export async function openResaleOrderState(
  ctx: MutationCtx,
  args: {
    identity: CallerIdentity;
    eventId: Id<'events'>;
    tier: TicketTier;
    amountCents: number;
    now?: number;
  },
): Promise<Doc<'ticket_orders'>> {
  if (args.identity.type !== 'user') {
    throwOrderError(
      'FORBIDDEN',
      'Resale checkout requires an authenticated user',
    );
  }

  const now = args.now ?? Date.now();
  const owner = getOwnerKey(args.identity);
  const existingOrders = await cleanupExpiredOpenOrdersForOwnerAndEvent(
    ctx,
    owner,
    args.eventId,
    now,
  );

  const {event, inventory} = await requireEventWithInventory(
    {db: ctx.db},
    args.eventId,
  );
  assertPurchasableEvent(event);
  if (!event.resaleEnabled) {
    throwOrderError(
      'LISTING_UNAVAILABLE',
      'Resale is not enabled for this event',
    );
  }
  if (getRemainingPrimaryInventory(event, inventory) > 0) {
    throwOrderError(
      'LISTING_UNAVAILABLE',
      'Resale tickets are only available when the event is sold out',
    );
  }

  const trust = await requirePrimaryPurchaseAccessForOrder(
    ctx,
    args.identity,
    event,
  );
  assertOrderTrustMetadata(trust);
  validateTierPricing(event, {
    tier: args.tier,
    totalAmount: args.amountCents,
    quantity: 1,
    errorCode: 'PRICE_MISMATCH',
  });
  await assertPaidEventPaymentReady(ctx.db, event, args.amountCents);

  const maxPerUser = event.maxTicketsPerUser ?? 4;
  const activeTicketCount = await countActiveOwnedTicketsForEvent(
    ctx.db,
    owner,
    args.eventId,
  );
  assertTicketLimit(activeTicketCount, 1, maxPerUser);

  const eligibleListing = await findEligibleResaleListing(ctx.db, {
    eventId: args.eventId,
    buyerUserId: args.identity.userId,
    tier: args.tier,
  });

  if (!eligibleListing) {
    throwOrderError('LISTING_UNAVAILABLE', 'No resale tickets are available');
  }
  const listedListing = eligibleListing.listing;
  const listingTier = eligibleListing.sellerTicket.tier;

  for (const order of existingOrders) {
    if (
      isEquivalentOpenOrder(order, {
        kind: 'resale',
        quantity: 1,
        tier: listingTier,
        amountCents: args.amountCents,
        resaleListingId: listedListing._id,
      })
    ) {
      return order;
    }
  }

  for (const order of existingOrders) {
    await releaseOpenOrder(ctx.db, order, 'superseded', now);
  }

  const expiresAt = now + ORDER_HOLD_EXPIRATION_MS;
  const connectedAccountId = await resolveOrderConnectedAccountId(
    ctx.db,
    event,
  );
  const orderId = await ctx.db.insert('ticket_orders', {
    userId: args.identity.userId,
    eventId: args.eventId,
    kind: 'resale',
    resaleListingId: listedListing._id,
    quantity: 1,
    tier: listingTier,
    amountCents: args.amountCents,
    currency: DEFAULT_CURRENCY,
    state: 'open',
    expiresAt,
    trustSource: trust.trustSource,
    trustViaOrganizerId: trust.trustViaOrganizerId,
    ...(connectedAccountId !== undefined ? {connectedAccountId} : {}),
  });

  assertValidListingTransition(listedListing.status, 'pending');
  await ctx.db.patch(
    'resale_listings',
    listedListing._id,
    buildAcquirePatch({
      buyerId: args.identity.userId,
      pendingOrderId: orderId,
    }),
  );

  await ctx.scheduler.runAfter(
    Math.max(0, expiresAt - now + ORDER_RELEASE_GRACE_MS),
    internal.orders.core.expire,
    {orderId},
  );

  const order = await ctx.db.get('ticket_orders', orderId);
  if (!order) {
    throwOrderError(
      'INVALID_STATE',
      'Order could not be loaded after creation',
    );
  }
  await captureBackendEvent(ctx, {
    distinctId: await distinctIdForIdentity(args.identity),
    event: 'ticket_order_opened',
    uuid: `ticket_order_opened:${orderId}`,
    properties: {
      actor_role: 'user',
      auth_state: 'signed_in',
      order_id: orderId,
      event_id: event._id,
      checkout_kind: 'resale',
      ticket_count: 1,
      amount_cents: args.amountCents,
      currency: DEFAULT_CURRENCY.toLowerCase(),
      purchase_access_source: trust.trustSource,
      connected_account_present: Boolean(connectedAccountId),
    },
  });
  return order;
}
