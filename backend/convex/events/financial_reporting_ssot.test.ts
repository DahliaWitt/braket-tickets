import {describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

async function seedAdmin(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'users'>> {
  return (await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
    isRootAdmin: true,
  })) as Id<'users'>;
}

async function seedBuyer(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return (await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
  })) as Id<'users'>;
}

async function seedEvent(
  t: ReturnType<typeof convexTest>,
  opts?: {slidingScaleEnabled?: boolean},
): Promise<Id<'events'>> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-${Math.random().toString(36).slice(2, 8)}`,
    stripeConnectedAccountId: 'acct_test_connected',
    stripeOnboardingStatus: 'complete',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
  });

  return await t.run(async (ctx) =>
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- canonical financial test: raw event insert without event_inventory so canonical order fixtures control all counts
    ctx.db.insert('events', {
      title: 'Canonical Revenue Event',
      price: 2500,
      totalTickets: 100,
      date: '2026-06-01',
      status: 'published',
      visibility: 'public',
      organizerId,
      ...(opts?.slidingScaleEnabled
        ? {
            slidingScaleEnabled: true,
            slidingScaleMin: 500,
            slidingScaleMax: 5000,
          }
        : {}),
    }),
  );
}

async function seedCanonicalOrder(
  t: ReturnType<typeof convexTest>,
  args: {
    eventId: Id<'events'>;
    userId: Id<'users'>;
    amountCents: number;
    quantity: number;
    tier: 'regular' | 'notaflof' | 'supporter';
    refundedAmountCents?: number;
    ticketStatuses?: Array<'valid' | 'used' | 'refunded'>;
    completedAt?: number;
  },
): Promise<{orderId: Id<'ticket_orders'>}> {
  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- canonical financial test fixture: raw inserts required to build precise ledger state (order + tickets + financial events) that no single composite produces */
  return await t.run(async (ctx) => {
    const completedAt = args.completedAt ?? Date.now();
    const orderId = await ctx.db.insert('ticket_orders', {
      userId: args.userId,
      eventId: args.eventId,
      kind: 'primary',
      quantity: args.quantity,
      tier: args.tier,
      amountCents: args.amountCents,
      currency: 'USD',
      state: 'completed',
      expiresAt: completedAt + 15 * 60 * 1000,
      completedAt,
      trustSource: 'open_access',
      stripePaymentIntentId: `pi_${args.tier}_${completedAt}`,
      stripeChargeId: `ch_${args.tier}_${completedAt}`,
    });

    const ticketStatuses =
      args.ticketStatuses ??
      Array.from({length: args.quantity}, () => 'valid' as const);

    for (const status of ticketStatuses) {
      await ctx.db.insert('tickets', {
        userId: args.userId,
        eventId: args.eventId,
        orderId,
        status,
        tier: args.tier,
      });
    }

    await ctx.db.insert('order_financial_events', {
      orderId,
      eventId: args.eventId,
      currency: 'USD',
      kind: 'payment_captured',
      amountCents: args.amountCents,
      stripePaymentIntentId: `pi_${args.tier}_${completedAt}`,
      stripeChargeId: `ch_${args.tier}_${completedAt}`,
      occurredAt: completedAt,
    });

    if ((args.refundedAmountCents ?? 0) > 0) {
      await ctx.db.insert('order_financial_events', {
        orderId,
        eventId: args.eventId,
        currency: 'USD',
        kind: 'payment_refunded',
        amountCents: args.refundedAmountCents,
        stripePaymentIntentId: `pi_${args.tier}_${completedAt}`,
        stripeChargeId: `ch_${args.tier}_${completedAt}`,
        stripeRefundId: `re_${args.tier}_${completedAt}`,
        occurredAt: completedAt + 1_000,
      });
    }

    return {orderId};
  });
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
}

describe('canonical financial reporting', () => {
  it('uses canonical orders and ledger entries for tier pricing stats', async () => {
    const t = convexTest();
    const adminId = await seedAdmin(t);
    const buyerId = await seedBuyer(t, 'Buyer', 'buyer@example.com');
    const eventId = await seedEvent(t, {slidingScaleEnabled: true});

    await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 2_000,
      quantity: 2,
      tier: 'notaflof',
      refundedAmountCents: 1_000,
      ticketStatuses: ['valid', 'refunded'],
      completedAt: 1_000,
    });
    await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 1_500,
      quantity: 1,
      tier: 'notaflof',
      ticketStatuses: ['used'],
      completedAt: 2_000,
    });
    await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 3_000,
      quantity: 1,
      tier: 'supporter',
      refundedAmountCents: 3_000,
      ticketStatuses: ['refunded'],
      completedAt: 3_000,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.events.pricing.getEventTierPricingStats,
      {
        eventId,
      },
    );

    expect(result).toEqual({
      tiers: [
        {
          tier: 'notaflof',
          count: 2,
          min: 1_000,
          max: 1_500,
          mean: 1_250,
          median: 1_250,
          mode: [1_000, 1_500],
        },
      ],
    });
  });

  it('builds management revenue from canonical captures and refunds', async () => {
    const t = convexTest();
    const adminId = await seedAdmin(t);
    const buyerId = await seedBuyer(t, 'Buyer', 'buyer@example.com');
    const eventId = await seedEvent(t);

    const partial = await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 5_000,
      quantity: 2,
      tier: 'regular',
      refundedAmountCents: 2_500,
      ticketStatuses: ['valid', 'refunded'],
      completedAt: Date.UTC(2026, 0, 15, 18, 0, 0),
    });
    const fullyRefunded = await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 3_000,
      quantity: 1,
      tier: 'supporter',
      refundedAmountCents: 3_000,
      ticketStatuses: ['refunded'],
      completedAt: Date.UTC(2026, 0, 15, 19, 0, 0),
    });
    await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 1_500,
      quantity: 1,
      tier: 'notaflof',
      ticketStatuses: ['used'],
      completedAt: Date.UTC(2026, 0, 15, 20, 0, 0),
    });
    const projectionlessOrder = await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 2_000,
      quantity: 1,
      tier: 'regular',
      ticketStatuses: ['valid'],
      completedAt: Date.UTC(2026, 0, 15, 21, 0, 0),
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const summary = await asAdmin.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );
    const purchasesData = await asAdmin.action(
      api.events.management.getManagementPurchases,
      {eventId},
    );

    expect(purchasesData.purchases).toHaveLength(4);
    expect(purchasesData.purchases.map((purchase) => purchase.id)).toContain(
      fullyRefunded.orderId,
    );
    expect(purchasesData.purchases.map((purchase) => purchase.id)).toContain(
      partial.orderId,
    );
    expect(purchasesData.purchases.map((purchase) => purchase.id)).toContain(
      projectionlessOrder.orderId,
    );
    expect(
      purchasesData.purchases.find(
        (purchase) => purchase.id === partial.orderId,
      ),
    ).toMatchObject({
      amount: 5_000,
      quantity: 2,
      refundedAmountCents: 2_500,
      status: 'completed',
    });
    expect(
      purchasesData.purchases.find(
        (purchase) => purchase.id === fullyRefunded.orderId,
      ),
    ).toMatchObject({
      amount: 3_000,
      quantity: 1,
      refundedAmountCents: 3_000,
      status: 'refunded',
    });
    expect(
      purchasesData.purchases.find(
        (purchase) => purchase.id === projectionlessOrder.orderId,
      ),
    ).toMatchObject({
      amount: 2_000,
      quantity: 1,
      status: 'completed',
    });
    expect(
      purchasesData.purchases.find(
        (purchase) => purchase.id === projectionlessOrder.orderId,
      ),
    ).not.toHaveProperty('paymentId');

    expect(summary.soldCount).toBe(3);
    expect(summary.tierCounts).toEqual({
      regular: 2,
      notaflof: 1,
      supporter: 0,
    });
    expect(summary.revenue).toEqual({
      grossCents: 11_500,
      processingFeeCents: 249,
      platformFeeCents: 120,
      refundedCents: 5_500,
      lostProcessingFeeCents: 205,
      netCents: 5_426,
    });
    expect(summary.revenueByTier).toEqual({
      regular: {grossCents: 7_000, netCents: 4_147, quantity: 2},
      notaflof: {grossCents: 1_500, netCents: 1_396, quantity: 1},
      supporter: {grossCents: 3_000, netCents: -117, quantity: 0},
    });
  });

  it('keeps zero-dollar completed orders visible in management purchases', async () => {
    const t = convexTest();
    const adminId = await seedAdmin(t);
    const buyerId = await seedBuyer(t, 'Free Buyer', 'free-buyer@example.com');
    const eventId = await seedEvent(t);

    const freeOrder = await seedCanonicalOrder(t, {
      eventId,
      userId: buyerId,
      amountCents: 0,
      quantity: 1,
      tier: 'regular',
      ticketStatuses: ['valid'],
      completedAt: Date.UTC(2026, 0, 16, 20, 0, 0),
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const summary = await asAdmin.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );
    const purchasesData = await asAdmin.action(
      api.events.management.getManagementPurchases,
      {eventId},
    );

    expect(purchasesData.purchases).toHaveLength(1);
    expect(purchasesData.purchases[0]).toMatchObject({
      id: freeOrder.orderId,
      amount: 0,
      quantity: 1,
      status: 'completed',
    });
    expect(summary.revenueByTier.regular).toEqual({
      grossCents: 0,
      netCents: 0,
      quantity: 1,
    });
  });
});
