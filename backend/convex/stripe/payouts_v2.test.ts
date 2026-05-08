import {describe, expect, it} from 'vitest';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

/**
 * End-to-end coverage for the V2 payout mutations added in Tasks 2 + 6 + 7:
 *
 * - `createPayoutIntent` — atomic check-or-create; concurrent callers
 *   converge on one batch with one allocation set.
 * - `markPayoutBatchSubmitted` — flips pending → submitted, stamps the
 *   Stripe payout id on the batch and its allocations, idempotent on
 *   re-call with the same id.
 * - `confirmPayout` — pending_confirmation → paid for every allocation
 *   in a batch without mutating event payout gates, idempotent.
 * - `failPayout` — mirrors `confirmPayout` but for the failure path,
 *   leaves events WITHOUT `paidOutAt` so the next cron run picks them up.
 * - `updateOrganizerFromStripeAccount` — projects V2 status onto the
 *   organizer row and keeps the legacy boolean coherent.
 *
 * These mutations are the transactional core of the V2 payout flow;
 * bugs here would double-pay or silently drop eligibility.
 */

async function seedOrganizerWithAccount(
  t: ReturnType<typeof convexTest>,
  stripeConnectedAccountId: string,
): Promise<Id<'organizers'>> {
  return await t.mutation(api.testing.communities.seedOrganizer, {
    name: `Org ${stripeConnectedAccountId}`,
    stripeConnectedAccountId,
    stripeOnboardingStatus: 'complete',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    status: 'published',
  });
}

async function seedEvent(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
  title: string,
): Promise<Id<'events'>> {
  return await t.mutation(api.testing.events.seedEvent, {
    title,
    price: 2500,
    totalTickets: 100,
    date: '2024-01-01T00:00:00.000Z',
    status: 'published',
    visibility: 'public',
    organizerId,
  });
}

describe('createPayoutIntent', () => {
  it('inserts a pending batch plus allocations atomically', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_A');
    const eventId = await seedEvent(t, organizerId, 'Event A1');

    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'braket-payout-acct_A-2025-01-01',
      connectedAccountId: 'acct_A',
      amountCents: 5_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 5_000}],
    });

    expect(batch.reused).toBe(false);
    expect(batch.status).toBe('pending');

    const storedBatch = await t.run(async (ctx) => ctx.db.get(batch.batchId));
    expect(storedBatch).toMatchObject({
      idempotencyKey: 'braket-payout-acct_A-2025-01-01',
      connectedAccountId: 'acct_A',
      amountCents: 5_000,
      currency: 'usd',
      status: 'pending',
    });

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_batchId', (q) => q.eq('batchId', batch.batchId))
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      eventId,
      amountCents: 5_000,
      status: 'pending_confirmation',
      connectedAccountId: 'acct_A',
    });
  });

  it('returns an existing pending batch instead of creating a duplicate', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_A');
    const eventId = await seedEvent(t, organizerId, 'Event A1');

    const first = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k1',
      connectedAccountId: 'acct_A',
      amountCents: 5_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 5_000}],
    });

    // Caller tries to submit a different amount — the mutation should
    // hand back the original batch so the retry picks up the same
    // Stripe idempotency key / amount.
    const second = await t.mutation(
      internal.stripe.connect.createPayoutIntent,
      {
        idempotencyKey: 'k2',
        connectedAccountId: 'acct_A',
        amountCents: 7_000,
        currency: 'usd',
        allocations: [{eventId, amountCents: 7_000}],
      },
    );

    expect(second.reused).toBe(true);
    expect(second.batchId).toBe(first.batchId);
    expect(second.amountCents).toBe(5_000);
    expect(second.idempotencyKey).toBe('k1');

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_batchId', (q) => q.eq('batchId', first.batchId))
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.amountCents).toBe(5_000);
  });

  it('reuses a batch matched on idempotencyKey even when the status has advanced', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_IK');
    const eventId = await seedEvent(t, organizerId, 'Event IK1');

    const first = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'key-stable',
      connectedAccountId: 'acct_IK',
      amountCents: 2_500,
      currency: 'usd',
      allocations: [{eventId, amountCents: 2_500}],
    });

    // Move to `submitted` — a terminal state for the non-terminal check
    // but still matchable by idempotencyKey.
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: first.batchId,
      stripePayoutId: 'po_ik',
    });

    const second = await t.mutation(
      internal.stripe.connect.createPayoutIntent,
      {
        idempotencyKey: 'key-stable',
        connectedAccountId: 'acct_IK',
        amountCents: 2_500,
        currency: 'usd',
        allocations: [{eventId, amountCents: 2_500}],
      },
    );

    expect(second.reused).toBe(true);
    expect(second.batchId).toBe(first.batchId);
    expect(second.status).toBe('submitted');
    expect(second.stripePayoutId).toBe('po_ik');
  });
});

describe('markPayoutBatchSubmitted', () => {
  it('flips pending → submitted and stamps the Stripe payout id on batch + allocations', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_B');
    const eventId = await seedEvent(t, organizerId, 'Event B1');
    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k1',
      connectedAccountId: 'acct_B',
      amountCents: 4_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 4_000}],
    });

    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_123',
    });

    const updated = await t.run(async (ctx) => ctx.db.get(batch.batchId));
    expect(updated?.status).toBe('submitted');
    expect(updated?.stripePayoutId).toBe('po_123');
    expect(updated?.submittedAt).toBeTypeOf('number');

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_batchId', (q) => q.eq('batchId', batch.batchId))
        .collect(),
    );
    expect(allocations[0]?.stripePayoutId).toBe('po_123');
  });

  it('is idempotent — re-calling with the same id is a no-op', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_B');
    const eventId = await seedEvent(t, organizerId, 'Event B1');
    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k1',
      connectedAccountId: 'acct_B',
      amountCents: 4_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 4_000}],
    });

    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_123',
    });
    const firstSubmittedAt = await t.run(
      async (ctx) => (await ctx.db.get(batch.batchId))?.submittedAt,
    );

    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_123',
    });
    const secondSubmittedAt = await t.run(
      async (ctx) => (await ctx.db.get(batch.batchId))?.submittedAt,
    );

    expect(secondSubmittedAt).toBe(firstSubmittedAt);
  });
});

describe('confirmPayout', () => {
  it('flips submitted batch + allocations to paid without stamping paidOutAt', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_C');
    const [eventA, eventB] = await Promise.all([
      seedEvent(t, organizerId, 'Event C1'),
      seedEvent(t, organizerId, 'Event C2'),
    ]);
    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k1',
      connectedAccountId: 'acct_C',
      amountCents: 9_000,
      currency: 'usd',
      allocations: [
        {eventId: eventA, amountCents: 5_000},
        {eventId: eventB, amountCents: 4_000},
      ],
    });
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_paid_1',
    });

    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_paid_1',
    });

    const confirmed = await t.run(async (ctx) => ctx.db.get(batch.batchId));
    expect(confirmed?.status).toBe('paid');
    expect(confirmed?.confirmedAt).toBeTypeOf('number');

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_paid_1'),
        )
        .collect(),
    );
    expect(allocations.every((a) => a.status === 'paid')).toBe(true);

    const events = await Promise.all(
      [eventA, eventB].map((id) => t.run(async (ctx) => ctx.db.get(id))),
    );
    expect(events.every((e) => e?.paidOutAt === undefined)).toBe(true);
  });

  it('keeps legacy paidOutAt events in Connect settlement data', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_legacy_paid');
    const eventId = await seedEvent(t, organizerId, 'Legacy Paid Event');

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Legacy Connect state: paidOutAt used to be stamped by confirmPayout before allocation-ledger settlement became authoritative.
      await ctx.db.patch('events', eventId, {paidOutAt: Date.now() - 1_000});
    });

    const settlementData = await t.query(
      internal.stripe.connect.getSettlementDataForAccount,
      {
        stripeConnectedAccountId: 'acct_legacy_paid',
        eligibleBeforeMs: Date.now(),
      },
    );

    expect(settlementData.events.map((event) => event._id)).toContain(eventId);
  });

  it('stamps paidOutAt only after confirmed allocations cover the event settlement', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_full_paid');
    const eventId = await seedEvent(t, organizerId, 'Fully Paid Event');

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
      const orderId = await ctx.db.insert('ticket_orders', {
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 5_000,
        currency: 'USD',
        state: 'completed',
        expiresAt: Date.now() + 60_000,
        completedAt: Date.now(),
        trustSource: 'open_access',
        connectedAccountId: 'acct_full_paid',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
      await ctx.db.insert('order_financial_events', {
        orderId,
        eventId,
        currency: 'USD',
        kind: 'payment_captured',
        amountCents: 5_000,
        connectedAccountId: 'acct_full_paid',
        connectedAccountNetCents: 4_800,
        occurredAt: Date.now(),
      });
    });

    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k-full-paid',
      connectedAccountId: 'acct_full_paid',
      amountCents: 4_800,
      currency: 'usd',
      allocations: [{eventId, amountCents: 4_800}],
    });
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_full_paid',
    });

    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_full_paid',
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');
  });

  it('does not stamp paidOutAt for partial Connect payouts', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_partial_paid');
    const eventId = await seedEvent(t, organizerId, 'Partially Paid Event');

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
      const orderId = await ctx.db.insert('ticket_orders', {
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 5_000,
        currency: 'USD',
        state: 'completed',
        expiresAt: Date.now() + 60_000,
        completedAt: Date.now(),
        trustSource: 'open_access',
        connectedAccountId: 'acct_partial_paid',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
      await ctx.db.insert('order_financial_events', {
        orderId,
        eventId,
        currency: 'USD',
        kind: 'payment_captured',
        amountCents: 5_000,
        connectedAccountId: 'acct_partial_paid',
        connectedAccountNetCents: 4_800,
        occurredAt: Date.now(),
      });
    });

    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k-partial-paid',
      connectedAccountId: 'acct_partial_paid',
      amountCents: 1_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 1_000}],
    });
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_partial_paid',
    });

    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_partial_paid',
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.paidOutAt).toBeUndefined();
  });

  it('ignores unknown payouts', async () => {
    const t = convexTest();
    // Should not throw even though the id matches no batch — the
    // webhook dispatcher relies on this for events not originated by us.
    await expect(
      t.mutation(internal.stripe.connect.confirmPayout, {
        stripePayoutId: 'po_unknown',
      }),
    ).resolves.toBeNull();
  });
});

describe('failPayout', () => {
  it('marks the batch and allocations failed without stamping paidOutAt on events', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_D');
    const eventId = await seedEvent(t, organizerId, 'Event D1');
    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k1',
      connectedAccountId: 'acct_D',
      amountCents: 3_000,
      currency: 'usd',
      allocations: [{eventId, amountCents: 3_000}],
    });
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_fail_1',
    });

    await t.mutation(internal.stripe.connect.failPayout, {
      stripePayoutId: 'po_fail_1',
      failureReason: 'insufficient_funds',
    });

    const failed = await t.run(async (ctx) => ctx.db.get(batch.batchId));
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('insufficient_funds');

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.paidOutAt).toBeUndefined();

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_fail_1'),
        )
        .collect(),
    );
    expect(allocations.every((a) => a.status === 'failed')).toBe(true);
  });
});

describe('updateOrganizerFromStripeAccount', () => {
  it('projects V2 status onto the organizer row', async () => {
    const t = convexTest();
    await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Status Org',
      slug: 'status-org',
      stripeConnectedAccountId: 'acct_status',
      stripeOnboardingStatus: 'in_progress',
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      status: 'draft',
    });

    await t.mutation(internal.stripe.connect.updateOrganizerFromStripeAccount, {
      stripeConnectedAccountId: 'acct_status',
      onboardingStatus: 'complete',
      chargesEnabled: true,
      payoutsEnabled: true,
      currentlyDue: [],
    });

    const updated = await t.run(async (ctx) =>
      ctx.db
        .query('organizers')
        .withIndex('by_stripeConnectedAccountId', (q) =>
          q.eq('stripeConnectedAccountId', 'acct_status'),
        )
        .unique(),
    );
    expect(updated?.stripeOnboardingStatus).toBe('complete');
    expect(updated?.stripeChargesEnabled).toBe(true);
    expect(updated?.stripePayoutsEnabled).toBe(true);
    expect(updated?.stripeCurrentlyDue).toStrictEqual([]);
  });

  it('handles restricted accounts without rewriting feature gates', async () => {
    const t = convexTest();
    await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Regression Org',
      slug: 'regression-org',
      stripeConnectedAccountId: 'acct_regress',
      stripeOnboardingStatus: 'complete',
      status: 'draft',
    });

    await t.mutation(internal.stripe.connect.updateOrganizerFromStripeAccount, {
      stripeConnectedAccountId: 'acct_regress',
      onboardingStatus: 'restricted',
      chargesEnabled: true,
      payoutsEnabled: false,
      currentlyDue: ['tos.acceptance'],
    });

    const updated = await t.run(async (ctx) =>
      ctx.db
        .query('organizers')
        .withIndex('by_stripeConnectedAccountId', (q) =>
          q.eq('stripeConnectedAccountId', 'acct_regress'),
        )
        .unique(),
    );
    expect(updated?.stripeOnboardingStatus).toBe('restricted');
    expect(updated?.stripeChargesEnabled).toBe(true);
    expect(updated?.stripePayoutsEnabled).toBe(false);
    expect(updated?.stripeCurrentlyDue).toStrictEqual(['tos.acceptance']);
  });
});
