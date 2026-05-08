import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {isPendingResaleListingStatus} from '../../lib/resale_listing_transitions';
import {reopenResaleListing} from '../resale/helpers';
import {requireEventWithInventory} from './inventory';

/**
 * Owner key for order lookups on the composite indexes
 * `by_owner_user_event_state` and `by_owner_guest_event_state`. Used by
 * every flow that needs to find a caller's open orders for a given event
 * (open / cleanup / release). Lives here because release is the lowest-
 * level consumer; open flows import from here for the shared shape.
 */
export type OrderOwnerKey =
  | {type: 'user'; userId: Id<'users'>}
  | {type: 'guest'; guestSessionId: Id<'guest_sessions'>};

/**
 * Shared `ticket_orders` state patch. Centralized so the set of fields
 * touched across state transitions (open → completed / released) stays
 * a single list instead of diverging per call site.
 */
export async function patchOrderState(
  db: MutationCtx['db'],
  order: Doc<'ticket_orders'>,
  next: {
    state: Doc<'ticket_orders'>['state'];
    releaseReason?: Doc<'ticket_orders'>['releaseReason'];
    completedAt?: number;
    releasedAt?: number;
    stripeCheckoutSessionId?: string;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
  },
): Promise<void> {
  await db.patch('ticket_orders', order._id, {
    state: next.state,
    releaseReason: next.releaseReason,
    completedAt: next.completedAt,
    releasedAt: next.releasedAt,
    stripeCheckoutSessionId:
      'stripeCheckoutSessionId' in next
        ? next.stripeCheckoutSessionId
        : order.stripeCheckoutSessionId,
    stripePaymentIntentId:
      'stripePaymentIntentId' in next
        ? next.stripePaymentIntentId
        : order.stripePaymentIntentId,
    stripeChargeId:
      'stripeChargeId' in next ? next.stripeChargeId : order.stripeChargeId,
  });
}

export async function listOpenOrdersForOwnerAndEvent(
  db: MutationCtx['db'],
  owner: OrderOwnerKey,
  eventId: Id<'events'>,
): Promise<Array<Doc<'ticket_orders'>>> {
  if (owner.type === 'user') {
    return await db
      .query('ticket_orders')
      .withIndex('by_owner_user_event_state', (q) =>
        q.eq('userId', owner.userId).eq('eventId', eventId).eq('state', 'open'),
      )
      .take(20);
  }

  return await db
    .query('ticket_orders')
    .withIndex('by_owner_guest_event_state', (q) =>
      q
        .eq('guestSessionId', owner.guestSessionId)
        .eq('eventId', eventId)
        .eq('state', 'open'),
    )
    .take(20);
}

export async function releaseOpenOrder(
  db: MutationCtx['db'],
  order: Doc<'ticket_orders'>,
  reason: Doc<'ticket_orders'>['releaseReason'],
  now: number,
): Promise<void> {
  if (order.state !== 'open') {
    return;
  }

  if (order.kind === 'primary') {
    const {inventory} = await requireEventWithInventory({db}, order.eventId);
    await db.patch('event_inventory', inventory._id, {
      heldCount: Math.max(0, inventory.heldCount - order.quantity),
    });
  } else if (order.resaleListingId) {
    const listing = await db.get('resale_listings', order.resaleListingId);
    if (listing && isPendingResaleListingStatus(listing.status)) {
      await reopenResaleListing(db, listing._id);
    }
  }

  await patchOrderState(db, order, {
    state: 'released',
    releaseReason: reason,
    releasedAt: now,
  });
}

/**
 * Releases any expired open orders for this owner/event and returns the
 * still-open remainder. Single read: the input list is filtered in
 * memory after expiration releases, avoiding a second index scan.
 */
export async function cleanupExpiredOpenOrdersForOwnerAndEvent(
  ctx: MutationCtx,
  owner: OrderOwnerKey,
  eventId: Id<'events'>,
  now: number,
): Promise<Array<Doc<'ticket_orders'>>> {
  const orders = await listOpenOrdersForOwnerAndEvent(ctx.db, owner, eventId);
  const stillOpen: Array<Doc<'ticket_orders'>> = [];
  for (const order of orders) {
    if (order.expiresAt <= now) {
      await releaseOpenOrder(ctx.db, order, 'expired', now);
    } else {
      stillOpen.push(order);
    }
  }
  return stillOpen;
}

export async function releaseOrderState(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    reason: Doc<'ticket_orders'>['releaseReason'];
    now?: number;
  },
): Promise<Doc<'ticket_orders'> | null> {
  const order = await db.get('ticket_orders', args.orderId);
  if (!order) return null;
  await releaseOpenOrder(db, order, args.reason, args.now ?? Date.now());
  return await db.get('ticket_orders', args.orderId);
}
