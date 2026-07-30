import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';

type WebhookClaimsDb = MutationCtx['db'];

/**
 * How long a `pending` claim row is trusted as "in flight".
 *
 * A fresh claim (less than this old) blocks concurrent re-entry: a second
 * webhook delivery observing a pending row within this window skips and
 * lets the original invocation finish. Past this threshold we assume the
 * original action crashed or lost its WebSocket, and allow a retry to
 * reclaim the row (incrementing `attempts`).
 *
 * Keep this larger than the longest expected handler runtime (Stripe
 * refund + ledger write + email enqueue) and smaller than Stripe's first
 * retry delay so retries can drive re-entry without operator action.
 */
export const STALE_CLAIM_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * How long a pending claim may live before the reaper promotes it to
 * `failed`. This is the poison-pill window — after this point the system
 * assumes the event cannot be processed and surfaces it for operator
 * inspection.
 *
 * Stripe's automatic retry schedule spans ~3 days (roughly 72h) from first
 * delivery to final give-up. The window must exceed that horizon so a row
 * is never promoted to `failed` while Stripe still has retries queued —
 * otherwise `claimWebhookEvent` would short-circuit the next retry as
 * `already_failed` and the ops team has to reprocess by hand. 96h (4 days)
 * leaves a one-day cushion past Stripe's final retry.
 */
export const REAPER_FAILURE_TIMEOUT_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * Hard cap on rows promoted to `failed` per reaper invocation. Bounds the
 * mutation so a large backlog cannot blow the Convex transaction budget.
 * The registered mutation re-queues itself when it fills the batch, so
 * lowering or raising this primarily affects per-run latency.
 */
export const REAPER_BATCH_SIZE = 100;

/**
 * Bounded set of reasons a claim can be marked `failed`. Kept in sync with
 * `lib/validators/stripe_webhooks.ts#webhookFailureReasonValidator` and the
 * schema's `failureReason` union so ops queries stay aggregable.
 */
export type WebhookFailureReason = 'stale_timeout' | 'order_not_found';

export type WebhookClaimDisposition =
  | {
      disposition: 'proceed';
      claimId: Id<'stripe_webhook_events'>;
      /**
       * `fresh`: this invocation is the first to observe the event.
       * `reclaimed_stale`: a previous attempt left the row pending past
       * STALE_CLAIM_THRESHOLD_MS and this invocation is taking over.
       */
      mode: 'fresh' | 'reclaimed_stale';
      attempts: number;
    }
  | {
      disposition: 'skip';
      reason: 'already_completed' | 'already_failed' | 'in_flight';
      existingClaimId: Id<'stripe_webhook_events'>;
    };

/**
 * Finalize-call args. Discriminated on `outcome` so the `failed` branch
 * makes `failureReason` required at the type level instead of leaving it
 * as a shared optional. The registered mutation also enforces this at
 * runtime (schema validators only get us literal-union checking).
 */
export type FinalizeWebhookEventArgs =
  | {
      claimId: Id<'stripe_webhook_events'>;
      outcome: 'completed';
      orderId?: Id<'ticket_orders'>;
    }
  | {
      claimId: Id<'stripe_webhook_events'>;
      outcome: 'failed';
      failureReason: WebhookFailureReason;
      orderId?: Id<'ticket_orders'>;
    };

async function findWebhookClaim(
  db: WebhookClaimsDb,
  stripeEventId: string,
): Promise<Doc<'stripe_webhook_events'> | null> {
  return await db
    .query('stripe_webhook_events')
    .withIndex('by_stripeEventId', (q) => q.eq('stripeEventId', stripeEventId))
    .unique();
}

/**
 * Claim a Stripe webhook event for processing.
 *
 * Called as the first step of every webhook handler. Convex mutations run
 * serializably, so two concurrent deliveries of the same event race on
 * the `by_stripeEventId` lookup and only one observes the absence of a
 * prior row. The loser sees a `pending` (or `completed`) row and returns
 * a `skip` disposition.
 *
 * Stale reclaim path: if a previous invocation left the row `pending`
 * older than `STALE_CLAIM_THRESHOLD_MS`, the current caller takes over
 * (bumping `attempts`). This lets Stripe's retry pipeline recover from
 * a crashed or timed-out action without operator intervention.
 */
export async function claimWebhookEvent(
  db: WebhookClaimsDb,
  args: {
    stripeEventId: string;
    stripeEventType: string;
    orderId?: Id<'ticket_orders'>;
  },
): Promise<WebhookClaimDisposition> {
  const now = Date.now();
  const existing = await findWebhookClaim(db, args.stripeEventId);

  if (!existing) {
    const claimId = await db.insert('stripe_webhook_events', {
      stripeEventId: args.stripeEventId,
      stripeEventType: args.stripeEventType,
      orderId: args.orderId,
      status: 'pending',
      claimedAt: now,
      attempts: 1,
    });
    return {
      disposition: 'proceed',
      claimId,
      mode: 'fresh',
      attempts: 1,
    };
  }

  if (existing.status === 'completed') {
    return {
      disposition: 'skip',
      reason: 'already_completed',
      existingClaimId: existing._id,
    };
  }

  if (existing.status === 'failed') {
    return {
      disposition: 'skip',
      reason: 'already_failed',
      existingClaimId: existing._id,
    };
  }

  // Pending: decide whether the prior attempt is still in-flight or stale.
  if (now - existing.claimedAt < STALE_CLAIM_THRESHOLD_MS) {
    return {
      disposition: 'skip',
      reason: 'in_flight',
      existingClaimId: existing._id,
    };
  }

  const nextAttempts = existing.attempts + 1;
  await db.patch('stripe_webhook_events', existing._id, {
    claimedAt: now,
    attempts: nextAttempts,
    stripeEventType: args.stripeEventType,
    orderId: args.orderId ?? existing.orderId,
  });
  return {
    disposition: 'proceed',
    claimId: existing._id,
    mode: 'reclaimed_stale',
    attempts: nextAttempts,
  };
}

/**
 * Mark a claimed webhook event as completed or failed.
 *
 * Called after the handler's side effects run to completion (or after a
 * terminal decision to give up). A handler that throws a TRANSIENT error
 * must use `releaseWebhookClaimForRetry` instead — finalizing `failed`
 * short-circuits future retries via the `already_failed` skip path.
 *
 * Idempotent against terminal rows. If the reaper promoted this claim to
 * `failed` while a slow handler was still running (a late finalize race),
 * we swallow the call rather than clobbering the reaper's state. Without
 * this, `withClaim`'s catch would try to release a row that no longer
 * accepts writes and the whole retry envelope would fall over.
 */
export async function finalizeWebhookEvent(
  db: WebhookClaimsDb,
  args: FinalizeWebhookEventArgs,
): Promise<void> {
  const existing = await db.get('stripe_webhook_events', args.claimId);
  if (!existing) {
    throw new Error(
      `finalizeWebhookEvent: claim ${args.claimId} not found; cannot finalize`,
    );
  }
  if (existing.status === 'completed' || existing.status === 'failed') {
    // Already terminal (most commonly: reaper got there first). Late
    // finalize is a no-op so the state machine remains monotonic.
    return;
  }

  const now = Date.now();
  if (args.outcome === 'completed') {
    await db.patch('stripe_webhook_events', args.claimId, {
      status: 'completed',
      completedAt: now,
      ...(args.orderId ? {orderId: args.orderId} : {}),
    });
    return;
  }

  await db.patch('stripe_webhook_events', args.claimId, {
    status: 'failed',
    failedAt: now,
    failureReason: args.failureReason,
    ...(args.orderId ? {orderId: args.orderId} : {}),
  });
}

/**
 * Release a pending claim so the next Stripe retry reclaims immediately.
 *
 * Stripe's first webhook retry lands in seconds-to-minutes after a 5xx —
 * well inside `STALE_CLAIM_THRESHOLD_MS`. Without this release, the retry
 * would see `pending` and skip as `in_flight`, forcing callers to wait
 * out the stale window for every transient handler error.
 *
 * We backdate `claimedAt` to exactly one `STALE_CLAIM_THRESHOLD_MS` in the
 * past rather than zeroing it. Two independent consumers read `claimedAt`:
 *
 *   1. `claimWebhookEvent` treats a pending row as reclaimable once
 *      `now - claimedAt >= STALE_CLAIM_THRESHOLD_MS`. Backdating by exactly
 *      the threshold means the very next delivery reclaims immediately —
 *      the in-flight window has just elapsed.
 *   2. `reapStaleWebhookClaims` promotes a pending row to `failed` once
 *      `claimedAt < now - REAPER_FAILURE_TIMEOUT_MS` (96h). A released row
 *      is only `STALE_CLAIM_THRESHOLD_MS` (5 min) old, so it stays far
 *      inside the reaper's failure window.
 *
 * Zeroing `claimedAt` (`claimedAt: 0`) would satisfy consumer 1 but poison
 * consumer 2: `0 < now - 96h` is trivially true, so the very next reaper
 * tick (≤30 min) would promote the just-released row to
 * `failed`/`stale_timeout`. `claimWebhookEvent` then short-circuits the
 * pending Stripe retry as `already_failed`, the HTTP endpoint ACKs 200, and
 * Stripe cancels its remaining retries — silently dropping a
 * payment-critical webhook. Backdating instead of zeroing preserves the
 * module invariant that a row is never promoted to `failed` while Stripe
 * still has retries queued (see `REAPER_FAILURE_TIMEOUT_MS`).
 *
 * `attempts` is deliberately NOT decremented — ops use it to distinguish
 * "first try failed, retrying" from "handler keeps throwing."
 */
export async function releaseWebhookClaimForRetry(
  db: WebhookClaimsDb,
  args: {claimId: Id<'stripe_webhook_events'>},
): Promise<void> {
  const reclaimableAt = Date.now() - STALE_CLAIM_THRESHOLD_MS;
  await db.patch('stripe_webhook_events', args.claimId, {
    claimedAt: reclaimableAt,
  });
}

/**
 * Promote stale `pending` claim rows to `failed`.
 *
 * Runs from a cron to bound the lifetime of abandoned claims. Anything
 * older than `REAPER_FAILURE_TIMEOUT_MS` is treated as a poison pill:
 * its handler either crashed repeatedly, or Stripe has stopped retrying
 * without the handler ever completing. The reaper does not delete rows —
 * ops uses `stripe_webhook_events` with `status = failed` to investigate.
 *
 * Patches run concurrently via `Promise.all` — the rows are independent
 * and share no write target, so OCC conflicts are impossible.
 */
export async function reapStaleWebhookClaims(
  db: WebhookClaimsDb,
  args: {
    batchSize?: number;
    failureTimeoutMs?: number;
  } = {},
): Promise<{reaped: number}> {
  const now = Date.now();
  const failureTimeoutMs = args.failureTimeoutMs ?? REAPER_FAILURE_TIMEOUT_MS;
  const cutoff = now - failureTimeoutMs;
  const limit = args.batchSize ?? REAPER_BATCH_SIZE;

  const stalePending = await db
    .query('stripe_webhook_events')
    .withIndex('by_status_and_claimedAt', (q) =>
      q.eq('status', 'pending').lt('claimedAt', cutoff),
    )
    .take(limit);

  await Promise.all(
    stalePending.map((row) =>
      db.patch('stripe_webhook_events', row._id, {
        status: 'failed',
        failedAt: now,
        failureReason: 'stale_timeout',
      }),
    ),
  );

  return {reaped: stalePending.length};
}
