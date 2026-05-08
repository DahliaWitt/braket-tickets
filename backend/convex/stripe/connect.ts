import {internalMutation, internalQuery} from '../_generated/server';
import {v} from 'convex/values';
import {
  communityAdminStripeFields,
  communityViewerFields,
} from '../lib/communities/validators';
import {onboardingStatusValidator} from '../lib/validators/stripe_connect';
import {
  confirmPayoutImpl,
  createPayoutIntentImpl,
  failPayoutImpl,
  getOrderByStripePaymentIntentIdImpl,
  getOrganizerInternalImpl,
  getSettlementDataForAccountImpl,
  listConnectedAccountsWithEligibleEventsImpl,
  listPlatformOrganizerEligibleEventIdsImpl,
  markEventPaidOutImpl,
  markPayoutBatchSubmittedImpl,
  markPayoutSettingsVerifiedImpl,
  storeConnectedAccountIdImpl,
  updateOrganizerFromStripeAccountImpl,
} from './_impl/connect';

export const getOrganizerInternal = internalQuery({
  args: {organizerId: v.id('organizers')},
  returns: v.union(
    v.object({
      _id: v.id('organizers'),
      _creationTime: v.number(),
      ...communityViewerFields,
      ...communityAdminStripeFields,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await getOrganizerInternalImpl(ctx, args);
  },
});

export const storeConnectedAccountId = internalMutation({
  args: {
    organizerId: v.id('organizers'),
    stripeConnectedAccountId: v.string(),
    onboardingStatus: v.optional(onboardingStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await storeConnectedAccountIdImpl(ctx, args);
  },
});

export const markPayoutSettingsVerified = internalMutation({
  args: {
    organizerId: v.id('organizers'),
    stripeConnectedAccountId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await markPayoutSettingsVerifiedImpl(ctx, args);
  },
});

export const updateOrganizerFromStripeAccount = internalMutation({
  args: {
    stripeConnectedAccountId: v.string(),
    onboardingStatus: onboardingStatusValidator,
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    currentlyDue: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await updateOrganizerFromStripeAccountImpl(ctx, args);
  },
});

export const getSettlementDataForAccount = internalQuery({
  args: {
    stripeConnectedAccountId: v.string(),
    eligibleBeforeMs: v.number(),
  },
  returns: v.object({
    organizerId: v.union(v.id('organizers'), v.null()),
    events: v.array(
      v.object({
        _id: v.id('events'),
        date: v.number(),
        eligible: v.boolean(),
        title: v.string(),
      }),
    ),
    financialEvents: v.array(
      v.object({
        eventId: v.id('events'),
        kind: v.string(),
        connectedAccountNetCents: v.optional(v.number()),
      }),
    ),
    confirmedAllocations: v.array(
      v.object({
        eventId: v.id('events'),
        amountCents: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await getSettlementDataForAccountImpl(ctx, args);
  },
});

export const listConnectedAccountsWithEligibleEvents = internalQuery({
  args: {
    eligibleBeforeMs: v.number(),
    limit: v.number(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    return await listConnectedAccountsWithEligibleEventsImpl(ctx, args);
  },
});

export const listPlatformOrganizerEligibleEventIds = internalQuery({
  args: {
    eligibleBeforeMs: v.number(),
    limit: v.number(),
  },
  returns: v.array(v.id('events')),
  handler: async (ctx, args) => {
    return await listPlatformOrganizerEligibleEventIdsImpl(ctx, args);
  },
});

export const createPayoutIntent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    connectedAccountId: v.string(),
    amountCents: v.number(),
    currency: v.literal('usd'),
    allocations: v.array(
      v.object({
        eventId: v.id('events'),
        amountCents: v.number(),
      }),
    ),
  },
  returns: v.object({
    batchId: v.id('payout_batches'),
    idempotencyKey: v.string(),
    amountCents: v.number(),
    currency: v.literal('usd'),
    status: v.union(
      v.literal('pending'),
      v.literal('submitted'),
      v.literal('paid'),
      v.literal('failed'),
    ),
    stripePayoutId: v.optional(v.string()),
    reused: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await createPayoutIntentImpl(ctx, args);
  },
});

export const markPayoutBatchSubmitted = internalMutation({
  args: {
    batchId: v.id('payout_batches'),
    stripePayoutId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await markPayoutBatchSubmittedImpl(ctx, args);
  },
});

export const confirmPayout = internalMutation({
  args: {stripePayoutId: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    return await confirmPayoutImpl(ctx, args);
  },
});

export const failPayout = internalMutation({
  args: {
    stripePayoutId: v.string(),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await failPayoutImpl(ctx, args);
  },
});

export const markEventPaidOut = internalMutation({
  args: {
    eventId: v.id('events'),
    payoutAmountCents: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await markEventPaidOutImpl(ctx, args);
  },
});

export const getOrderByStripePaymentIntentId = internalQuery({
  args: {
    stripePaymentIntentId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('ticket_orders'),
      userId: v.optional(v.id('users')),
      guestSessionId: v.optional(v.id('guest_sessions')),
      status: v.string(),
      amountCents: v.number(),
      eventId: v.id('events'),
      stripeChargeId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await getOrderByStripePaymentIntentIdImpl(ctx, args);
  },
});
