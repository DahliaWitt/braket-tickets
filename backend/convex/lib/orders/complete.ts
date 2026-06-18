import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {isTestEnvironment, isUnitTestRuntime} from '../../lib/environment';
import {
  assertValidListingTransition,
  buildAcquirePatch,
  isListedResaleListingStatus,
  isPendingResaleListingStatus,
} from '../../lib/resale_listing_transitions';
import {enqueueTicketEmailDelivery} from '../../lib/email_delivery_wrapper';
import {buildTicketRosterProjection} from '../../lib/ticket_roster_projection';
import {generateTicketScanCode} from '../../lib/ticket_scan_codes';
import {finalizeResaleState} from '../resale/settlement';
import {assertEventStillFulfillable, throwOrderError} from './access';
import {appendFinancialEvent} from './financial_events';
import {
  assertInventoryCanCoverQuantity,
  getRemainingPrimaryInventory,
  requireEventWithInventory,
} from './inventory';
import {patchOrderState} from './release';

function extractOwnerFieldsFromOrder(
  order: Pick<Doc<'ticket_orders'>, 'userId' | 'guestSessionId'>,
): {userId?: Id<'users'>; guestSessionId?: Id<'guest_sessions'>} {
  return {
    userId: order.userId,
    guestSessionId: order.guestSessionId,
  };
}

async function enqueueTicketEmailForOrder(
  ctx: MutationCtx,
  order: Doc<'ticket_orders'>,
): Promise<void> {
  if (isTestEnvironment() || isUnitTestRuntime()) {
    return;
  }

  await enqueueTicketEmailDelivery(ctx, {orderId: order._id});
}

export async function completePrimaryOrderState(
  ctx: MutationCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeEventId?: string;
    now?: number;
    note?: string;
  },
): Promise<Doc<'ticket_orders'>> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order || order.kind !== 'primary') {
    throwOrderError('INVALID_STATE', 'Primary order not found');
  }

  const now = args.now ?? Date.now();
  if (order.state === 'completed') {
    return order;
  }

  const {event, inventory} = await requireEventWithInventory(
    {db: ctx.db},
    order.eventId,
  );

  if (order.state === 'open') {
    assertEventStillFulfillable(event);
    await ctx.db.patch('event_inventory', inventory._id, {
      heldCount: Math.max(0, inventory.heldCount - order.quantity),
      soldCount: inventory.soldCount + order.quantity,
    });
  } else if (order.releaseReason === 'expired') {
    assertEventStillFulfillable(event);
    assertInventoryCanCoverQuantity({
      event,
      inventory,
      quantity: order.quantity,
    });
    await ctx.db.patch('event_inventory', inventory._id, {
      soldCount: inventory.soldCount + order.quantity,
    });
  } else {
    throwOrderError('INVALID_STATE', 'Order can no longer be completed');
  }

  await patchOrderState(ctx.db, order, {
    state: 'completed',
    releaseReason: undefined,
    completedAt: now,
    releasedAt: undefined,
    stripePaymentIntentId:
      args.stripePaymentIntentId ?? order.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId ?? order.stripeChargeId,
  });

  const [attendeeUser, guestSession] = await Promise.all([
    order.userId ? ctx.db.get('users', order.userId) : Promise.resolve(null),
    order.guestSessionId
      ? ctx.db.get('guest_sessions', order.guestSessionId)
      : Promise.resolve(null),
  ]);
  // Two-write pattern: insert tickets to obtain ticketId, then patch
  // roster projection fields. buildTicketRosterProjection computes
  // `rosterSortKey` using the real ticketId (see
  // lib/ticket_roster_projection.ts), so the projection cannot be spread
  // into the insert.
  const ticketInserts = Array.from({length: order.quantity}, () =>
    ctx.db.insert('tickets', {
      ...extractOwnerFieldsFromOrder(order),
      eventId: order.eventId,
      orderId: order._id,
      status: 'valid',
      tier: order.tier,
      qrCode: generateTicketScanCode(),
    }),
  );
  const ticketIds = await Promise.all(ticketInserts);
  await Promise.all(
    ticketIds.map((ticketId) =>
      ctx.db.patch(
        'tickets',
        ticketId,
        buildTicketRosterProjection({
          ticketId,
          status: 'valid',
          attendeeName: attendeeUser?.name ?? guestSession?.email ?? null,
          email: attendeeUser?.email ?? guestSession?.email ?? null,
          checkedInByName: null,
        }),
      ),
    ),
  );

  await appendFinancialEvent(ctx.db, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'payment_captured',
    amountCents: order.amountCents,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId,
    stripeEventId: args.stripeEventId,
    note: args.note,
    occurredAt: now,
  });

  const completedOrder = await ctx.db.get('ticket_orders', order._id);
  if (!completedOrder) {
    throwOrderError('INVALID_STATE', 'Completed order could not be loaded');
  }

  await enqueueTicketEmailForOrder(ctx, completedOrder);

  return completedOrder;
}

export async function completeResaleOrderState(
  ctx: MutationCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeEventId?: string;
    now?: number;
    note?: string;
  },
): Promise<Doc<'ticket_orders'>> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order || order.kind !== 'resale' || !order.resaleListingId) {
    throwOrderError('INVALID_STATE', 'Resale order not found');
  }

  const now = args.now ?? Date.now();
  if (order.state === 'completed') {
    return order;
  }

  const {event, inventory} = await requireEventWithInventory(
    {db: ctx.db},
    order.eventId,
  );
  assertEventStillFulfillable(event);
  if (getRemainingPrimaryInventory(event, inventory) > 0) {
    throwOrderError(
      'LISTING_UNAVAILABLE',
      'Resale checkout is only available while the event is sold out',
    );
  }

  const listing = await ctx.db.get('resale_listings', order.resaleListingId);
  if (!listing) {
    throwOrderError('LISTING_UNAVAILABLE', 'Resale listing not found');
  }

  if (order.state === 'released' && order.releaseReason === 'expired') {
    if (isListedResaleListingStatus(listing.status)) {
      if (!order.userId) {
        throwOrderError('INVALID_STATE', 'Resale order missing buyer userId');
      }
      assertValidListingTransition(listing.status, 'pending');
      await ctx.db.patch(
        'resale_listings',
        listing._id,
        buildAcquirePatch({
          buyerId: order.userId,
          pendingOrderId: order._id,
        }),
      );
    } else if (
      !isPendingResaleListingStatus(listing.status) ||
      listing.pendingOrderId !== order._id
    ) {
      throwOrderError(
        'LISTING_UNAVAILABLE',
        'Resale listing is no longer available',
      );
    }
  }

  await finalizeResaleState(ctx, {
    orderId: order._id,
    now,
  });

  await patchOrderState(ctx.db, order, {
    state: 'completed',
    releaseReason: undefined,
    completedAt: now,
    releasedAt: undefined,
    stripePaymentIntentId:
      args.stripePaymentIntentId ?? order.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId ?? order.stripeChargeId,
  });

  await appendFinancialEvent(ctx.db, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'payment_captured',
    amountCents: order.amountCents,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId,
    stripeEventId: args.stripeEventId,
    note: args.note,
    occurredAt: now,
  });

  const completedOrder = await ctx.db.get('ticket_orders', order._id);
  if (!completedOrder) {
    throwOrderError(
      'INVALID_STATE',
      'Completed resale order could not be loaded',
    );
  }

  return completedOrder;
}
