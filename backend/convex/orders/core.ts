import {v} from 'convex/values';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import {
  orderFinancialEventKindValidator,
  ticketOrderKindValidator,
  ticketOrderStateValidator,
  tierValidator,
} from '../lib/validators/ticketing';
import {
  checkoutThemeModeValidator,
  checkoutSessionResultValidator,
  checkoutStatusValidator,
  listMyOrdersValidator,
  openOrderResultValidator,
  ticketOrderDocValidator,
} from '../lib/orders/validators';
import {
  openHandler,
  openForGuestHandler,
  openResaleHandler,
  claimFreeTicketHandler,
  claimFreeTicketAsGuestHandler,
  startCheckoutHandler,
  syncCheckoutSessionHandler,
  getCheckoutStatusHandler,
  listMyOrdersHandler,
  getInternalHandler,
  normalizeTicketOrderIdHandler,
  getByCheckoutSessionIdHandler,
  getByStripePaymentIntentIdHandler,
  bindCheckoutSessionHandler,
  expireHandler,
  releaseForPaymentFailureHandler,
  prepareStripeOrderSettlementHandler,
  settlePaidOrderFromStripeHandler,
  markLateInvalidRefundedHandler,
  recordFinancialEventHandler,
  applyExternalRefundHandler,
  clearCheckoutSessionHandler,
  cancelOpenOrdersForEventHandler,
  getHeldInventoryReconciliationHandler,
  repairHeldInventoryCountHandler,
} from './_impl/core_handlers';

const checkoutFailureStageValidator = v.union(
  v.literal('account_setup'),
  v.literal('checkout_session'),
  v.literal('payment_intent'),
);

export const open = mutation({
  args: {
    eventId: v.id('events'),
    quantity: v.number(),
    tier: tierValidator,
    totalAmount: v.number(),
  },
  returns: openOrderResultValidator,
  handler: openHandler,
});

export const openForGuest = mutation({
  args: {
    sessionToken: v.string(),
    eventId: v.id('events'),
    quantity: v.number(),
    tier: tierValidator,
    totalAmount: v.number(),
  },
  returns: openOrderResultValidator,
  handler: openForGuestHandler,
});

export const openResale = mutation({
  args: {
    eventId: v.id('events'),
    tier: tierValidator,
    totalAmount: v.number(),
  },
  returns: openOrderResultValidator,
  handler: openResaleHandler,
});

export const claimFreeTicket = mutation({
  args: {
    eventId: v.id('events'),
    quantity: v.number(),
    tier: tierValidator,
  },
  returns: v.object({success: v.boolean(), orderId: v.id('ticket_orders')}),
  handler: claimFreeTicketHandler,
});

export const claimFreeTicketAsGuest = mutation({
  args: {
    sessionToken: v.string(),
    eventId: v.id('events'),
    quantity: v.number(),
    tier: tierValidator,
  },
  returns: v.object({success: v.boolean(), orderId: v.id('ticket_orders')}),
  handler: claimFreeTicketAsGuestHandler,
});

export const startCheckout = action({
  args: {
    orderId: v.id('ticket_orders'),
    checkoutTheme: v.optional(checkoutThemeModeValidator),
    sessionToken: v.optional(v.string()),
  },
  returns: checkoutSessionResultValidator,
  handler: startCheckoutHandler,
});

export const syncCheckoutSession = action({
  args: {
    checkoutSessionId: v.string(),
    sessionToken: v.optional(v.string()),
  },
  returns: checkoutStatusValidator,
  handler: syncCheckoutSessionHandler,
});

export const getCheckoutStatus = query({
  args: {
    orderId: v.id('ticket_orders'),
    sessionToken: v.optional(v.string()),
  },
  returns: checkoutStatusValidator,
  handler: getCheckoutStatusHandler,
});

export const listMyOrders = query({
  args: {},
  returns: listMyOrdersValidator,
  handler: listMyOrdersHandler,
});

export const getInternal = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: v.union(ticketOrderDocValidator, v.null()),
  handler: getInternalHandler,
});

const inventoryHoldReconciliationValidator = v.object({
  eventId: v.id('events'),
  inventoryId: v.id('event_inventory'),
  title: v.string(),
  storedHeldCount: v.number(),
  openPrimaryHeldCount: v.number(),
  drift: v.number(),
});

export const getHeldInventoryReconciliation = internalQuery({
  args: {eventId: v.id('events')},
  returns: inventoryHoldReconciliationValidator,
  handler: getHeldInventoryReconciliationHandler,
});

export const repairHeldInventoryCount = internalMutation({
  args: {
    eventId: v.id('events'),
    expectedStoredHeldCount: v.optional(v.number()),
  },
  returns: v.object({
    eventId: v.id('events'),
    inventoryId: v.id('event_inventory'),
    title: v.string(),
    storedHeldCount: v.number(),
    openPrimaryHeldCount: v.number(),
    drift: v.number(),
    repaired: v.boolean(),
  }),
  handler: repairHeldInventoryCountHandler,
});

/**
 * Validate a raw candidate string as a `ticket_orders` id.
 *
 * Called from Node-runtime webhook dispatch where we receive the candidate
 * from Stripe metadata / `client_reference_id` and have no access to the
 * Convex runtime's `ctx.db.normalizeId`. Returns `null` for any value that
 * isn't a well-formed id for this table, which lets the handler short-circuit
 * gracefully instead of letting `ctx.db.get(...)` throw and leave the
 * webhook claim row pending until the reaper.
 *
 * Prefer this over any custom "looks like an id" heuristic: production ids
 * are opaque 32-char base32 strings with no table suffix; fixture ids in
 * convex-test include a `;<tableName>` suffix. `normalizeId` handles both.
 */
export const normalizeTicketOrderId = internalQuery({
  args: {candidate: v.string()},
  returns: v.union(v.id('ticket_orders'), v.null()),
  handler: normalizeTicketOrderIdHandler,
});

export const getByCheckoutSessionId = internalQuery({
  args: {stripeCheckoutSessionId: v.string()},
  returns: v.union(ticketOrderDocValidator, v.null()),
  handler: getByCheckoutSessionIdHandler,
});

export const getByStripePaymentIntentId = internalQuery({
  args: {stripePaymentIntentId: v.string()},
  returns: v.union(ticketOrderDocValidator, v.null()),
  handler: getByStripePaymentIntentIdHandler,
});

export const bindCheckoutSession = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    stripeCheckoutSessionId: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: checkoutSessionResultValidator,
  handler: bindCheckoutSessionHandler,
});

export const expire = internalMutation({
  args: {orderId: v.id('ticket_orders'), force: v.optional(v.boolean())},
  returns: v.null(),
  handler: expireHandler,
});

export const releaseForPaymentFailure = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    errorCode: v.optional(v.string()),
    failureStage: v.optional(checkoutFailureStageValidator),
  },
  returns: v.null(),
  handler: releaseForPaymentFailureHandler,
});

const stripeOrderSettlementResultValidator = v.object({
  orderId: v.id('ticket_orders'),
  state: ticketOrderStateValidator,
  kind: ticketOrderKindValidator,
  expiresAt: v.number(),
  completedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  outcome: v.union(
    v.literal('completed'),
    v.literal('refund_required'),
    v.literal('already_refunded'),
  ),
  eventId: v.optional(v.id('events')),
  refundedAmountCents: v.optional(v.number()),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
});

export const prepareStripeOrderSettlement = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: stripeOrderSettlementResultValidator,
  handler: prepareStripeOrderSettlementHandler,
});

export const settlePaidOrderFromStripe = internalAction({
  args: {
    orderId: v.id('ticket_orders'),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: checkoutStatusValidator,
  handler: settlePaidOrderFromStripeHandler,
});

export const markLateInvalidRefunded = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    stripeRefundId: v.string(),
    stripeEventId: v.optional(v.string()),
    refundedAmountCents: v.number(),
    processorFeeCents: v.optional(v.number()),
    platformFeeCents: v.optional(v.number()),
    connectedAccountNetCents: v.optional(v.number()),
  },
  returns: v.null(),
  handler: markLateInvalidRefundedHandler,
});

export const recordFinancialEvent = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    eventId: v.id('events'),
    kind: orderFinancialEventKindValidator,
    amountCents: v.optional(v.number()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeRefundId: v.optional(v.string()),
    stripeDisputeId: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    connectedAccountId: v.optional(v.string()),
    processorFeeCents: v.optional(v.number()),
    platformFeeCents: v.optional(v.number()),
    connectedAccountNetCents: v.optional(v.number()),
    note: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: recordFinancialEventHandler,
});

export const applyExternalRefund = internalMutation({
  args: {
    orderId: v.id('ticket_orders'),
    refundedAmountCents: v.number(),
    stripeRefundId: v.optional(v.string()),
    ledgerRefundAmountCents: v.optional(v.number()),
    stripeEventId: v.optional(v.string()),
    ticketIdsToRefund: v.optional(v.array(v.id('tickets'))),
    refundedBy: v.optional(v.id('users')),
    lostProcessingFeeCents: v.optional(v.number()),
    processorFeeCents: v.optional(v.number()),
    platformFeeCents: v.optional(v.number()),
    connectedAccountNetCents: v.optional(v.number()),
    auditAction: v.optional(
      v.union(
        v.literal('payment.refund'),
        v.literal('payment.force-refund-all'),
        v.literal('ticket.refund'),
      ),
    ),
    auditSource: v.optional(v.string()),
  },
  returns: v.null(),
  handler: applyExternalRefundHandler,
});

export const clearCheckoutSession = internalMutation({
  args: {orderId: v.id('ticket_orders')},
  returns: v.null(),
  handler: clearCheckoutSessionHandler,
});

export const cancelOpenOrdersForEvent = internalMutation({
  args: {eventId: v.id('events')},
  returns: v.number(),
  handler: cancelOpenOrdersForEventHandler,
});
