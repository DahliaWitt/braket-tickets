import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {throwNotFound} from '../../lib/errors';
import {
  calculateRefundableAmountFromTicketCount,
  estimateRefundedAmountForTicketCount,
} from './refunds';
import {loadOrderFinancial} from '../orders/financial_reporting';
import {
  isRefundedTicketStatus,
  isUsedTicketStatus,
  isValidTicketStatus,
} from '../../lib/validators/ticketing';

type RefundQueryCtx = Pick<QueryCtx, 'db'>;

export type SingleTicketRefundInfo = {
  refundAmount: number;
  canRefund: boolean;
  reason?: string;
  orderId?: Id<'ticket_orders'>;
  orderStripePaymentIntentId?: string;
  orderAmount?: number;
  orderProcessorFee?: number;
  orderEventId?: Id<'events'>;
};

export type RefundableAmountInfo = {
  refundableAmount: number;
  validTicketCount: number;
  totalTicketCount: number;
};

async function getOrderTickets(
  ctx: RefundQueryCtx,
  orderId: Id<'ticket_orders'>,
) {
  // Bounded to one order's tickets (product design: 1–10 per order).
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  return await ctx.db
    .query('tickets')
    .withIndex('by_order', (q) => q.eq('orderId', orderId))
    .collect();
}

export async function getSingleTicketRefundInfo(
  ctx: RefundQueryCtx,
  ticketId: Id<'tickets'>,
): Promise<SingleTicketRefundInfo> {
  const ticket = await ctx.db.get('tickets', ticketId);
  if (!ticket) throwNotFound('Ticket');

  if (isRefundedTicketStatus(ticket.status)) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Ticket already refunded',
    };
  }

  if (isUsedTicketStatus(ticket.status)) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Used tickets require force refund',
    };
  }

  if (!isValidTicketStatus(ticket.status)) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Ticket cannot be refunded',
    };
  }

  if (!ticket.orderId) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Ticket has no order',
    };
  }

  const order = await ctx.db.get('ticket_orders', ticket.orderId);
  if (!order || order.state !== 'completed') {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Order not found',
    };
  }
  if (order.quantity <= 0) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Order has no refundable tickets',
    };
  }
  const financial = await loadOrderFinancial(ctx.db, order._id);
  if (!financial) {
    return {
      refundAmount: 0,
      canRefund: false,
      reason: 'Order has no captured payment',
    };
  }

  const tickets = await getOrderTickets(ctx, order._id);
  const previouslyRefundedTicketCount = tickets.filter((orderTicket) =>
    isRefundedTicketStatus(orderTicket.status),
  ).length;
  const nextRefundedTicketCount = Math.min(
    order.quantity,
    previouslyRefundedTicketCount + 1,
  );
  const cumulativeRefundTarget = estimateRefundedAmountForTicketCount({
    totalAmount: order.amountCents,
    refundedTicketCount: nextRefundedTicketCount,
    totalTicketCount: order.quantity,
  });
  const refundAmount = Math.max(
    0,
    Math.min(order.amountCents, cumulativeRefundTarget) -
      Math.min(order.amountCents, financial.refundedAmountCents),
  );

  return {
    refundAmount,
    canRefund: true,
    orderId: order._id,
    orderStripePaymentIntentId: order.stripePaymentIntentId,
    orderAmount: order.amountCents,
    orderProcessorFee: financial.originalProcessorFeeCents,
    orderEventId: order.eventId,
  };
}

export async function getRefundableAmountForOrder(
  ctx: RefundQueryCtx,
  orderId: Id<'ticket_orders'>,
): Promise<RefundableAmountInfo> {
  const order = await ctx.db.get('ticket_orders', orderId);
  if (!order) throwNotFound('Order');

  const tickets = await getOrderTickets(ctx, orderId);
  const totalTicketCount = tickets.length;
  const validTicketCount = tickets.filter((ticket) =>
    isValidTicketStatus(ticket.status),
  ).length;

  return {
    refundableAmount: calculateRefundableAmountFromTicketCount({
      totalAmount: order.amountCents,
      refundableTicketCount: validTicketCount,
      totalTicketCount,
    }),
    validTicketCount,
    totalTicketCount,
  };
}
