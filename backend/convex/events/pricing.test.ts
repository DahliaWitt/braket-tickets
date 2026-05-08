import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {ErrorMessages} from '../lib/errors';

let _analyticsSeedCounter = 0;

async function createSlidingScaleEvent(
  t: ReturnType<typeof convexTest>,
  opts?: {title?: string; totalTickets?: number},
): Promise<Id<'events'>> {
  _analyticsSeedCounter += 1;
  const organizerId = (await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-analytics-${_analyticsSeedCounter}`,
  })) as Id<'organizers'>;
  return (await t.mutation(api.testing.events.seedEvent, {
    title: opts?.title ?? 'Scale Event',
    price: 1500,
    totalTickets: opts?.totalTickets ?? 100,
    date: '2026-06-01',
    status: 'published',
    visibility: 'public',
    slidingScaleEnabled: true,
    slidingScaleMin: 500,
    slidingScaleMax: 3000,
    organizerId,
  })) as Id<'events'>;
}

async function createFlatEvent(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'events'>> {
  _analyticsSeedCounter += 1;
  const organizerId = (await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-analytics-flat-${_analyticsSeedCounter}`,
  })) as Id<'organizers'>;
  return (await t.mutation(api.testing.events.seedEvent, {
    title: 'Flat Event',
    price: 2500,
    totalTickets: 100,
    date: '2026-06-01',
    status: 'published',
    visibility: 'public',
    supporterDefaultPrice: 3000,
    organizerId,
  })) as Id<'events'>;
}

async function seedCompletedOrder(
  t: ReturnType<typeof convexTest>,
  args: {
    eventId: Id<'events'>;
    userId: Id<'users'>;
    amountCents: number;
    quantity: number;
    tier: 'regular' | 'notaflof' | 'supporter';
    orderTier?: 'regular' | 'notaflof' | 'supporter';
    refundedAmountCents?: number;
    orderStatus?: 'completed' | 'refunded';
    ticketStatuses?: Array<'valid' | 'used' | 'refunded'>;
  },
): Promise<void> {
  const orderStatus = args.orderStatus ?? 'completed';
  const orderId = await t.mutation(api.testing.orders.seedPayment, {
    userId: args.userId,
    eventId: args.eventId,
    amount: args.amountCents,
    quantity: args.quantity,
    tier: args.orderTier ?? args.tier,
    status: orderStatus,
    trustSource: 'open_access',
  });

  const ticketStatuses =
    args.ticketStatuses ??
    Array.from({length: args.quantity}, () => 'valid' as const);

  for (const status of ticketStatuses) {
    await t.mutation(api.testing.tickets.seedTicket, {
      userId: args.userId,
      eventId: args.eventId,
      orderId,
      status,
      tier: args.tier,
    });
  }
}

async function setupAdmin(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'users'>> {
  return (await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: `admin-analytics-${Date.now()}@test.com`,
    isRootAdmin: true,
  })) as Id<'users'>;
}

describe('getEventTierPricingStats', () => {
  it('returns empty tiers when a flat event has no variable-tier sales', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await createFlatEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });
    expect(result).toEqual({tiers: []});
  });

  it('returns supporter stats for flat events without exposing disabled NOTAFLOF sales', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-flat-supporter@test.com',
    })) as Id<'users'>;
    const eventId = await createFlatEvent(t);

    for (const amount of [3000, 4500]) {
      await seedCompletedOrder(t, {
        eventId,
        userId,
        amountCents: amount,
        quantity: 1,
        tier: 'supporter',
        orderTier: 'supporter',
      });
    }
    await seedCompletedOrder(t, {
      eventId,
      userId,
      amountCents: 1000,
      quantity: 1,
      tier: 'notaflof',
      orderTier: 'notaflof',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });

    expect(result.tiers).toEqual([
      {
        tier: 'supporter',
        count: 2,
        min: 3000,
        max: 4500,
        mean: 3750,
        median: 3750,
        mode: [3000, 4500],
      },
    ]);
  });

  it('returns empty tiers when no completed orders exist', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    _analyticsSeedCounter += 1;
    const organizerId = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: `test-org-analytics-nopay-${_analyticsSeedCounter}`,
    })) as Id<'organizers'>;
    const eventId = (await t.mutation(api.testing.events.seedEvent, {
      title: 'Scale Event',
      price: 1500,
      totalTickets: 100,
      date: '2026-06-01',
      status: 'published',
      visibility: 'public',
      slidingScaleEnabled: true,
      slidingScaleMin: 500,
      slidingScaleMax: 3000,
      organizerId,
    })) as Id<'events'>;
    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });
    expect(result).toEqual({tiers: []});
  });

  it('computes correct per-tier stats for multiple orders', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-stats@test.com',
    })) as Id<'users'>;
    const eventId = await createSlidingScaleEvent(t);

    for (const amount of [500, 1000, 1000, 1500]) {
      await seedCompletedOrder(t, {
        eventId,
        userId,
        amountCents: amount,
        quantity: 1,
        tier: 'notaflof',
        orderTier: 'notaflof',
      });
    }
    for (const amount of [3000, 5000]) {
      await seedCompletedOrder(t, {
        eventId,
        userId,
        amountCents: amount,
        quantity: 1,
        tier: 'supporter',
        orderTier: 'supporter',
      });
    }
    await seedCompletedOrder(t, {
      eventId,
      userId,
      amountCents: 2000,
      quantity: 1,
      tier: 'notaflof',
      orderTier: 'notaflof',
      refundedAmountCents: 2000,
      orderStatus: 'refunded',
      ticketStatuses: ['refunded'],
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });

    expect(result.tiers).toHaveLength(2);

    const notaflof = result.tiers.find(
      (t: {tier: string}) => t.tier === 'notaflof',
    );
    expect(notaflof).toEqual({
      tier: 'notaflof',
      count: 4,
      min: 500,
      max: 1500,
      mean: 1000,
      median: 1000,
      mode: [1000],
    });

    const supporter = result.tiers.find(
      (t: {tier: string}) => t.tier === 'supporter',
    );
    expect(supporter).toEqual({
      tier: 'supporter',
      count: 2,
      min: 3000,
      max: 5000,
      mean: 4000,
      median: 4000,
      mode: [3000, 5000],
    });
  });

  it('excludes pending and failed orders', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-exclude@test.com',
    })) as Id<'users'>;
    _analyticsSeedCounter += 1;
    const organizerId = (await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: `test-org-analytics-exclude-${_analyticsSeedCounter}`,
    })) as Id<'organizers'>;
    const eventId = (await t.mutation(api.testing.events.seedEvent, {
      title: 'Scale Event',
      price: 1500,
      totalTickets: 100,
      date: '2026-06-01',
      status: 'published',
      visibility: 'public',
      slidingScaleEnabled: true,
      slidingScaleMin: 500,
      slidingScaleMax: 3000,
      organizerId,
    })) as Id<'events'>;

    // Seed pending and released orders; only completed captured orders count.
    await t.mutation(api.testing.orders.seedPayment, {
      userId,
      eventId,
      amount: 1000,
      quantity: 1,
      tier: 'notaflof',
      status: 'pending',
      trustSource: 'open_access',
    });
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Direct insert needed to simulate a released checkout without running the release flow. */
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('ticket_orders', {
        userId,
        eventId,
        kind: 'primary',
        amountCents: 2000,
        currency: 'USD',
        quantity: 1,
        tier: 'notaflof',
        state: 'released',
        releaseReason: 'payment_failed',
        expiresAt: now,
        releasedAt: now,
        trustSource: 'open_access',
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });
    expect(result).toEqual({tiers: []});
  });

  it('computes per-ticket price for multi-ticket orders', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-multi@test.com',
    })) as Id<'users'>;
    const eventId = await createSlidingScaleEvent(t);

    await seedCompletedOrder(t, {
      eventId,
      userId,
      amountCents: 2000,
      quantity: 2,
      tier: 'notaflof',
      orderTier: 'notaflof',
    });
    await seedCompletedOrder(t, {
      eventId,
      userId,
      amountCents: 1500,
      quantity: 1,
      tier: 'notaflof',
      orderTier: 'notaflof',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });

    const notaflof = result.tiers.find(
      (t: {tier: string}) => t.tier === 'notaflof',
    );
    // 3 tickets: $10, $10, $15 (not 2 orders: $20, $15)
    expect(notaflof).toEqual({
      tier: 'notaflof',
      count: 3,
      min: 1000,
      max: 1500,
      mean: 1167,
      median: 1000,
      mode: [1000],
    });
  });

  it('does not include fixed regular tier pricing stats', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-canonical@test.com',
    })) as Id<'users'>;
    const eventId = await createSlidingScaleEvent(t);

    await seedCompletedOrder(t, {
      eventId,
      userId,
      amountCents: 1500,
      quantity: 1,
      tier: 'regular',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });

    expect(result).toEqual({tiers: []});
  });

  it('throws when a non-admin requests event pricing stats', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const otherUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Other Buyer',
        email: 'other-buyer@test.com',
      },
    )) as Id<'users'>;
    const sneakyUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Sneaky Non-Admin',
        email: 'sneaky@test.com',
      },
    )) as Id<'users'>;
    const eventId = await createSlidingScaleEvent(t);

    for (const amount of [500, 1000, 1500]) {
      await seedCompletedOrder(t, {
        eventId,
        userId: otherUserId,
        amountCents: amount,
        quantity: 1,
        tier: 'notaflof',
        orderTier: 'notaflof',
      });
    }

    // Admin can see the stats
    const asAdmin = t.withIdentity({subject: adminId});
    const adminResult = await asAdmin.query(
      api.events.pricing.getEventTierPricingStats,
      {eventId},
    );
    expect(adminResult.tiers).toHaveLength(1);
    expect(adminResult.tiers[0].count).toBe(3);

    // Non-admin cannot see other users' orders via RLS
    const asSneaky = t.withIdentity({subject: sneakyUserId});
    await expect(
      asSneaky.query(api.events.pricing.getEventTierPricingStats, {eventId}),
    ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
  });

  it('does not silently truncate pricing stats above 10k completed orders', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Buyer',
      email: 'buyer-10k@test.com',
    })) as Id<'users'>;
    const eventId = await createSlidingScaleEvent(t, {
      title: 'Big Scale Event',
      totalTickets: 20_000,
    });

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 10001 orders/financial-events/tickets; using composites would be prohibitively slow for this perf test */
    await t.run(async (ctx) => {
      for (let i = 0; i < 10001; i += 1) {
        const now = Date.now() + i;
        const orderId = await ctx.db.insert('ticket_orders', {
          userId,
          eventId,
          kind: 'primary',
          quantity: 1,
          tier: 'supporter',
          amountCents: 3000,
          currency: 'USD',
          state: 'completed',
          expiresAt: now + 60_000,
          completedAt: now,
          trustSource: 'open_access',
        });

        await ctx.db.insert('order_financial_events', {
          orderId,
          eventId,
          currency: 'USD',
          kind: 'payment_captured',
          amountCents: 3000,
          occurredAt: now,
        });

        await ctx.db.insert('tickets', {
          userId,
          eventId,
          orderId,
          status: 'valid',
          tier: 'supporter',
        });
      }
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.pricing.getEventTierPricingStats, {
      eventId,
    });

    expect(result.tiers).toHaveLength(1);
    expect(result.tiers[0]).toMatchObject({
      tier: 'supporter',
      count: 10001,
      min: 3000,
      max: 3000,
      mean: 3000,
      median: 3000,
      mode: [3000],
    });
  });
});
