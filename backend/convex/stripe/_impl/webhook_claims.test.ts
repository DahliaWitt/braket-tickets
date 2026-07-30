import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import {convexTest} from '../../setup.testing';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {
  REAPER_BATCH_SIZE,
  REAPER_FAILURE_TIMEOUT_MS,
  STALE_CLAIM_THRESHOLD_MS,
  claimWebhookEvent,
  finalizeWebhookEvent,
  reapStaleWebhookClaims,
  releaseWebhookClaimForRetry,
} from './webhook_claims';
import {appendFinancialEvent} from '../../lib/orders/financial_events';

/**
 * Covers the `stripe_webhook_events` state machine and the ledger-level
 * defense-in-depth dedup in `appendFinancialEvent`. The model functions
 * are exercised directly via `t.run(ctx => ...)` — no action wrapping —
 * because they are deterministic and we want to assert against raw DB
 * state. The registered top-level mutations are smoke-tested separately.
 *
 * Time is controlled with `vi.useFakeTimers()` + `vi.setSystemTime(...)`
 * rather than an injected `now` parameter, matching the production code
 * shape (model functions read `Date.now()` directly).
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedOrderWithoutLedger(
  t: ReturnType<typeof convexTest>,
  suffix: string,
): Promise<{orderId: Id<'ticket_orders'>; eventId: Id<'events'>}> {
  // Use production seed helpers so we exercise the real insert shape. We
  // pick `status: 'pending'` because that path skips the auto-insert of
  // the `payment_captured` financial event — leaving a zero-ledger order
  // for the dedup assertions below.
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: `Ledger Org ${suffix}`,
    email: `org-${suffix}@example.com`,
    isPlatformOrganizer: true,
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: `Ledger Event ${suffix}`,
    date: '2030-12-15T12:00:00.000Z',
    price: 1000,
    organizerId,
    visibility: 'public',
  });
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    email: `ledger-user-${suffix}@example.com`,
    name: `Ledger User ${suffix}`,
  });
  const orderId = await t.mutation(api.testing.orders.seedPayment, {
    userId,
    eventId,
    amount: 1000,
    status: 'pending',
    trustSource: 'direct',
  });
  return {orderId, eventId};
}

describe('claimWebhookEvent', () => {
  it('inserts a pending row for a fresh event and reports fresh disposition', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const disposition = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_fresh_1',
        stripeEventType: 'checkout.session.completed',
      }),
    );

    expect(disposition.disposition).toBe('proceed');
    if (disposition.disposition !== 'proceed') return;
    expect(disposition.mode).toBe('fresh');
    expect(disposition.attempts).toBe(1);

    const row = await t.run((ctx) => ctx.db.get(disposition.claimId));
    expect(row?.status).toBe('pending');
    expect(row?.claimedAt).toBe(1_000);
    expect(row?.attempts).toBe(1);
    expect(row?.stripeEventId).toBe('evt_fresh_1');
  });

  it('skips a second concurrent claim within the stale threshold as in_flight', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const first = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_race_1',
        stripeEventType: 'payment_intent.succeeded',
      }),
    );

    vi.setSystemTime(new Date(1_000 + STALE_CLAIM_THRESHOLD_MS - 1));
    const second = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_race_1',
        stripeEventType: 'payment_intent.succeeded',
      }),
    );

    expect(second.disposition).toBe('skip');
    if (second.disposition !== 'skip') return;
    expect(second.reason).toBe('in_flight');
    if (first.disposition !== 'proceed')
      throw new Error('first should proceed');
    expect(second.existingClaimId).toBe(first.claimId);
  });

  it('reclaims a pending row past the stale threshold and bumps attempts', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const first = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_stale_1',
        stripeEventType: 'charge.refunded',
      }),
    );

    vi.setSystemTime(new Date(1_000 + STALE_CLAIM_THRESHOLD_MS + 1));
    const second = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_stale_1',
        stripeEventType: 'charge.refunded',
      }),
    );

    expect(second.disposition).toBe('proceed');
    if (second.disposition !== 'proceed') return;
    expect(second.mode).toBe('reclaimed_stale');
    expect(second.attempts).toBe(2);
    if (first.disposition !== 'proceed')
      throw new Error('first should proceed');
    expect(second.claimId).toBe(first.claimId);

    const row = await t.run((ctx) => ctx.db.get(second.claimId));
    expect(row?.claimedAt).toBe(1_000 + STALE_CLAIM_THRESHOLD_MS + 1);
    expect(row?.attempts).toBe(2);
  });

  it('short-circuits when an event is already completed', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const claim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_done_1',
        stripeEventType: 'charge.dispute.closed',
      }),
    );
    if (claim.disposition !== 'proceed') throw new Error('expected proceed');

    vi.setSystemTime(new Date(1_500));
    await t.run((ctx) =>
      finalizeWebhookEvent(ctx.db, {
        claimId: claim.claimId,
        outcome: 'completed',
      }),
    );

    vi.setSystemTime(new Date(2_000));
    const retry = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_done_1',
        stripeEventType: 'charge.dispute.closed',
      }),
    );

    expect(retry.disposition).toBe('skip');
    if (retry.disposition !== 'skip') return;
    expect(retry.reason).toBe('already_completed');
  });

  it('short-circuits when an event is already failed (reaper poison-pill)', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const claim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_failed_1',
        stripeEventType: 'payment_intent.payment_failed',
      }),
    );
    if (claim.disposition !== 'proceed') throw new Error('expected proceed');

    vi.setSystemTime(new Date(1_500));
    await t.run((ctx) =>
      finalizeWebhookEvent(ctx.db, {
        claimId: claim.claimId,
        outcome: 'failed',
        failureReason: 'stale_timeout',
      }),
    );

    vi.setSystemTime(new Date(2_000));
    const retry = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_failed_1',
        stripeEventType: 'payment_intent.payment_failed',
      }),
    );

    expect(retry.disposition).toBe('skip');
    if (retry.disposition !== 'skip') return;
    expect(retry.reason).toBe('already_failed');
  });
});

describe('finalizeWebhookEvent', () => {
  it('marks a claim completed with timestamp and optional orderId', async () => {
    const t = convexTest();

    const {orderId} = await seedOrderWithoutLedger(t, 'finalize-ok');

    vi.setSystemTime(new Date(1_000));
    const claim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_fin_1',
        stripeEventType: 'account.updated',
      }),
    );
    if (claim.disposition !== 'proceed') throw new Error('expected proceed');

    vi.setSystemTime(new Date(1_500));
    await t.run((ctx) =>
      finalizeWebhookEvent(ctx.db, {
        claimId: claim.claimId,
        outcome: 'completed',
        orderId,
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(claim.claimId));
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).toBe(1_500);
    expect(row?.orderId).toBe(orderId);
  });

  it('marks a claim failed with failure reason', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(1_000));
    const claim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_fin_fail_1',
        stripeEventType: 'charge.refunded',
      }),
    );
    if (claim.disposition !== 'proceed') throw new Error('expected proceed');

    vi.setSystemTime(new Date(1_500));
    await t.run((ctx) =>
      finalizeWebhookEvent(ctx.db, {
        claimId: claim.claimId,
        outcome: 'failed',
        failureReason: 'order_not_found',
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(claim.claimId));
    expect(row?.status).toBe('failed');
    expect(row?.failedAt).toBe(1_500);
    expect(row?.failureReason).toBe('order_not_found');
  });
});

describe('releaseWebhookClaimForRetry', () => {
  it('backdates claimedAt by the stale threshold so the next call reclaims immediately', async () => {
    const t = convexTest();

    // Use a production-scale base timestamp. The release backdates
    // `claimedAt` to `now - STALE_CLAIM_THRESHOLD_MS`; the claim freshness
    // check is `now - claimedAt < STALE_CLAIM_THRESHOLD_MS`. In production
    // `Date.now()` is always ~1.7e12, so the backdated value is a large
    // positive number well clear of the reaper cutoff.
    const base = 1_700_000_000_000;

    vi.setSystemTime(new Date(base));
    const first = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_release_1',
        stripeEventType: 'payment_intent.succeeded',
      }),
    );
    if (first.disposition !== 'proceed') throw new Error('expected proceed');

    // Handler "throws" — wrapper releases the claim.
    const releaseAt = base + 100;
    vi.setSystemTime(new Date(releaseAt));
    await t.run((ctx) =>
      releaseWebhookClaimForRetry(ctx.db, {claimId: first.claimId}),
    );

    const released = await t.run((ctx) => ctx.db.get(first.claimId));
    // Backdated by exactly one stale window, NOT zeroed. A zeroed
    // `claimedAt` would be reaped as `stale_timeout` on the next cron tick.
    expect(released?.claimedAt).toBe(releaseAt - STALE_CLAIM_THRESHOLD_MS);
    expect(released?.status).toBe('pending');

    // Stripe retries ~200ms later. Relative to the backdated `claimedAt`,
    // `now - claimedAt` already exceeds STALE_CLAIM_THRESHOLD_MS, so the
    // retry reclaims via the stale path. Without the release, this call
    // would skip as `in_flight`.
    vi.setSystemTime(new Date(base + 200));
    const retry = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_release_1',
        stripeEventType: 'payment_intent.succeeded',
      }),
    );

    expect(retry.disposition).toBe('proceed');
    if (retry.disposition !== 'proceed') return;
    expect(retry.mode).toBe('reclaimed_stale');
    expect(retry.attempts).toBe(2);
    expect(retry.claimId).toBe(first.claimId);
  });

  it('survives a reaper pass after release and stays reclaimable by a later Stripe retry', async () => {
    // Regression guard for the reaper-poisoning bug: a claim released for
    // retry must NOT be promoted to `failed` by the reaper before Stripe's
    // next retry lands, or that retry short-circuits as `already_failed` and
    // Stripe's retry schedule is silently cancelled (lost payment webhook).
    const t = convexTest();

    const base = 1_700_000_000_000;

    // Claim, then handler throws → release.
    vi.setSystemTime(new Date(base));
    const first = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_release_reaper_1',
        stripeEventType: 'checkout.session.completed',
      }),
    );
    if (first.disposition !== 'proceed') throw new Error('expected proceed');

    vi.setSystemTime(new Date(base + 100));
    await t.run((ctx) =>
      releaseWebhookClaimForRetry(ctx.db, {claimId: first.claimId}),
    );

    // Reaper runs shortly after (well within Stripe's retry window, but far
    // short of REAPER_FAILURE_TIMEOUT_MS). The released row must survive.
    vi.setSystemTime(new Date(base + 30 * 60 * 1000));
    const firstReap = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));
    expect(firstReap.reaped).toBe(0);

    const afterReap = await t.run((ctx) => ctx.db.get(first.claimId));
    expect(afterReap?.status).toBe('pending');

    // Stripe's retry now lands and successfully reclaims + finalizes.
    vi.setSystemTime(new Date(base + 30 * 60 * 1000 + 1_000));
    const retry = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_release_reaper_1',
        stripeEventType: 'checkout.session.completed',
      }),
    );
    expect(retry.disposition).toBe('proceed');
    if (retry.disposition !== 'proceed') return;
    expect(retry.mode).toBe('reclaimed_stale');
    expect(retry.attempts).toBe(2);
    expect(retry.claimId).toBe(first.claimId);

    await t.run((ctx) =>
      finalizeWebhookEvent(ctx.db, {
        claimId: retry.claimId,
        outcome: 'completed',
      }),
    );
    const finalized = await t.run((ctx) => ctx.db.get(first.claimId));
    expect(finalized?.status).toBe('completed');
  });
});

describe('reapStaleWebhookClaims', () => {
  it('promotes claims older than the failure timeout to failed', async () => {
    const t = convexTest();

    const now = REAPER_FAILURE_TIMEOUT_MS + 10_000;

    vi.setSystemTime(new Date(1_000));
    const staleClaim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_stale_reap_1',
        stripeEventType: 'charge.refunded',
      }),
    );

    vi.setSystemTime(new Date(now - 1_000));
    const freshClaim = await t.run((ctx) =>
      claimWebhookEvent(ctx.db, {
        stripeEventId: 'evt_fresh_reap_1',
        stripeEventType: 'charge.refunded',
      }),
    );

    vi.setSystemTime(new Date(now));
    const result = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));

    expect(result.reaped).toBe(1);

    if (staleClaim.disposition !== 'proceed')
      throw new Error('expected proceed');
    if (freshClaim.disposition !== 'proceed')
      throw new Error('expected proceed');

    const stale = await t.run((ctx) => ctx.db.get(staleClaim.claimId));
    expect(stale?.status).toBe('failed');
    expect(stale?.failureReason).toBe('stale_timeout');
    expect(stale?.failedAt).toBe(now);

    const fresh = await t.run((ctx) => ctx.db.get(freshClaim.claimId));
    expect(fresh?.status).toBe('pending');
  });

  it('returns 0 when there are no stale claims', async () => {
    const t = convexTest();

    vi.setSystemTime(new Date(Date.now()));
    const result = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));
    expect(result.reaped).toBe(0);
  });

  it('is bounded by REAPER_BATCH_SIZE per invocation', async () => {
    const t = convexTest();

    const claimedAt = 1_000;
    const now = claimedAt + REAPER_FAILURE_TIMEOUT_MS + 1_000;

    const targetCount = REAPER_BATCH_SIZE + 5;
    vi.setSystemTime(new Date(claimedAt));
    await t.run(async (ctx) => {
      for (let i = 0; i < targetCount; i++) {
        await claimWebhookEvent(ctx.db, {
          stripeEventId: `evt_batch_${i}`,
          stripeEventType: 'charge.refunded',
        });
      }
    });

    vi.setSystemTime(new Date(now));
    const firstPass = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));
    expect(firstPass.reaped).toBe(REAPER_BATCH_SIZE);

    const secondPass = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));
    expect(secondPass.reaped).toBe(targetCount - REAPER_BATCH_SIZE);

    const thirdPass = await t.run((ctx) => reapStaleWebhookClaims(ctx.db));
    expect(thirdPass.reaped).toBe(0);
  });
});

describe('appendFinancialEvent ledger dedup', () => {
  it('inserts once per (orderId, kind, stripeEventId) and drops duplicates', async () => {
    const t = convexTest();

    const {orderId, eventId} = await seedOrderWithoutLedger(t, 'dedup-same');

    await t.run((ctx) =>
      appendFinancialEvent(ctx.db, {
        orderId,
        eventId,
        kind: 'payment_refunded',
        amountCents: 500,
        stripeEventId: 'evt_ledger_dedup_1',
      }),
    );

    // Second call with the same `stripeEventId` must be a no-op even if
    // `amountCents` differs — the Stripe event id is the canonical
    // idempotency key and must stop double-posting regardless of caller.
    await t.run((ctx) =>
      appendFinancialEvent(ctx.db, {
        orderId,
        eventId,
        kind: 'payment_refunded',
        amountCents: 9_999,
        stripeEventId: 'evt_ledger_dedup_1',
      }),
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', orderId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(500);
    expect(rows[0]?.stripeEventId).toBe('evt_ledger_dedup_1');
  });

  it('still inserts when stripeEventId differs between calls', async () => {
    const t = convexTest();

    const {orderId, eventId} = await seedOrderWithoutLedger(t, 'dedup-diff');

    await t.run((ctx) =>
      appendFinancialEvent(ctx.db, {
        orderId,
        eventId,
        kind: 'payment_refunded',
        amountCents: 200,
        stripeEventId: 'evt_ledger_distinct_a',
      }),
    );
    await t.run((ctx) =>
      appendFinancialEvent(ctx.db, {
        orderId,
        eventId,
        kind: 'payment_refunded',
        amountCents: 300,
        stripeEventId: 'evt_ledger_distinct_b',
      }),
    );

    const rows = await t.run((ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', orderId))
        .collect(),
    );
    expect(rows).toHaveLength(2);
  });
});

describe('registered stripe.webhooks mutations', () => {
  it('wires claimStripeWebhookEvent + finalizeStripeWebhookEvent end-to-end', async () => {
    const t = convexTest();

    // Use real timers here so the registered mutations see the real clock
    // (convex-test internals rely on Date.now()).
    vi.useRealTimers();

    const claim = await t.mutation(
      internal.stripe.webhooks.claimStripeWebhookEvent,
      {
        stripeEventId: 'evt_registered_1',
        stripeEventType: 'checkout.session.completed',
      },
    );
    expect(claim.disposition).toBe('proceed');
    if (claim.disposition !== 'proceed') return;

    await t.mutation(internal.stripe.webhooks.finalizeStripeWebhookEvent, {
      claimId: claim.claimId,
      outcome: 'completed',
    });

    const row = await t.run((ctx) => ctx.db.get(claim.claimId));
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).toBeGreaterThan(0);
  });

  it('exposes reapStaleStripeWebhookClaims as a callable internal mutation', async () => {
    const t = convexTest();
    vi.useRealTimers();

    const result = await t.mutation(
      internal.stripe.webhooks.reapStaleStripeWebhookClaims,
      {},
    );
    expect(result.reaped).toBe(0);
  });

  it('releaseStripeWebhookClaim unblocks the next claim immediately', async () => {
    const t = convexTest();
    vi.useRealTimers();

    const first = await t.mutation(
      internal.stripe.webhooks.claimStripeWebhookEvent,
      {
        stripeEventId: 'evt_release_registered_1',
        stripeEventType: 'charge.refunded',
      },
    );
    if (first.disposition !== 'proceed') throw new Error('expected proceed');

    await t.mutation(internal.stripe.webhooks.releaseStripeWebhookClaim, {
      claimId: first.claimId,
    });

    const retry = await t.mutation(
      internal.stripe.webhooks.claimStripeWebhookEvent,
      {
        stripeEventId: 'evt_release_registered_1',
        stripeEventType: 'charge.refunded',
      },
    );

    expect(retry.disposition).toBe('proceed');
    if (retry.disposition !== 'proceed') return;
    expect(retry.mode).toBe('reclaimed_stale');
    expect(retry.attempts).toBe(2);
  });
});
