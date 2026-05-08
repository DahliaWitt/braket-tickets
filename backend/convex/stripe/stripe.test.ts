import {createAutoDrainConvexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

const convexTest = createAutoDrainConvexTest();

describe('stripe internal mutations', () => {
  describe('storeConnectedAccountId', () => {
    it('stores stripe account ID on organizer', async () => {
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {name: 'Test Community'},
      );

      await t.mutation(internal.stripe.connect.storeConnectedAccountId, {
        organizerId,
        stripeConnectedAccountId: 'acct_test123',
      });

      const organizer = await t.run(async (ctx) =>
        ctx.db.get('organizers', organizerId),
      );
      expect(organizer?.stripeConnectedAccountId).toBe('acct_test123');
    });

    it('throws when organizer does not exist', async () => {
      const t = convexTest();

      // Create and immediately delete to get a valid but non-existent ID
      const organizerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
        const id = await ctx.db.insert('organizers', {
          name: 'Temp',
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
        await ctx.db.delete(id);
        return id;
      });

      await expect(
        t.mutation(internal.stripe.connect.storeConnectedAccountId, {
          organizerId,
          stripeConnectedAccountId: 'acct_test123',
        }),
      ).rejects.toThrow('Organizer not found');
    });

    it('overwrites existing stripe account ID', async () => {
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Community',
          stripeConnectedAccountId: 'acct_old',
        },
      );

      await t.mutation(internal.stripe.connect.storeConnectedAccountId, {
        organizerId,
        stripeConnectedAccountId: 'acct_new',
      });

      const organizer = await t.run(async (ctx) =>
        ctx.db.get('organizers', organizerId),
      );
      expect(organizer?.stripeConnectedAccountId).toBe('acct_new');
    });
  });

  describe('getOrganizerInternal', () => {
    it('returns organizer document', async () => {
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Community',
          email: 'test@example.com',
          stripeConnectedAccountId: 'acct_test123',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      );

      const organizer = await t.query(internal.stripe.connect.getOrganizerInternal, {
        organizerId,
      });

      expect(organizer).not.toBeNull();
      expect(organizer?.name).toBe('Test Community');
      expect(organizer?.email).toBe('test@example.com');
      expect(organizer?.stripeConnectedAccountId).toBe('acct_test123');
      expect(organizer?.stripeOnboardingStatus).toBe('complete');
      expect(organizer?.stripeChargesEnabled).toBe(true);
      expect(organizer?.stripePayoutsEnabled).toBe(true);
    });

    it('returns null for non-existent organizer', async () => {
      const t = convexTest();

      const organizerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
        const id = await ctx.db.insert('organizers', {
          name: 'Temp',
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
        await ctx.db.delete(id);
        return id;
      });

      const organizer = await t.query(internal.stripe.connect.getOrganizerInternal, {
        organizerId,
      });

      expect(organizer).toBeNull();
    });
  });
});

describe('access._isCommunityAdminOrRoot', () => {
  it('returns true for root admin', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Admin', email: 'admin@test.com', isRootAdmin: true},
    )) as Id<'users'>;
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Community',
    });

    const result = await t.query(internal.lib.access._isCommunityAdminOrRoot, {
      userId: adminId,
      organizerId,
    });
    expect(result).toBe(true);
  });

  it('returns true for community admin', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'commadmin@test.com',
    })) as Id<'users'>;
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Community',
    });
    const granterId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Granter', email: 'granter@test.com', isRootAdmin: true},
    )) as Id<'users'>;
    await t.mutation(api.testing.communities.seedCommunityAdmin, {
      userId,
      organizerId,
      grantedBy: granterId,
    });

    const result = await t.query(internal.lib.access._isCommunityAdminOrRoot, {
      userId,
      organizerId,
    });
    expect(result).toBe(true);
  });

  it('returns false for non-admin user', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular@test.com',
    })) as Id<'users'>;
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Community',
    });

    const result = await t.query(internal.lib.access._isCommunityAdminOrRoot, {
      userId,
      organizerId,
    });
    expect(result).toBe(false);
  });

  it('returns false for non-existent user', async () => {
    const t = convexTest();

    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
      const id = await ctx.db.insert('users', {name: 'Temp'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
      await ctx.db.delete(id);
      return id;
    });
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Community',
    });

    const result = await t.query(internal.lib.access._isCommunityAdminOrRoot, {
      userId,
      organizerId,
    });
    expect(result).toBe(false);
  });
});

// =============================================================================
// Stripe PaymentIntent Order Lookup
// =============================================================================

async function seedCompletedStripeOrder(
  t: ReturnType<typeof convexTest>,
  opts?: {stripePaymentIntentId?: string},
) {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    stripeConnectedAccountId: 'acct_test',
  });

  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Test Event',
    price: 5000,
    totalTickets: 100,
    maxTicketsPerUser: 4,
    date: '2026-06-15',
    status: 'published',
    visibility: 'public',
    organizerId,
  });

  const userId = (await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Test User',
    email: `test-${crypto.randomUUID().slice(0, 8)}@example.com`,
  })) as Id<'users'>;

  const orderId = (await t.mutation(api.testing.orders.seedPayment, {
    userId,
    eventId,
    amount: 5000,
    status: 'completed',
    stripePaymentIntentId: opts?.stripePaymentIntentId ?? 'pi_test_123',
    quantity: 2,
    tier: 'regular',
    trustSource: 'open_access',
  })) as Id<'ticket_orders'>;

  return {organizerId, eventId, userId, orderId};
}

describe('getOrderByStripePaymentIntentId', () => {
  it('finds an order by its Stripe PI ID', async () => {
    const t = convexTest();
    const {orderId} = await seedCompletedStripeOrder(t, {
      stripePaymentIntentId: 'pi_lookup_test',
    });

    const result = await t.query(
      internal.stripe.connect.getOrderByStripePaymentIntentId,
      {
      stripePaymentIntentId: 'pi_lookup_test',
      },
    );
    expect(result).not.toBeNull();
    expect(result!._id).toBe(orderId);
    expect(result!.status).toBe('completed');
    expect(result!.amountCents).toBe(5000);
  });

  it('returns null for unknown PI ID', async () => {
    const t = convexTest();

    const result = await t.query(
      internal.stripe.connect.getOrderByStripePaymentIntentId,
      {
      stripePaymentIntentId: 'pi_nonexistent',
      },
    );
    expect(result).toBeNull();
  });
});
describe('markEventPaidOut', () => {
  it('sets paidOutAt on the event', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await t.mutation(internal.stripe.connect.markEventPaidOut, {eventId});

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');
    expect(event!.paidOutAt!).toBeGreaterThan(0);
  });

  it('is idempotent — calling twice does not update timestamp', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      paidOutAt: 1000,
      organizerId: orgId,
    });

    await t.mutation(internal.stripe.connect.markEventPaidOut, {eventId});

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    // Should keep original timestamp, not overwrite
    expect(event?.paidOutAt).toBe(1000);
  });

  it('throws for non-existent event', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });

    const eventId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
      const id = await ctx.db.insert('events', {
        title: 'Temp',
        price: 0,
        totalTickets: 0,
        date: '2020-01-01',
        status: 'draft',
        visibility: 'public',
        organizerId: orgId,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: create-then-delete to get a non-existent ID
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(internal.stripe.connect.markEventPaidOut, {eventId}),
    ).rejects.toThrow('Event not found');
  });

  it('skips notification when organizer has no email', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'No Email Org',
      slug: 'no-email-org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'No Email Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await t.mutation(internal.stripe.connect.markEventPaidOut, {
      eventId,
      payoutAmountCents: 5000,
    });

    // Event should be marked paid out
    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');

    // No emailDedup entry should be created (email skipped — no organizer email)
    const dedupEntries = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupEntries).toHaveLength(0);
  });

  it('skips notification when payoutAmountCents is zero', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Zero Amount Org',
      slug: 'zero-org',
      email: 'organizer@example.com',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Zero Amount Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await t.mutation(internal.stripe.connect.markEventPaidOut, {
      eventId,
      payoutAmountCents: 0,
    });

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');

    // No emailDedup entry — payout amount is 0, notification skipped
    const dedupEntries = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupEntries).toHaveLength(0);
  });

  it('skips notification when payoutAmountCents is omitted', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'No Amount Org',
      slug: 'no-amount-org',
      email: 'organizer@example.com',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'No Amount Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // No payoutAmountCents passed — notification should be skipped
    await t.mutation(internal.stripe.connect.markEventPaidOut, {eventId});

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');

    const dedupEntries = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupEntries).toHaveLength(0);
  });

  it('is idempotent — second call with paidOutAt set returns early before touching dedup', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Idempotent Org',
      slug: 'idempotent-org',
      email: 'organizer@example.com',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Already Paid Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      paidOutAt: 1000,
      organizerId: orgId,
    });

    // Second call — event already has paidOutAt set, should return early
    await t.mutation(internal.stripe.connect.markEventPaidOut, {
      eventId,
      payoutAmountCents: 5000,
    });

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    // Timestamp must be unchanged
    expect(event?.paidOutAt).toBe(1000);

    // No dedup entry — early return before email logic
    const dedupEntries = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupEntries).toHaveLength(0);
  });

  it('creates emailDedup entry when organizer has email and payoutAmountCents > 0', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Email Org',
      slug: 'email-org',
      email: 'organizer@example.com',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Payout Email Event',
      price: 2500,
      totalTickets: 100,
      date: '2020-01-01',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await t.mutation(internal.stripe.connect.markEventPaidOut, {
      eventId,
      payoutAmountCents: 5000,
    });

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.paidOutAt).toBeTypeOf('number');

    // emailDedup entry must exist — proves the code reached the email-sending branch
    const dedupEntry = await t.run(async (ctx) =>
      ctx.db
        .query('emailDedup')
        .withIndex('by_key', (q) => q.eq('key', `payout-sent-${eventId}`))
        .unique(),
    );
    expect(dedupEntry).not.toBeNull();
    expect(dedupEntry?.key).toBe(`payout-sent-${eventId}`);
  });
});
