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

type SeedRunCtx = Parameters<
  Parameters<ReturnType<typeof convexTest>['run']>[0]
>[0];

/**
 * Stand-in for "Stripe confirmed capture and the webhook recorded net
 * impact" — production capture rows require a live BalanceTransaction.
 */
async function seedCapturedLedgerRow(
  ctx: SeedRunCtx,
  eventId: Id<'events'>,
  connectedAccountId: string,
  netCents: number,
): Promise<void> {
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
  const orderId = await ctx.db.insert('ticket_orders', {
    eventId,
    kind: 'primary',
    quantity: 1,
    tier: 'regular',
    amountCents: netCents,
    currency: 'USD',
    state: 'completed',
    expiresAt: Date.now() + 60_000,
    completedAt: Date.now(),
    trustSource: 'open_access',
    connectedAccountId,
  });
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test settlement ledger row; production capture rows require Stripe BalanceTransaction data.
  await ctx.db.insert('order_financial_events', {
    orderId,
    eventId,
    currency: 'USD',
    kind: 'payment_captured',
    amountCents: netCents,
    connectedAccountId,
    connectedAccountNetCents: netCents,
    occurredAt: Date.now(),
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
      await seedCapturedLedgerRow(ctx, eventId, 'acct_legacy_paid', 2_400);
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

  it('reserves a running multi-day event until PAYOUT_DELAY after its endDate', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_multiday');
    // 7-day festival: starts Jan 1, ends Jan 8 (event timezone).
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Seven Day Festival',
      price: 2500,
      totalTickets: 100,
      date: '2026-01-01T20:00:00.000Z',
      endDate: '2026-01-08T20:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_multiday', 2_400);
    });

    // Cutoff three days after the START but before the END — old behaviour
    // would release funds mid-festival; end-aware eligibility must reserve.
    const midEvent = await t.query(
      internal.stripe.connect.getSettlementDataForAccount,
      {
        stripeConnectedAccountId: 'acct_multiday',
        eligibleBeforeMs: Date.parse('2026-01-04T20:00:00.000Z'),
      },
    );
    expect(
      midEvent.events.find((event) => event._id === eventId)?.eligible,
    ).toBe(false);

    // Cutoff after the endDate — now eligible.
    const afterEnd = await t.query(
      internal.stripe.connect.getSettlementDataForAccount,
      {
        stripeConnectedAccountId: 'acct_multiday',
        eligibleBeforeMs: Date.parse('2026-01-09T20:00:00.000Z'),
      },
    );
    expect(
      afterEnd.events.find((event) => event._id === eventId)?.eligible,
    ).toBe(true);
  });

  it('keeps drafted and cancelled events with ledger rows in Connect settlement data', async () => {
    // The 2026-07 shortfall class: captured money is owed regardless of the
    // event's current status. Settlement derives its event set from the
    // ledger, so a status change must never drop an event's captures or
    // refunds from the math.
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_drafted');
    const draftedEventId = await seedEvent(t, organizerId, 'Drafted Event');
    const cancelledEventId = await seedEvent(t, organizerId, 'Cancelled Event');

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, draftedEventId, 'acct_drafted', 2_400);
      await seedCapturedLedgerRow(ctx, cancelledEventId, 'acct_drafted', 1_200);
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Simulates an admin status change after revenue was captured.
      await ctx.db.patch('events', draftedEventId, {status: 'draft'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Simulates an admin status change after revenue was captured.
      await ctx.db.patch('events', cancelledEventId, {status: 'cancelled'});
    });

    const settlementData = await t.query(
      internal.stripe.connect.getSettlementDataForAccount,
      {
        stripeConnectedAccountId: 'acct_drafted',
        eligibleBeforeMs: Date.now(),
      },
    );

    const settledIds = settlementData.events.map((event) => event._id);
    expect(settledIds).toContain(draftedEventId);
    expect(settledIds).toContain(cancelledEventId);
  });

  it('reports submitted batches as in-flight cents in Connect settlement data', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_inflight');
    const eventId = await seedEvent(t, organizerId, 'Inflight Event');

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_inflight', 2_400);
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Simulates a submitted batch awaiting its payout.paid webhook.
      await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_inflight-2026-01-01',
        connectedAccountId: 'acct_inflight',
        amountCents: 1_500,
        currency: 'usd',
        status: 'submitted',
        stripePayoutId: 'po_inflight',
        createdAt: Date.now() - 60_000,
        submittedAt: Date.now() - 60_000,
      });
    });

    const settlementData = await t.query(
      internal.stripe.connect.getSettlementDataForAccount,
      {
        stripeConnectedAccountId: 'acct_inflight',
        eligibleBeforeMs: Date.now(),
      },
    );

    expect(settlementData.inflightSubmittedCents).toBe(1_500);
  });

  it('fails closed when a Connect settlement event has an invalid date', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_invalid_date');
    const eventId = await seedEvent(t, organizerId, 'Invalid Date Event');

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_invalid_date', 2_400);
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Corrupt legacy row used to verify settlement projection fails closed.
      await ctx.db.patch(eventId, {date: '2026-02-31T08:00:00.000Z'});
    });

    await expect(
      t.query(internal.stripe.connect.getSettlementDataForAccount, {
        stripeConnectedAccountId: 'acct_invalid_date',
        eligibleBeforeMs: Date.now(),
      }),
    ).rejects.toThrow('has an invalid date');
  });

  it('fails closed when a Connect settlement event has a malformed endDate', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_bad_end');
    const eventId = await seedEvent(t, organizerId, 'Bad End Event');

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_bad_end', 2_400);
      // Valid start, corrupt end — must not silently fall back to the start
      // and release funds as if the event had no end.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Corrupt endDate used to verify end-aware settlement fails closed.
      await ctx.db.patch(eventId, {endDate: '2026-02-31T08:00:00.000Z'});
    });

    await expect(
      t.query(internal.stripe.connect.getSettlementDataForAccount, {
        stripeConnectedAccountId: 'acct_bad_end',
        eligibleBeforeMs: Date.now(),
      }),
    ).rejects.toThrow('has an invalid date');
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

  it('ignores unknown payouts without webhook context', async () => {
    const t = convexTest();
    // Should not throw even though the id matches no batch — bare
    // confirmations (recovery, tests) carry no ingestion context.
    await expect(
      t.mutation(internal.stripe.connect.confirmPayout, {
        stripePayoutId: 'po_unknown',
      }),
    ).resolves.toBeNull();
  });

  it('heals the payout.paid-before-markSubmitted race via batch metadata', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_race');
    const eventId = await seedEvent(t, organizerId, 'Race Event');
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_race', 4_800);
    });

    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k-race',
      connectedAccountId: 'acct_race',
      amountCents: 4_800,
      currency: 'usd',
      allocations: [{eventId, amountCents: 4_800}],
    });

    // payout.paid lands BEFORE markPayoutBatchSubmitted stamped the id.
    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_race',
      amountCents: 4_800,
      currency: 'usd',
      metadataBatchId: batch.batchId,
      connectedAccountId: 'acct_race',
    });

    const healed = await t.run(async (ctx) =>
      ctx.db.get('payout_batches', batch.batchId),
    );
    expect(healed).toMatchObject({status: 'paid', stripePayoutId: 'po_race'});
    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_batchId', (q) => q.eq('batchId', batch.batchId))
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      status: 'paid',
      stripePayoutId: 'po_race',
    });

    // The late markPayoutBatchSubmitted is a no-op on the paid batch.
    await t.mutation(internal.stripe.connect.markPayoutBatchSubmitted, {
      batchId: batch.batchId,
      stripePayoutId: 'po_race',
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get('payout_batches', batch.batchId),
    );
    expect(after).toMatchObject({status: 'paid'});
  });

  it('ingests an external payout as a paid batch with FIFO allocations', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_external');
    const olderEventId = await seedEvent(t, organizerId, 'Older Event');
    const newerEventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Newer Event',
      price: 2500,
      totalTickets: 100,
      date: '2024-06-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, olderEventId, 'acct_external', 3_000);
      await seedCapturedLedgerRow(ctx, newerEventId, 'acct_external', 2_000);
    });

    // Operator paid 4000¢ by hand in the Stripe dashboard.
    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_manual_1',
      amountCents: 4_000,
      currency: 'usd',
      connectedAccountId: 'acct_external',
    });

    const batch = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_manual_1'),
        )
        .unique(),
    );
    expect(batch).toMatchObject({
      status: 'paid',
      origin: 'external',
      amountCents: 4_000,
      idempotencyKey: 'external-po_manual_1',
    });

    // FIFO: older event fully covered first, newer gets the remainder.
    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_manual_1'),
        )
        .collect(),
    );
    const byEvent = new Map(
      allocations.map((alloc) => [alloc.eventId, alloc.amountCents]),
    );
    expect(byEvent.get(olderEventId)).toBe(3_000);
    expect(byEvent.get(newerEventId)).toBe(1_000);
    expect(allocations.every((alloc) => alloc.status === 'paid')).toBe(true);

    // Fully-settled older event gets its paid-out marker.
    const olderEvent = await t.run(async (ctx) =>
      ctx.db.get('events', olderEventId),
    );
    expect(olderEvent?.paidOutAt).toBeDefined();

    // Redelivery of the same webhook is a no-op (idempotency key).
    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_manual_1',
      amountCents: 4_000,
      currency: 'usd',
      connectedAccountId: 'acct_external',
    });
    const batches = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_idempotencyKey', (q) =>
          q.eq('idempotencyKey', 'external-po_manual_1'),
        )
        .collect(),
    );
    expect(batches).toHaveLength(1);
  });

  it('caps external allocations at the ledger payable and keeps the batch amount honest', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_overpay');
    const eventId = await seedEvent(t, organizerId, 'Overpay Event');
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_overpay', 2_000);
    });

    // Manual payout exceeds everything the ledger can attribute.
    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_overpay',
      amountCents: 5_000,
      currency: 'usd',
      connectedAccountId: 'acct_overpay',
    });

    const batch = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_overpay'),
        )
        .unique(),
    );
    expect(batch).toMatchObject({amountCents: 5_000, origin: 'external'});

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_overpay'),
        )
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({eventId, amountCents: 2_000});
  });

  it('does not ingest non-USD or account-less external payouts', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_nonusd');
    const eventId = await seedEvent(t, organizerId, 'Non-USD Event');
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_nonusd', 2_000);
    });

    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_eur',
      amountCents: 2_000,
      currency: 'eur',
      connectedAccountId: 'acct_nonusd',
    });
    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_no_account',
      amountCents: 2_000,
      currency: 'usd',
    });

    const batches = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_connectedAccountId_and_status', (q) =>
          q.eq('connectedAccountId', 'acct_nonusd'),
        )
        .collect(),
    );
    expect(batches).toHaveLength(0);

    // Assert by payout id too — the account-less payout can't appear under
    // any connectedAccountId index, so prove no batch exists for it at all.
    for (const stripePayoutId of ['po_eur', 'po_no_account']) {
      const batch = await t.run(async (ctx) =>
        ctx.db
          .query('payout_batches')
          .withIndex('by_stripePayoutId', (q) =>
            q.eq('stripePayoutId', stripePayoutId),
          )
          .unique(),
      );
      expect(batch).toBeNull();
    }
  });

  it('refuses a metadata match when the webhook account does not own the batch', async () => {
    // The dispatcher forwards payout webhooks keyed purely by payout id;
    // account verification lives here in the metadata-resolution path. A
    // spoofed/mismatched account must neither stamp nor confirm the batch,
    // and must not fall through to external ingestion on the wrong account.
    const t = convexTest();
    const organizerId = await seedOrganizerWithAccount(t, 'acct_owner');
    const eventId = await seedEvent(t, organizerId, 'Mismatch Event');
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_owner', 4_800);
    });

    const batch = await t.mutation(internal.stripe.connect.createPayoutIntent, {
      idempotencyKey: 'k-mismatch',
      connectedAccountId: 'acct_owner',
      amountCents: 4_800,
      currency: 'usd',
      allocations: [{eventId, amountCents: 4_800}],
    });

    await t.mutation(internal.stripe.connect.confirmPayout, {
      stripePayoutId: 'po_mismatch',
      amountCents: 4_800,
      currency: 'usd',
      metadataBatchId: batch.batchId,
      connectedAccountId: 'acct_intruder',
    });

    // Batch untouched: still pending, no payout id stamped.
    const untouched = await t.run(async (ctx) =>
      ctx.db.get('payout_batches', batch.batchId),
    );
    expect(untouched).toMatchObject({status: 'pending'});
    expect(untouched?.stripePayoutId).toBeUndefined();

    // And no external batch was ingested for the mismatched payout.
    const external = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_mismatch'),
        )
        .unique(),
    );
    expect(external).toBeNull();
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
