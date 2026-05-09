'use node';

/* eslint-disable @convex-dev/import-wrong-runtime -- Stripe actions run in the Node runtime and delegate to Node-only implementation helpers. */

import {action, internalAction} from '../_generated/server';
import {v} from 'convex/values';
import {
  checkoutStatusValidator,
  checkoutThemeModeValidator,
} from '../lib/orders/validators';
import {connectedAccountStatusFields} from '../lib/validators/stripe_connect';
import {
  checkAccountStatusImpl,
  createAccountOnboardingLinkImpl,
  createAccountSessionImpl,
  createConnectedAccountImpl,
  processScheduledPayoutsImpl,
  processStripeRefundImpl,
  refreshConnectedAccountStatusImpl,
  startTicketOrderCheckoutSessionImpl,
  syncTicketOrderCheckoutSessionImpl,
  verifyAndProcessConnectWebhookImpl,
  verifyAndProcessV2EventNotificationImpl,
  verifyAndProcessWebhookImpl,
} from './_impl/actions';

export const startTicketOrderCheckoutSession = internalAction({
  args: {
    orderId: v.id('ticket_orders'),
    checkoutTheme: v.optional(checkoutThemeModeValidator),
    sessionToken: v.optional(v.string()),
  },
  returns: v.object({
    orderId: v.id('ticket_orders'),
    clientSecret: v.string(),
    stripeCheckoutSessionId: v.string(),
    expiresAt: v.number(),
    connectedAccountId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await startTicketOrderCheckoutSessionImpl(ctx, args);
  },
});

export const syncTicketOrderCheckoutSession = internalAction({
  args: {
    checkoutSessionId: v.string(),
    sessionToken: v.optional(v.string()),
  },
  returns: checkoutStatusValidator,
  handler: async (ctx, args) => {
    return await syncTicketOrderCheckoutSessionImpl(ctx, args);
  },
});

export const processStripeRefund = internalAction({
  args: {
    paymentIntentId: v.string(),
    amountCents: v.number(),
    reason: v.optional(v.string()),
    idempotencyKey: v.string(),
    connectedAccountId: v.optional(v.string()),
    refundApplicationFee: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    refundId: v.string(),
    processorFeeCents: v.optional(v.number()),
    platformFeeCents: v.optional(v.number()),
    connectedAccountNetCents: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    return await processStripeRefundImpl(ctx, args);
  },
});

export const createConnectedAccount = action({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.object({
    stripeConnectedAccountId: v.string(),
    alreadyExists: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await createConnectedAccountImpl(ctx, args);
  },
});

export const createAccountSession = action({
  args: {
    organizerId: v.id('organizers'),
    components: v.object({
      accountOnboarding: v.optional(v.boolean()),
      accountManagement: v.optional(v.boolean()),
      notificationBanner: v.optional(v.boolean()),
      payments: v.optional(v.boolean()),
      balances: v.optional(v.boolean()),
      documents: v.optional(v.boolean()),
    }),
  },
  returns: v.object({clientSecret: v.string()}),
  handler: async (ctx, args) => {
    return await createAccountSessionImpl(ctx, args);
  },
});

export const createAccountOnboardingLink = action({
  args: {
    organizerId: v.id('organizers'),
    returnOrigin: v.optional(v.string()),
  },
  returns: v.object({url: v.string()}),
  handler: async (ctx, args) => {
    return await createAccountOnboardingLinkImpl(ctx, args);
  },
});

export const checkAccountStatus = action({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.object({
    ...connectedAccountStatusFields,
    chargeReady: v.boolean(),
    payoutReady: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await checkAccountStatusImpl(ctx, args);
  },
});

export const verifyAndProcessWebhook = internalAction({
  args: {payload: v.string(), signature: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    return await verifyAndProcessWebhookImpl(ctx, args);
  },
});

export const verifyAndProcessConnectWebhook = internalAction({
  args: {payload: v.string(), signature: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    return await verifyAndProcessConnectWebhookImpl(ctx, args);
  },
});

export const refreshConnectedAccountStatus = internalAction({
  args: {stripeConnectedAccountId: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    return await refreshConnectedAccountStatusImpl(ctx, args);
  },
});

export const verifyAndProcessV2EventNotification = internalAction({
  args: {payload: v.string(), signature: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    return await verifyAndProcessV2EventNotificationImpl(ctx, args);
  },
});

export const processScheduledPayouts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    return await processScheduledPayoutsImpl(ctx);
  },
});
