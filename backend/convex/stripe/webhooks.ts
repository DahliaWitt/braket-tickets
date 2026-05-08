import {v} from 'convex/values';
import {internal} from '../_generated/api';
import {internalMutation} from '../_generated/server';
import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  reapStaleWebhookClaims,
  releaseWebhookClaimForRetry,
  REAPER_BATCH_SIZE,
} from './_impl/webhook_claims';
import {
  claimDispositionValidator,
  webhookFailureReasonValidator,
  webhookOutcomeValidator,
} from '../lib/validators/stripe_webhooks';
import {logger} from '../lib/logger';
import {throwAppError} from '../lib/errors';

/**
 * Top-level registered mutations for the Stripe webhook claim row.
 *
 * These are thin wrappers around the domain functions in
 * `stripe/_impl/webhook_claims.ts`. The webhook handler action
 * (`stripe/actions.verifyAndProcessWebhook`) calls them via
 * `ctx.runMutation(...)` to get transactional atomicity around the
 * claim state machine:
 *
 *   claim → (handler side effect) → finalize
 *         \ (handler throws transient) → release → Stripe retry → claim
 *
 * Because each mutation runs serializably, concurrent deliveries of the
 * same `stripeEventId` cannot both observe an absent row and both insert.
 * The loser of the race sees `disposition: 'skip'` and returns without
 * performing the handler side effect.
 */

export const claimStripeWebhookEvent = internalMutation({
  args: {
    stripeEventId: v.string(),
    stripeEventType: v.string(),
    orderId: v.optional(v.id('ticket_orders')),
  },
  returns: claimDispositionValidator,
  handler: async (ctx, args) => {
    return await claimWebhookEvent(ctx.db, args);
  },
});

export const finalizeStripeWebhookEvent = internalMutation({
  args: {
    claimId: v.id('stripe_webhook_events'),
    outcome: webhookOutcomeValidator,
    orderId: v.optional(v.id('ticket_orders')),
    failureReason: webhookFailureReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Schema validators only verify the literal unions — they cannot
    // express "this field is required *iff* outcome === 'failed'". Guard
    // the invariant at runtime so a future caller can't finalize `failed`
    // without a bounded reason (which would produce `failureReason:
    // undefined` in ops queries).
    if (args.outcome === 'failed' && !args.failureReason) {
      throwAppError(
        'WEBHOOK_FINALIZE_FAILED_MISSING_REASON',
        'finalizeStripeWebhookEvent: failureReason is required when outcome is failed',
      );
    }
    if (args.outcome === 'completed') {
      await finalizeWebhookEvent(ctx.db, {
        claimId: args.claimId,
        outcome: 'completed',
        orderId: args.orderId,
      });
    } else {
      await finalizeWebhookEvent(ctx.db, {
        claimId: args.claimId,
        outcome: 'failed',
        // Non-null assertion justified by the runtime check above.
        failureReason: args.failureReason!,
        orderId: args.orderId,
      });
    }
    return null;
  },
});

/**
 * Release a claim so the next Stripe webhook retry reclaims it immediately.
 *
 * Called from the `withClaim` wrapper's catch block when a handler throws
 * a transient error. Without this, the next retry would observe `pending`
 * inside `STALE_CLAIM_THRESHOLD_MS` and skip as `in_flight`, wasting the
 * retry budget until the stale window elapsed.
 */
export const releaseStripeWebhookClaim = internalMutation({
  args: {
    claimId: v.id('stripe_webhook_events'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await releaseWebhookClaimForRetry(ctx.db, args);
    return null;
  },
});

export const reapStaleStripeWebhookClaims = internalMutation({
  args: {},
  returns: v.object({reaped: v.number()}),
  handler: async (ctx) => {
    const result = await reapStaleWebhookClaims(ctx.db, {
      batchSize: REAPER_BATCH_SIZE,
    });
    if (result.reaped > 0) {
      logger.warn(
        'stripe',
        'Reaped stale Stripe webhook claim rows; inspect stripe_webhook_events with status=failed and failureReason=stale_timeout',
        {reaped: result.reaped},
      );
    }
    // When we filled the batch, there's very likely more stale work. Queue
    // the next pass immediately so we don't sit on a backlog until the
    // next cron tick 30 min later. `ctx.scheduler.runAfter(0, ...)` runs
    // after the current mutation commits, so we can't storm the DB.
    if (result.reaped >= REAPER_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.stripe.webhooks.reapStaleStripeWebhookClaims,
        {},
      );
    }
    return result;
  },
});
