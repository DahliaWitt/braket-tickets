import {v} from 'convex/values';
import {
  callerTrustSourceValidator,
  disputeStatusValidator,
  orderFinancialEventKindValidator,
  ticketOrderKindValidator,
  ticketOrderReleaseReasonValidator,
  ticketOrderStateValidator,
  tierValidator,
} from '../../lib/validators/ticketing';

export type CheckoutThemeMode = 'light' | 'dark';

export const checkoutThemeModeValidator = v.union(
  v.literal('light'),
  v.literal('dark'),
);

export const ticketOrderDocFields = {
  _id: v.id('ticket_orders'),
  _creationTime: v.number(),
  userId: v.optional(v.id('users')),
  guestSessionId: v.optional(v.id('guest_sessions')),
  eventId: v.id('events'),
  kind: ticketOrderKindValidator,
  resaleListingId: v.optional(v.id('resale_listings')),
  quantity: v.number(),
  tier: tierValidator,
  amountCents: v.number(),
  currency: v.literal('USD'),
  state: ticketOrderStateValidator,
  releaseReason: v.optional(ticketOrderReleaseReasonValidator),
  expiresAt: v.number(),
  completedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  stripeCheckoutSessionId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  /**
   * Connected account snapshot for direct-charge orders; absent on platform
   * events. Read by checkout sync, refund processing, and ledger recording
   * so nothing downstream has to re-query the organizer to discover which
   * Stripe account owns the charge.
   */
  connectedAccountId: v.optional(v.string()),
  trustSource: callerTrustSourceValidator,
  trustViaOrganizerId: v.optional(v.id('organizers')),
  // ToS assent evidence for guest purchases (BRA-455)
  tosAcceptedAt: v.optional(v.number()),
  tosVersion: v.optional(v.string()),
};

export const ticketOrderDocValidator = v.object(ticketOrderDocFields);

export const eventInventoryDocValidator = v.object({
  _id: v.id('event_inventory'),
  _creationTime: v.number(),
  eventId: v.id('events'),
  soldCount: v.number(),
  heldCount: v.number(),
});

export const orderFinancialEventDocValidator = v.object({
  _id: v.id('order_financial_events'),
  _creationTime: v.number(),
  orderId: v.id('ticket_orders'),
  eventId: v.id('events'),
  currency: v.literal('USD'),
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
  occurredAt: v.number(),
});

export const openOrderResultValidator = v.object({
  orderId: v.id('ticket_orders'),
  expiresAt: v.number(),
  state: ticketOrderStateValidator,
});

export const checkoutSessionResultValidator = v.object({
  orderId: v.id('ticket_orders'),
  clientSecret: v.string(),
  stripeCheckoutSessionId: v.string(),
  expiresAt: v.number(),
  /**
   * Connected account id when the checkout runs on a promoter's connected
   * account. Null for platform-owned events. The frontend passes this to
   * `loadStripe(publishableKey, {stripeAccount})` so Elements resolves on
   * the correct account.
   */
  connectedAccountId: v.union(v.string(), v.null()),
});

export const checkoutStatusValidator = v.object({
  orderId: v.id('ticket_orders'),
  state: ticketOrderStateValidator,
  kind: ticketOrderKindValidator,
  expiresAt: v.number(),
  completedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
});

export const ticketOrderSummaryValidator = v.object({
  _id: v.id('ticket_orders'),
  eventId: v.id('events'),
  kind: ticketOrderKindValidator,
  state: ticketOrderStateValidator,
  quantity: v.number(),
  tier: tierValidator,
  amountCents: v.number(),
  expiresAt: v.number(),
  completedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  releaseReason: v.optional(ticketOrderReleaseReasonValidator),
});

export const listMyOrdersValidator = v.array(ticketOrderSummaryValidator);

export const orderDisputeStatusValidator = v.union(
  disputeStatusValidator,
  v.null(),
);
