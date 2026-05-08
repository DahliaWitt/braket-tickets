import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {throwOrderError} from './access';
import {
  appendFinancialEvent,
  findExistingOrderFinancialEvent,
} from './financial_events';
import {patchOrderState} from './release';

export async function markLateInvalidRefundedState(
  ctx: MutationCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    stripeRefundId?: string;
    stripeEventId?: string;
    refundedAmountCents: number;
    processorFeeCents?: number;
    platformFeeCents?: number;
    connectedAccountNetCents?: number;
    now?: number;
  },
): Promise<void> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) {
    return;
  }

  // Idempotent via stripeRefundId (or stripeEventId) dedupe in appendFinancialEvent.
  await appendFinancialEvent(ctx.db, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'payment_refunded',
    amountCents: args.refundedAmountCents,
    stripePaymentIntentId: order.stripePaymentIntentId,
    stripeChargeId: order.stripeChargeId,
    stripeRefundId: args.stripeRefundId,
    stripeEventId: args.stripeEventId,
    processorFeeCents: args.processorFeeCents,
    platformFeeCents: args.platformFeeCents,
    connectedAccountNetCents: args.connectedAccountNetCents,
    occurredAt: args.now,
  });
}

export async function prepareLateInvalidRefundState(
  ctx: MutationCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeEventId?: string;
    now?: number;
  },
): Promise<{
  order: Doc<'ticket_orders'>;
  alreadyRefunded: boolean;
  refundedAmountCents: number;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
}> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) {
    throwOrderError('INVALID_STATE', 'Order not found');
  }

  const now = args.now ?? Date.now();

  await patchOrderState(ctx.db, order, {
    state: 'released',
    releaseReason: 'late_invalid',
    releasedAt: order.releasedAt ?? now,
    stripePaymentIntentId:
      args.stripePaymentIntentId ?? order.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId ?? order.stripeChargeId,
  });

  const existingLateInvalidEvent = await findExistingOrderFinancialEvent(
    ctx.db,
    {
      orderId: order._id,
      kind: 'late_payment_after_release',
    },
  );
  if (!existingLateInvalidEvent) {
    await appendFinancialEvent(ctx.db, {
      orderId: order._id,
      eventId: order.eventId,
      kind: 'late_payment_after_release',
      amountCents: order.amountCents,
      stripePaymentIntentId:
        args.stripePaymentIntentId ?? order.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId ?? order.stripeChargeId,
      stripeEventId: args.stripeEventId,
      occurredAt: now,
    });
  }

  const updatedOrder = await ctx.db.get('ticket_orders', order._id);
  if (!updatedOrder) {
    throwOrderError('INVALID_STATE', 'Order could not be reloaded');
  }

  let alreadyRefundedAmountCents = 0;
  for await (const financialEvent of ctx.db
    .query('order_financial_events')
    .withIndex('by_order_and_kind', (q) =>
      q.eq('orderId', order._id).eq('kind', 'payment_refunded'),
    )) {
    alreadyRefundedAmountCents += financialEvent.amountCents ?? 0;
  }

  return {
    order: updatedOrder,
    alreadyRefunded: alreadyRefundedAmountCents >= order.amountCents,
    refundedAmountCents: order.amountCents,
    stripePaymentIntentId:
      args.stripePaymentIntentId ?? updatedOrder.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId ?? updatedOrder.stripeChargeId,
  };
}
