import {v} from 'convex/values';
import {action, internalQuery, type ActionCtx} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {internal} from '../_generated/api';
import {logger} from '../lib/logger';
import {ErrorMessages, throwInvalidState, throwNotFound} from '../lib/errors';
import {withRetry} from '../lib/resilience';
import {generateStripeIdempotencyKey} from '../lib/payments/refunds';
import {
  refundableAmountValidator,
  refundResultValidator,
  refundTicketResultValidator,
  singleTicketRefundInfoValidator,
} from '../lib/payments/validators';
import {
  calculateLostProcessingFeeCents,
  estimateRefundedAmountForTicketCount,
  getProcessorFeeCents,
} from '../lib/payments/refunds';
import {
  getRefundableAmountForOrder,
  getSingleTicketRefundInfo,
} from '../lib/payments/refund_queries';
import {
  executeStoredProcessorRefund,
  requireRefundOrderAction,
  requireRefundTicketAction,
  type StoredProcessorRefundResult,
} from '../lib/payments/refund_processing';
import {loadOrderFinancial} from '../lib/orders/financial_reporting';
import {
  isRefundedTicketStatus,
  isValidTicketStatus,
} from '../lib/validators/ticketing';

const orderFinancialResultValidator = v.object({
  orderId: v.id('ticket_orders'),
  eventId: v.id('events'),
  capturedAmountCents: v.number(),
  refundedAmountCents: v.number(),
  originalProcessorFeeCents: v.number(),
  processorFeeCents: v.number(),
});

async function executeAndApplyOrderRefund(
  ctx: ActionCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    eventId?: Id<'events'>;
    stripePaymentIntentId?: string;
    refundAmountCents: number;
    refundedAmountCents: number;
    ticketIdsToRefund: Id<'tickets'>[];
    refundedBy: Id<'users'>;
    lostProcessingFeeCents: number;
    auditAction:
      | 'payment.refund'
      | 'payment.force-refund-all'
      | 'ticket.refund';
    auditSource: string;
    stripeReason: string;
    stripeIdempotencyKey: string;
  },
): Promise<void> {
  let stripeRefund: StoredProcessorRefundResult | null = null;
  if (args.refundAmountCents > 0) {
    const stripePaymentIntentId = args.stripePaymentIntentId;
    if (!stripePaymentIntentId) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE(
          'order cannot be refunded without a stripePaymentIntentId',
        ),
      );
    }

    // Direct-charge refunds route through the order's snapshotted
    // connectedAccountId. `executeStoredProcessorRefund` resolves that
    // from `ticket_orders.connectedAccountId` so this caller only needs
    // to supply the order id.
    stripeRefund = await executeStoredProcessorRefund(ctx, {
      stripePaymentIntentId,
      orderId: args.orderId,
      amountCents: args.refundAmountCents,
      reason: args.stripeReason,
      stripeIdempotencyKey: args.stripeIdempotencyKey,
    });
  }

  // Stripe is committed at this point. If applyExternalRefund fails (e.g.
  // transient OCC conflict), we must converge local state so the order does
  // not silently diverge from Stripe. The mutation is idempotent: it bounds
  // refundedAmountCents with Math.max(previous, ...) and skips already-
  // refunded tickets, so re-running with the same args is safe. Stripe is
  // NOT re-called — the outer action body only runs once. Client errors
  // (ConvexError with structured data) short-circuit retries via withRetry's
  // isClientError detection, so validator drift surfaces immediately.
  await withRetry(
    () =>
      ctx.runMutation(internal.orders.core.applyExternalRefund, {
        orderId: args.orderId,
        refundedAmountCents: args.refundedAmountCents,
        ticketIdsToRefund: args.ticketIdsToRefund,
        stripeRefundId: stripeRefund?.refundId,
        ledgerRefundAmountCents:
          stripeRefund?.refundId === undefined
            ? undefined
            : args.refundAmountCents,
        processorFeeCents: stripeRefund?.processorFeeCents,
        platformFeeCents: stripeRefund?.platformFeeCents,
        connectedAccountNetCents: stripeRefund?.connectedAccountNetCents,
        refundedBy: args.refundedBy,
        lostProcessingFeeCents: args.lostProcessingFeeCents,
        auditAction: args.auditAction,
        auditSource: args.auditSource,
      }),
    {
      maxAttempts: 3,
      initialBackoffMs: 500,
      base: 2,
      onRetry: (attempt, error) => {
        logger.warn(
          'payments',
          'applyExternalRefund retry after Stripe-side commit',
          {
            attempt,
            orderId: args.orderId,
            stripeRefundId: stripeRefund?.refundId,
            stripeIdempotencyKey: args.stripeIdempotencyKey,
            error,
          },
        );
      },
    },
  );
}

async function loadCompletedOrderForRefund(
  ctx: ActionCtx,
  orderId: Id<'ticket_orders'>,
  operation: string,
) {
  const order = await ctx.runQuery(internal.orders.core.getInternal, {orderId});
  if (!order) throwNotFound('Order');

  if (order.state !== 'completed') {
    logger.error(
      'payments',
      `${operation}: order ${orderId} has state ${order.state}, cannot refund`,
    );
    throwInvalidState(ErrorMessages.INVALID_STATE('order cannot be refunded'));
  }

  return order;
}

function requireCompleteRefundTicketSet(args: {
  orderQuantity: number;
  ticketCount: number;
}): void {
  // TODO(ticket-transfer-refunds): define policy for refunding orders after one
  // or more tickets have been transferred away from the original order.
  if (args.ticketCount !== args.orderQuantity) {
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'order has detached tickets and cannot be refunded automatically',
      ),
    );
  }
}

export const getOrderFinancialInternal = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: v.union(orderFinancialResultValidator, v.null()),
  handler: async (ctx, args) => {
    const financial = await loadOrderFinancial(ctx.db, args.orderId);
    if (!financial) return null;

    return {
      orderId: financial.orderId,
      eventId: financial.eventId,
      capturedAmountCents: financial.capturedAmountCents,
      refundedAmountCents: financial.refundedAmountCents,
      originalProcessorFeeCents: financial.originalProcessorFeeCents,
      processorFeeCents: financial.processorFeeCents,
    };
  },
});

// Resolve the organizer that owns an order, via the order's event.
// Used by `requireRefundOrderAction` in refund_processing to gate
// refund actions on community-admin access (not just root-admin).
export const _getOrderOrganizer = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: v.union(v.id('organizers'), v.null()),
  handler: async (ctx, args) => {
    const order = await ctx.db.get('ticket_orders', args.orderId);
    if (!order) return null;
    const event = await ctx.db.get('events', order.eventId);
    return event?.organizerId ?? null;
  },
});

// Resolve the order a ticket belongs to. Used by
// `requireRefundTicketAction` for single-ticket refund authz.
export const _getTicketOrderId = internalQuery({
  args: {ticketId: v.id('tickets')},
  returns: v.union(v.id('ticket_orders'), v.null()),
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get('tickets', args.ticketId);
    return ticket?.orderId ?? null;
  },
});

/**
 * Calculates refund amount for a single ticket.
 * Returns per-ticket price based on order amount / quantity.
 */
export const calculateSingleTicketRefund = internalQuery({
  args: {ticketId: v.id('tickets')},
  returns: singleTicketRefundInfoValidator,
  handler: async (ctx, args) =>
    await getSingleTicketRefundInfo(ctx, args.ticketId),
});

/**
 * Calculates the refundable amount based on unused (valid) tickets.
 */
export const calculateRefundableAmount = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: refundableAmountValidator,
  handler: async (ctx, args) =>
    await getRefundableAmountForOrder(ctx, args.orderId),
});

/**
 * Initiates a partial refund for unused tickets in an order.
 *
 * This admin-only action refunds only valid tickets. Used tickets are preserved
 * to maintain attendance records.
 */
export const refund = action({
  args: {
    orderId: v.id('ticket_orders'),
  },
  returns: refundResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    refundedAmount: number;
    ticketsRefunded: number;
    lostProcessingFee: number;
  }> => {
    const orderId = args.orderId;
    const userId = await requireRefundOrderAction(ctx, orderId);
    const order = await loadCompletedOrderForRefund(
      ctx,
      orderId,
      'refundOrder',
    );

    const refundInfo = await ctx.runQuery(
      internal.payments.refunds.calculateRefundableAmount,
      {orderId},
    );

    const refundAmount = refundInfo.refundableAmount;
    const validTicketCount = refundInfo.validTicketCount;
    if (
      validTicketCount === 0 ||
      (refundAmount === 0 && order.amountCents > 0)
    ) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE('no unused tickets available for refund'),
      );
    }

    const financial = await ctx.runQuery(
      internal.payments.refunds.getOrderFinancialInternal,
      {orderId},
    );
    if (order.amountCents > 0 && (!financial || !order.stripePaymentIntentId)) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE('order cannot be refunded'),
      );
    }

    const tickets = await ctx.runQuery(
      internal.tickets.public.getTicketsByOrderInternal,
      {
        orderId,
      },
    );
    requireCompleteRefundTicketSet({
      orderQuantity: order.quantity,
      ticketCount: tickets.length,
    });
    const ticketIdsToRefund = tickets
      .filter((ticket) => isValidTicketStatus(ticket.status))
      .map((ticket) => ticket._id);
    const nextRefundedAmountCents = Math.min(
      order.amountCents,
      (financial?.refundedAmountCents ?? 0) + refundAmount,
    );

    const refundLostProcessingFeeCents = calculateLostProcessingFeeCents({
      refundedAmount: refundAmount,
      totalAmount: order.amountCents,
      storedProcessorFeeCents: financial?.originalProcessorFeeCents,
    });
    const nextLostProcessingFeeCents = calculateLostProcessingFeeCents({
      refundedAmount: nextRefundedAmountCents,
      totalAmount: order.amountCents,
      storedProcessorFeeCents: financial?.originalProcessorFeeCents,
    });

    await executeAndApplyOrderRefund(ctx, {
      orderId,
      eventId: order.eventId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      refundAmountCents: refundAmount,
      refundedAmountCents: nextRefundedAmountCents,
      ticketIdsToRefund,
      refundedBy: userId,
      lostProcessingFeeCents: nextLostProcessingFeeCents,
      auditAction: 'payment.refund',
      auditSource: `Partial refund: ${ticketIdsToRefund.length} tickets`,
      stripeReason: `Partial refund: ${validTicketCount} of ${refundInfo.totalTicketCount} tickets`,
      stripeIdempotencyKey: generateStripeIdempotencyKey(orderId, 'refund'),
    });
    return {
      success: true,
      refundedAmount: refundAmount,
      ticketsRefunded: validTicketCount,
      lostProcessingFee: refundLostProcessingFeeCents,
    };
  },
});

/**
 * Force refund the remaining order balance regardless of ticket usage.
 */
export const forceRefundAll = action({
  args: {
    orderId: v.id('ticket_orders'),
  },
  returns: refundResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    refundedAmount: number;
    ticketsRefunded: number;
    lostProcessingFee: number;
  }> => {
    const orderId = args.orderId;
    const userId = await requireRefundOrderAction(ctx, orderId);
    const order = await loadCompletedOrderForRefund(
      ctx,
      orderId,
      'forceRefundAll',
    );

    const tickets = await ctx.runQuery(
      internal.tickets.public.getTicketsByOrderInternal,
      {
        orderId,
      },
    );
    requireCompleteRefundTicketSet({
      orderQuantity: order.quantity,
      ticketCount: tickets.length,
    });
    const ticketIdsToRefund = tickets
      .filter((ticket) => !isRefundedTicketStatus(ticket.status))
      .map((ticket) => ticket._id);

    const financial = await ctx.runQuery(
      internal.payments.refunds.getOrderFinancialInternal,
      {orderId},
    );
    const refundedTicketCount = tickets.filter((ticket) =>
      isRefundedTicketStatus(ticket.status),
    ).length;
    const inferredRefundedAmount = estimateRefundedAmountForTicketCount({
      totalAmount: order.amountCents,
      refundedTicketCount,
      totalTicketCount: tickets.length,
    });
    const existingRefundedAmount =
      financial?.refundedAmountCents ?? inferredRefundedAmount;
    const refundAmount = Math.max(
      0,
      order.amountCents - existingRefundedAmount,
    );
    if (refundAmount === 0 && ticketIdsToRefund.length === 0) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE(
          'order has no remaining refundable balance',
        ),
      );
    }
    if (refundAmount > 0 && (!financial || !order.stripePaymentIntentId)) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE('order cannot be refunded'),
      );
    }

    const lostProcessingFeeCents = getProcessorFeeCents({
      amount: order.amountCents,
      storedProcessorFeeCents: financial?.originalProcessorFeeCents,
    });

    await executeAndApplyOrderRefund(ctx, {
      orderId,
      eventId: order.eventId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      refundAmountCents: refundAmount,
      refundedAmountCents: order.amountCents,
      ticketIdsToRefund,
      refundedBy: userId,
      lostProcessingFeeCents,
      auditAction: 'payment.force-refund-all',
      auditSource: `Force refund: ${ticketIdsToRefund.length} tickets (all)`,
      stripeReason: `Admin force refund (${ticketIdsToRefund.length} remaining tickets)`,
      stripeIdempotencyKey: generateStripeIdempotencyKey(
        orderId,
        'force-refund',
      ),
    });

    return {
      success: true,
      refundedAmount: refundAmount,
      ticketsRefunded: ticketIdsToRefund.length,
      lostProcessingFee: lostProcessingFeeCents,
    };
  },
});

/**
 * Refund a single ticket and mark it as refunded.
 */
export const refundTicket = action({
  args: {ticketId: v.id('tickets')},
  returns: refundTicketResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    refundedAmount: number;
    lostProcessingFee: number;
  }> => {
    const userId = await requireRefundTicketAction(ctx, args.ticketId);
    const refundInfo = await ctx.runQuery(
      internal.payments.refunds.calculateSingleTicketRefund,
      {ticketId: args.ticketId},
    );

    if (!refundInfo.canRefund) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE(
          refundInfo.reason ?? 'ticket cannot be refunded',
        ),
      );
    }

    const orderId = refundInfo.orderId;
    if (!orderId) throwNotFound('Order');
    const order = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId,
    });
    if (!order) throwNotFound('Order');

    const refundAmount = refundInfo.refundAmount;
    const financial = await ctx.runQuery(
      internal.payments.refunds.getOrderFinancialInternal,
      {orderId},
    );
    if (
      refundAmount > 0 &&
      (!refundInfo.orderStripePaymentIntentId || !refundInfo.orderEventId)
    ) {
      throwInvalidState(
        ErrorMessages.INVALID_STATE('order cannot be refunded'),
      );
    }

    const totalOrderAmount = refundInfo.orderAmount ?? refundAmount;
    const refundLostProcessingFeeCents = calculateLostProcessingFeeCents({
      refundedAmount: refundAmount,
      totalAmount: totalOrderAmount,
      storedProcessorFeeCents: refundInfo.orderProcessorFee,
    });
    const nextRefundedAmountCents = Math.min(
      totalOrderAmount,
      (financial?.refundedAmountCents ?? 0) + refundAmount,
    );
    const nextLostProcessingFeeCents = calculateLostProcessingFeeCents({
      refundedAmount: nextRefundedAmountCents,
      totalAmount: totalOrderAmount,
      storedProcessorFeeCents: refundInfo.orderProcessorFee,
    });

    await executeAndApplyOrderRefund(ctx, {
      orderId,
      eventId: refundInfo.orderEventId,
      stripePaymentIntentId: refundInfo.orderStripePaymentIntentId,
      refundAmountCents: refundAmount,
      refundedAmountCents: nextRefundedAmountCents,
      ticketIdsToRefund: [args.ticketId],
      refundedBy: userId,
      lostProcessingFeeCents: nextLostProcessingFeeCents,
      auditAction: 'ticket.refund',
      auditSource: 'Single ticket refund',
      stripeReason: 'Admin refund single ticket',
      stripeIdempotencyKey: generateStripeIdempotencyKey(
        orderId,
        'refund-ticket',
        args.ticketId,
      ),
    });

    return {
      success: true,
      refundedAmount: refundAmount,
      lostProcessingFee: refundLostProcessingFeeCents,
    };
  },
});
