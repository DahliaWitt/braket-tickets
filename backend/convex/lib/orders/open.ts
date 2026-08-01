import {internal} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {canPurchaseEvent} from '../../lib/access/purchase';
import type {CallerIdentity} from '../../lib/caller_identity';
import {
  DEFAULT_CURRENCY,
  ORDER_HOLD_EXPIRATION_MS,
  ORDER_RELEASE_GRACE_MS,
} from '../../lib/constants';
import {
  assertValidListingTransition,
  buildAcquirePatch,
  isPendingResaleListingStatus,
} from '../../lib/resale_listing_transitions';
import {
  isActiveTicketStatus,
  isValidTicketStatus,
  type TicketTier,
} from '../../lib/validators/ticketing';
import {listGuestSessionsByEmail} from '../guest_sessions/lifecycle';
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

async function countActiveGuestTicketsForSession(
  db: MutationCtx['db'],
  guestSessionId: Id<'guest_sessions'>,
  eventId: Id<'events'>,
): Promise<number> {
  const tickets = await db
    .query('tickets')
    .withIndex('by_guestSession_event', (q) =>
      q.eq('guestSessionId', guestSessionId).eq('eventId', eventId),
    )
    .take(200);
  return tickets.filter((ticket) => isActiveTicketStatus(ticket.status)).length;
}

async function countActiveOwnedTicketsForEvent(
  db: MutationCtx['db'],
  owner: OrderOwnerKey,
  eventId: Id<'events'>,
): Promise<number> {
  if (owner.type === 'user') {
    const tickets = await db
      .query('tickets')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', owner.userId).eq('eventId', eventId),
      )
      .take(200);
    return tickets.filter((ticket) => isActiveTicketStatus(ticket.status))
      .length;
  }

  // Guests: enforce maxTicketsPerUser per EMAIL, not per session. Re-entering
  // an email on a new device mints a fresh guest session, so a per-session
  // count would reset the cap on every device switch. Converted sessions
  // contribute zero here because migration moves their tickets to the user
  // (clearing guestSessionId), and the by_email scan is bounded by
  // EMAIL_SESSION_SCAN_LIMIT with realistic counts in the single digits.
  const session = await db.get('guest_sessions', owner.guestSessionId);
  if (!session) {
    return await countActiveGuestTicketsForSession(
      db,
      owner.guestSessionId,
      eventId,
    );
  }

  const sessions = await listGuestSessionsByEmail(db, session.email);
  let count = 0;
  for (const emailSession of sessions) {
    count += await countActiveGuestTicketsForSession(
      db,
      emailSession._id,
      eventId,
    );
  }
  return count;
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

/**
 * Find an existing open resale order this buyer can resume on retry.
 *
 * A buyer who re-enters resale checkout (page reload, or a client retry after
 * a transient failure) must be able to resume the hold they already own rather
 * than be rejected with `LISTING_UNAVAILABLE`. Their own in-flight order keeps
 * the sole listing in `pending`, so `findEligibleResaleListing` — which scans
 * only `listed` rows — would otherwise find nothing and the throw would fire
 * before any idempotent return. This mirrors the primary flow's dedup
 * (`openPrimaryOrderState`), which returns the caller's equivalent open order
 * before creating a new hold.
 *
 * Returns the matching order only when its listing is still `pending`, still
 * pinned to this exact order (`pendingOrderId`), and still held by this buyer
 * (`buyerId`). Orders whose args no longer match (different tier / amount) or
 * whose listing has since been reopened fall through, so they are superseded
 * by the normal acquire path instead of resumed.
 */
async function findResumableResaleOrder(
  db: MutationCtx['db'],
  existingOrders: Array<Doc<'ticket_orders'>>,
  args: {
    buyerUserId: Id<'users'>;
    tier: TicketTier;
    amountCents: number;
  },
): Promise<Doc<'ticket_orders'> | null> {
  for (const order of existingOrders) {
    if (order.kind !== 'resale' || !order.resaleListingId) {
      continue;
    }
    if (
      !isEquivalentOpenOrder(order, {
        kind: 'resale',
        quantity: 1,
        tier: args.tier,
        amountCents: args.amountCents,
        resaleListingId: order.resaleListingId,
      })
    ) {
      continue;
    }

    const listing = await db.get('resale_listings', order.resaleListingId);
    if (
      listing &&
      isPendingResaleListingStatus(listing.status) &&
      listing.pendingOrderId === order._id &&
      listing.buyerId === args.buyerUserId
    ) {
      return order;
    }
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
    /**
     * ToS assent evidence for guest purchases (BRA-455). Server-derived only
     * — callers must never pass a client-supplied timestamp or version.
     * Signed-in callers omit these; evidence is account-level for them.
     */
    tosAcceptedAt?: number;
    tosVersion?: string;
    /**
     * Client idempotency key for free-ticket claims. Stored on the order so a
     * retry of the same claim attempt can replay it instead of issuing a new
     * ticket. Omitted for paid checkout opens.
     */
    idempotencyKey?: string;
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
      // If a free claim dedups onto a pre-existing open hold, persist the
      // claim's idempotency key so the completed order remains discoverable on
      // retry. Without this, a retry would miss the key and double-issue.
      if (
        args.idempotencyKey !== undefined &&
        order.idempotencyKey !== args.idempotencyKey
      ) {
        await ctx.db.patch('ticket_orders', order._id, {
          idempotencyKey: args.idempotencyKey,
        });
        return {...order, idempotencyKey: args.idempotencyKey};
      }
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
    ...(args.tosAcceptedAt !== undefined
      ? {tosAcceptedAt: args.tosAcceptedAt}
      : {}),
    ...(args.tosVersion !== undefined ? {tosVersion: args.tosVersion} : {}),
    ...(args.idempotencyKey !== undefined
      ? {idempotencyKey: args.idempotencyKey}
      : {}),
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

  // Idempotent resume: if the buyer re-enters checkout while already holding a
  // matching open resale order, return it before the availability gate. The
  // buyer's own hold pins the sole listing to `pending`, so requiring a
  // `listed` listing first (below) would wrongly reject them as
  // `LISTING_UNAVAILABLE` and strand the hold for its full TTL.
  const resumableOrder = await findResumableResaleOrder(
    ctx.db,
    existingOrders,
    {
      buyerUserId: args.identity.userId,
      tier: args.tier,
      amountCents: args.amountCents,
    },
  );
  if (resumableOrder) {
    return resumableOrder;
  }

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

  // Any still-open orders that did not qualify for resume above (mismatched
  // args, or a listing that is no longer pending) are superseded before we
  // acquire the freshly found listing.
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
  return order;
}
