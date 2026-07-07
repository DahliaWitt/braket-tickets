import {beforeEach, describe, expect, it, vi} from 'vitest';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

/**
 * End-to-end coverage for `processScheduledPayouts` — the Connect-account
 * branch. The platform-organizer branch is covered in
 * `stripe/actions.test.ts`. Here we exercise the full path:
 *
 *   listConnectedAccounts → getSettlementDataForAccount →
 *   computeEventSettlements → buildPayoutPlan → createPayoutIntent →
 *   stripe.payouts.create → markPayoutBatchSubmitted
 *
 * Stripe SDK calls are mocked. Convex DB state is real via convexTest.
 */
const balanceRetrieveMock = vi.hoisted(() => vi.fn());
const payoutsCreateMock = vi.hoisted(() => vi.fn());
const payoutsRetrieveMock = vi.hoisted(() => vi.fn());
const payoutsListMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  class StripeMock {
    static errors = {
      StripeSignatureVerificationError: class StripeSignatureVerificationError extends Error {},
    };

    balance = {retrieve: balanceRetrieveMock};
    payouts = {
      create: payoutsCreateMock,
      retrieve: payoutsRetrieveMock,
      list: payoutsListMock,
    };
    // Stubs for actions that aren't exercised but share this module.
    v2 = {
      core: {
        accounts: {create: vi.fn(), retrieve: vi.fn(), close: vi.fn()},
      },
    };
    balanceSettings = {update: vi.fn(), retrieve: vi.fn()};
    accountSessions = {create: vi.fn()};
    webhooks = {constructEvent: vi.fn()};
    paymentIntents = {create: vi.fn(), retrieve: vi.fn()};
    refunds = {create: vi.fn()};
    checkout = {sessions: {create: vi.fn(), retrieve: vi.fn()}};
    charges = {retrieve: vi.fn()};
    accountLinks = {create: vi.fn()};

    constructor(_secretKey: string) {}
  }
  return {default: StripeMock};
});

describe('processScheduledPayouts — Connect account branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake';
    // Balance matches the 2400¢ ledger claim every test seeds — the trust
    // gate requires ledger and Stripe to agree before any payout submits.
    balanceRetrieveMock.mockResolvedValue({
      available: [{amount: 2_400, currency: 'usd'}],
      pending: [],
    });
    payoutsCreateMock.mockResolvedValue({id: 'po_test_123'});
    payoutsRetrieveMock.mockResolvedValue({id: 'po_test_123', status: 'paid'});
    payoutsListMock.mockResolvedValue({data: []});
  });

  type SeedRunCtx = Parameters<
    Parameters<ReturnType<typeof convexTest>['run']>[0]
  >[0];

  /**
   * Stand-in for "Stripe confirmed capture and the webhook recorded net
   * impact" — production capture rows require a live BalanceTransaction.
   * Mirrors the helper in payouts_v2.test.ts.
   */
  async function seedCapturedLedgerRow(
    ctx: SeedRunCtx,
    eventId: Id<'events'>,
    connectedAccountId: string,
    options?: {amountCents?: number; netCents?: number; fees?: boolean},
  ): Promise<void> {
    const amountCents = options?.amountCents ?? 2500;
    const netCents = options?.netCents ?? 2400;
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: stand in for a post-settlement ledger row; no production mutation emits with a custom BalanceTransaction net.
    const orderId = await ctx.db.insert('ticket_orders', {
      eventId,
      kind: 'primary',
      quantity: 1,
      tier: 'regular',
      amountCents,
      currency: 'USD',
      state: 'completed',
      expiresAt: Date.now() + 60_000,
      completedAt: Date.now(),
      trustSource: 'open_access',
      connectedAccountId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: stand in for a post-settlement ledger row; no production mutation emits with a custom BalanceTransaction net.
    await ctx.db.insert('order_financial_events', {
      orderId,
      eventId,
      currency: 'USD',
      kind: 'payment_captured',
      amountCents,
      connectedAccountId,
      connectedAccountNetCents: netCents,
      ...(options?.fees ? {processorFeeCents: 100, platformFeeCents: 50} : {}),
      occurredAt: Date.now(),
    });
  }

  it('runs the full flow: settlement math → createPayoutIntent → payouts.create → markSubmitted', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Connect Account Org',
        slug: 'connect-org',
        stripeConnectedAccountId: 'acct_end_to_end',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );

    // Past event — eligible for payout.
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Past Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // Seed a ledger row as if a captured charge landed on this event.
    // The settlement math reads `connectedAccountNetCents` from the
    // financial event row (Task 7). There's no production-mutation path
    // that emits a `payment_captured` row with a pre-computed Stripe
    // net figure — that path requires a real BalanceTransaction from
    // `recordPaymentCaptured`, which needs a live Stripe round trip.
    // For this integration test we seed the row directly to stand in
    // for "Stripe confirmed capture and the webhook recorded net
    // impact."
    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_end_to_end', {fees: true});
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    // Stripe payout created with the deterministic idempotency key.
    expect(payoutsCreateMock).toHaveBeenCalledTimes(1);
    const [createParams, createOptions] = payoutsCreateMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(createParams).toMatchObject({amount: 2400, currency: 'usd'});
    expect(createOptions).toMatchObject({
      stripeAccount: 'acct_end_to_end',
      idempotencyKey: expect.stringMatching(
        /^braket-payout-acct_end_to_end-\d{4}-\d{2}-\d{2}$/,
      ),
    });

    // Batch landed in submitted state with stripe payout id stamped.
    const batch = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_connectedAccountId_and_status', (q) =>
          q.eq('connectedAccountId', 'acct_end_to_end'),
        )
        .first(),
    );
    expect(batch).toMatchObject({
      status: 'submitted',
      amountCents: 2400,
      stripePayoutId: 'po_test_123',
    });

    // Allocation persisted and bound to the event.
    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_connectedAccountId_and_status', (q) =>
          q.eq('connectedAccountId', 'acct_end_to_end'),
        )
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      eventId,
      amountCents: 2400,
      stripePayoutId: 'po_test_123',
      status: 'pending_confirmation',
    });
  });

  it('supersedes a stale pending batch and submits a fresh one under a new key', async () => {
    // Crash-recovery scenario: a prior cron run created a pending batch but
    // crashed before `payouts.create` landed. Stripe idempotency keys expire
    // after 24h, so replaying the prior key would create a NEW payout with
    // the stale frozen amount. The recovery pre-pass checks Stripe for a
    // payout carrying our batch metadata (none here), fails the stale batch
    // as superseded, and the account run recomputes a fresh batch under
    // today's key.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Crash Recover Org',
        slug: 'crash-recover',
        stripeConnectedAccountId: 'acct_recover',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Recover Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_recover');
      // Prior cron run left a pending batch with a stale date key.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: simulates a crash-recovery scenario; `createPayoutIntent` is the only production mutation that inserts and it owns the idempotency-key derivation.
      await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_recover-2019-12-31',
        connectedAccountId: 'acct_recover',
        amountCents: 2400,
        currency: 'usd',
        status: 'pending',
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      });
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    // The pre-pass looked for a payout carrying the batch metadata.
    expect(payoutsListMock).toHaveBeenCalledTimes(1);
    // Exactly one fresh Stripe payout under TODAY's key — never a replay of
    // the expired one.
    expect(payoutsCreateMock).toHaveBeenCalledTimes(1);
    const [, submitOptions] = payoutsCreateMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(submitOptions['idempotencyKey']).toMatch(
      /^braket-payout-acct_recover-\d{4}-\d{2}-\d{2}$/,
    );
    expect(submitOptions['idempotencyKey']).not.toBe(
      'braket-payout-acct_recover-2019-12-31',
    );

    const batches = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_connectedAccountId_and_status', (q) =>
          q.eq('connectedAccountId', 'acct_recover'),
        )
        .collect(),
    );
    expect(batches).toHaveLength(2);
    const superseded = batches.find(
      (batch) => batch.idempotencyKey === 'braket-payout-acct_recover-2019-12-31',
    );
    expect(superseded).toMatchObject({
      status: 'failed',
      failureReason: 'stale_pending_superseded',
    });
    const fresh = batches.find((batch) => batch.status === 'submitted');
    expect(fresh).toMatchObject({amountCents: 2400, origin: 'cron'});
  });

  it('recovers a stuck submitted batch by polling Stripe when the webhook was lost', async () => {
    // A lost payout.paid webhook used to freeze the account forever: the
    // submitted batch blocked createPayoutIntent and nothing ever confirmed
    // it. The recovery pre-pass polls Stripe and confirms from the source.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Lost Webhook Org',
        slug: 'lost-webhook-org',
        stripeConnectedAccountId: 'acct_lost_webhook',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Lost Webhook Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_lost_webhook');
      // Submitted 3 days ago; payout.paid never arrived.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: simulates a lost-webhook submitted batch.
      const batchId = await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_lost_webhook-old',
        connectedAccountId: 'acct_lost_webhook',
        amountCents: 2400,
        currency: 'usd',
        status: 'submitted',
        stripePayoutId: 'po_lost_webhook',
        origin: 'cron',
        createdAt: Date.now() - 3 * 86_400_000,
        submittedAt: Date.now() - 3 * 86_400_000,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: allocation awaiting the lost confirmation.
      await ctx.db.insert('payout_allocations', {
        batchId,
        connectedAccountId: 'acct_lost_webhook',
        eventId,
        amountCents: 2400,
        status: 'pending_confirmation',
        stripePayoutId: 'po_lost_webhook',
        createdAt: Date.now() - 3 * 86_400_000,
      });
    });

    payoutsRetrieveMock.mockResolvedValue({
      id: 'po_lost_webhook',
      status: 'paid',
    });
    // Post-recovery the ledger is fully paid and the balance is drained.
    balanceRetrieveMock.mockResolvedValue({
      available: [{amount: 0, currency: 'usd'}],
      pending: [],
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsRetrieveMock).toHaveBeenCalledWith(
      'po_lost_webhook',
      {},
      {stripeAccount: 'acct_lost_webhook'},
    );
    expect(payoutsCreateMock).not.toHaveBeenCalled();

    const batch = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_lost_webhook'),
        )
        .unique(),
    );
    expect(batch).toMatchObject({status: 'paid'});

    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_stripePayoutId', (q) =>
          q.eq('stripePayoutId', 'po_lost_webhook'),
        )
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({status: 'paid'});

    // Fully settled → the event carries the paid-out marker.
    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeDefined();
  });

  it('completes a stale pending batch whose payout exists on Stripe (metadata match)', async () => {
    // Crash happened AFTER payouts.create succeeded but before
    // markPayoutBatchSubmitted. The payout carries our braketBatchId
    // metadata, so the pre-pass stamps and confirms instead of superseding.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Meta Match Org',
        slug: 'meta-match-org',
        stripeConnectedAccountId: 'acct_meta_match',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Meta Match Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const batchId = await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_meta_match');
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: crash between payouts.create and markPayoutBatchSubmitted.
      const staleBatchId = await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_meta_match-2019-12-31',
        connectedAccountId: 'acct_meta_match',
        amountCents: 2400,
        currency: 'usd',
        status: 'pending',
        origin: 'cron',
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: allocation created with the pending batch.
      await ctx.db.insert('payout_allocations', {
        batchId: staleBatchId,
        connectedAccountId: 'acct_meta_match',
        eventId,
        amountCents: 2400,
        status: 'pending_confirmation',
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      return staleBatchId;
    });

    payoutsListMock.mockResolvedValue({
      data: [
        {
          id: 'po_meta_match',
          status: 'paid',
          metadata: {braketBatchId: batchId},
        },
      ],
    });
    balanceRetrieveMock.mockResolvedValue({
      available: [{amount: 0, currency: 'usd'}],
      pending: [],
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsCreateMock).not.toHaveBeenCalled();

    const batch = await t.run(async (ctx) =>
      ctx.db.get('payout_batches', batchId),
    );
    expect(batch).toMatchObject({
      status: 'paid',
      stripePayoutId: 'po_meta_match',
    });
    const allocations = await t.run(async (ctx) =>
      ctx.db
        .query('payout_allocations')
        .withIndex('by_batchId', (q) => q.eq('batchId', batchId))
        .collect(),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      status: 'paid',
      stripePayoutId: 'po_meta_match',
    });
  });

  it('skips the Stripe submit when the batch is already submitted', async () => {
    // If `createPayoutIntent` returns a batch whose status is already
    // `submitted` (e.g. today's run landed pay but the webhook hasn't
    // confirmed yet), the action's `batch.status !== 'pending'` guard
    // must prevent a second Stripe payout call.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Dedup Org',
        slug: 'dedup-org',
        stripeConnectedAccountId: 'acct_dedup',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dedup Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_dedup');
      // Already-submitted batch awaiting `payout.paid`.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: simulates the "submitted, awaiting confirmation" state.
      await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_dedup-2019-12-31',
        connectedAccountId: 'acct_dedup',
        amountCents: 2400,
        currency: 'usd',
        status: 'submitted',
        stripePayoutId: 'po_already_submitted',
        createdAt: Date.now() - 86_400_000,
        submittedAt: Date.now() - 86_400_000,
      });
    });

    // The submitted payout already drained the balance; its 2400¢ ride as
    // in-flight cents so the trust gate still balances.
    balanceRetrieveMock.mockResolvedValue({
      available: [{amount: 0, currency: 'usd'}],
      pending: [],
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsCreateMock).not.toHaveBeenCalled();
  });

  it('skips the account when the trust gate detects ledger/balance divergence', async () => {
    // The 2026-07 incident shape: the Stripe balance holds more money than
    // the ledger claims (e.g. net-less payment_captured rows). Paying the
    // ledger number would silently short the promoter, so the gate must
    // refuse to pay at all.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Diverged Org',
        slug: 'diverged-org',
        stripeConnectedAccountId: 'acct_diverged',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Diverged Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_diverged');
    });

    // Stripe holds far more than the 2400¢ the ledger knows about.
    balanceRetrieveMock.mockResolvedValue({
      available: [{amount: 10_000, currency: 'usd'}],
      pending: [],
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsCreateMock).not.toHaveBeenCalled();
    const batches = await t.run(async (ctx) =>
      ctx.db
        .query('payout_batches')
        .withIndex('by_connectedAccountId_and_status', (q) =>
          q.eq('connectedAccountId', 'acct_diverged'),
        )
        .collect(),
    );
    expect(batches).toHaveLength(0);
  });

  it('pays out a drafted event with captured revenue', async () => {
    // Regression for the status-driven ledger loss class: an event drafted
    // after revenue was captured must still settle and pay out.
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Drafted Revenue Org',
        slug: 'drafted-revenue-org',
        stripeConnectedAccountId: 'acct_drafted_rev',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Drafted Revenue Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_drafted_rev');
      // Admin drafted the event after sales.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: simulates a status change after revenue capture.
      await ctx.db.patch('events', eventId, {status: 'draft'});
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsCreateMock).toHaveBeenCalledTimes(1);
    const [createParams] = payoutsCreateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(createParams).toMatchObject({amount: 2400, currency: 'usd'});
  });

  it('processes every payout-ready account in one run — no starvation past a batch cap', async () => {
    // Regression: discovery used to return at most PAYOUT_BATCH_SIZE (25)
    // accounts per run with no cursor or rotation. With stable table order,
    // organizers past the cap were skipped on EVERY run — their eligible
    // balances silently never paid. Discovery now pages to completion.
    const t = convexTest();
    const accountCount = 30;
    const accountIds: string[] = [];

    for (let index = 0; index < accountCount; index += 1) {
      const connectedAccountId = `acct_fleet_${String(index).padStart(2, '0')}`;
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: `Fleet Org ${index}`,
          slug: `fleet-org-${index}`,
          stripeConnectedAccountId: connectedAccountId,
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          status: 'published',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: `Fleet Event ${index}`,
        price: 2500,
        totalTickets: 100,
        date: '2020-01-01T00:00:00.000Z',
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      await t.run(async (ctx) => {
        await seedCapturedLedgerRow(ctx, eventId, connectedAccountId);
      });
      accountIds.push(connectedAccountId);
    }

    payoutsCreateMock.mockImplementation(async () => ({
      id: `po_fleet_${payoutsCreateMock.mock.calls.length}`,
    }));

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(payoutsCreateMock).toHaveBeenCalledTimes(accountCount);
    const submittedAccounts = new Set(
      payoutsCreateMock.mock.calls.map(
        (call) => (call[1] as Record<string, unknown>)['stripeAccount'],
      ),
    );
    for (const connectedAccountId of accountIds) {
      expect(submittedAccounts).toContain(connectedAccountId);
    }
  });

  it('fails closed before Stripe when settlement inputs exceed the confirmed-allocation window', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Overflow Org',
        slug: 'overflow-org',
        stripeConnectedAccountId: 'acct_overflow',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Overflow Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) => {
      await seedCapturedLedgerRow(ctx, eventId, 'acct_overflow');
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed: simulates a historical account with enough paid allocation rows to overflow the settlement guard.
      const batchId = await ctx.db.insert('payout_batches', {
        idempotencyKey: 'braket-payout-acct_overflow-old',
        connectedAccountId: 'acct_overflow',
        amountCents: 1_001,
        currency: 'usd',
        status: 'paid',
        stripePayoutId: 'po_overflow_old',
        createdAt: Date.now() - 86_400_000,
        submittedAt: Date.now() - 86_400_000,
        confirmedAt: Date.now() - 86_400_000,
      });
      for (let index = 0; index < 1_001; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Bulk overflow fixture for payout settlement fail-closed coverage.
        await ctx.db.insert('payout_allocations', {
          batchId,
          connectedAccountId: 'acct_overflow',
          eventId,
          amountCents: 1,
          status: 'paid',
          stripePayoutId: 'po_overflow_old',
          createdAt: Date.now() - 86_400_000,
          confirmedAt: Date.now() - 86_400_000,
        });
      }
    });

    await t.action(internal.stripe.actions.processScheduledPayouts, {});

    expect(balanceRetrieveMock).not.toHaveBeenCalled();
    expect(payoutsCreateMock).not.toHaveBeenCalled();
  });
});
