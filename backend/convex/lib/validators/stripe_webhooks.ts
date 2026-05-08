import {v} from 'convex/values';

/**
 * Shared validators for the Stripe webhook claim state machine.
 *
 * Centralized here (rather than inline in `stripe/webhooks.ts`) so any future
 * caller — admin replay tools, HTTP webhook entry points, cross-service
 * dispatcher — references the same union shape. Per
 * `backend/convex/CLAUDE.md`: "Repeated literal unions and return-shape
 * fragments must be centralized instead of redefined across files."
 */

/**
 * Terminal status values persisted on a `stripe_webhook_events` row.
 *
 * Lifecycle:
 *   (none) → pending → completed
 *                    → failed
 */
export const webhookClaimStatusValidator = v.union(
  v.literal('pending'),
  v.literal('completed'),
  v.literal('failed'),
);

/**
 * Outcome passed to `finalizeWebhookEvent`. A transient handler error does
 * NOT use `failed` — see `releaseStripeWebhookClaim` for the retry path.
 */
export const webhookOutcomeValidator = v.union(
  v.literal('completed'),
  v.literal('failed'),
);

/**
 * Bounded failure-reason enum. Keeping this a union (not free-text) lets
 * ops dashboards index and aggregate by reason instead of grep-matching
 * arbitrary strings.
 *
 * Extend deliberately: any new reason needs a schema deploy so the
 * `stripe_webhook_events.failureReason` field stays bounded.
 *
 * Convention: `*ValueValidator` is the bare union, `*Validator` is the
 * pre-wrapped optional — matches `lib/validators/events.ts` and
 * `lib/validators/communities.ts`.
 */
export const webhookFailureReasonValueValidator = v.union(
  /** Row sat in `pending` past `REAPER_FAILURE_TIMEOUT_MS`. */
  v.literal('stale_timeout'),
  /**
   * Event payload referenced an order that no longer exists or never did,
   * or could not be linked to one (missing metadata / no PaymentIntent).
   * Terminal because retrying will never produce the order.
   */
  v.literal('order_not_found'),
);

export const webhookFailureReasonValidator = v.optional(
  webhookFailureReasonValueValidator,
);

/**
 * Return shape of `claimWebhookEvent`. Describes both branches of the race:
 * either the caller won the claim (`proceed`) and should run the side
 * effect, or a prior caller already took it (`skip`).
 */
export const claimDispositionValidator = v.union(
  v.object({
    disposition: v.literal('proceed'),
    claimId: v.id('stripe_webhook_events'),
    /**
     * `fresh`: this invocation is the first to observe the event.
     * `reclaimed_stale`: a previous attempt left the row pending past
     * `STALE_CLAIM_THRESHOLD_MS` and this invocation is taking over.
     */
    mode: v.union(v.literal('fresh'), v.literal('reclaimed_stale')),
    attempts: v.number(),
  }),
  v.object({
    disposition: v.literal('skip'),
    reason: v.union(
      v.literal('already_completed'),
      v.literal('already_failed'),
      v.literal('in_flight'),
    ),
    existingClaimId: v.id('stripe_webhook_events'),
  }),
);
