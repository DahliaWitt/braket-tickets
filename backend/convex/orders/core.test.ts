import {describe, expect, it, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {EventVisibility} from '@shared/domain/event-visibility';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {ORDER_RELEASE_GRACE_MS} from '../lib/constants';
import {LEGAL_TERMS_VERSION} from '@shared/constants';

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
  });
}

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
    isRootAdmin: true,
  });
}

async function createGuestSession(
  t: ReturnType<typeof convexTest>,
  email = 'guest@example.com',
  clientKey = `client-${Math.random()}`,
): Promise<{sessionId: Id<'guest_sessions'>; sessionToken: string}> {
  const now = Date.now();
  const sessionToken = `guest-${Date.now()}-${Math.random()}`;
  const sessionId = await t.mutation(
    api.testing.guest_sessions.seedGuestSession,
    {
      email,
      clientKey,
      sessionToken,
      expiresAt: now + 24 * 60 * 60 * 1000,
      lastActiveAt: now,
    },
  );
  return {sessionId, sessionToken};
}

async function createEventWithInventory(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    title: string;
    price: number;
    supporterDefaultPrice: number;
    totalTickets: number;
    maxTicketsPerUser: number;
    visibility: EventVisibility;
    resaleEnabled: boolean;
    ticketSalesStatus: 'active' | 'paused' | 'ended';
    soldCount: number;
    organizerVettingQuestions: Array<{
      id: string;
      question: string;
      type: 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox';
      required: boolean;
      options?: string[];
    }>;
  }> = {},
): Promise<{
  eventId: Id<'events'>;
  organizerId: Id<'organizers'>;
  inventoryId: Id<'event_inventory'>;
}> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Organizer',
    isPlatformOrganizer: true,
    vettingQuestions: overrides.organizerVettingQuestions,
  });

  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: overrides.title ?? 'Test Event',
    price: overrides.price ?? 2500,
    totalTickets: overrides.totalTickets ?? 10,
    maxTicketsPerUser: overrides.maxTicketsPerUser ?? 4,
    date: '2030-12-15',
    visibility: overrides.visibility ?? 'public',
    supporterDefaultPrice: overrides.supporterDefaultPrice,
    resaleEnabled: overrides.resaleEnabled,
    ticketSalesStatus: overrides.ticketSalesStatus ?? 'active',
    soldCount: overrides.soldCount,
    organizerId,
  });

  const inventoryId = await t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId);
    return event!.inventoryId!;
  });

  return {eventId, organizerId, inventoryId};
}

async function createResaleListing(
  t: ReturnType<typeof convexTest>,
  args: {
    sellerId: Id<'users'>;
    eventId: Id<'events'>;
    tier?: 'regular' | 'notaflof' | 'supporter';
    orderId?: Id<'ticket_orders'>;
  },
): Promise<Id<'resale_listings'>> {
  const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
    userId: args.sellerId,
    eventId: args.eventId,
    orderId: args.orderId,
    status: 'valid',
    tier: args.tier ?? 'regular',
    ...(args.orderId ? {} : {trustSource: 'open_access' as const}),
  });

  return await t.mutation(api.testing.resale.seedResaleListing, {
    ticketId,
    eventId: args.eventId,
    sellerId: args.sellerId,
    status: 'listed',
  });
}

describe('orders', () => {
  it('rejects paid orders when organizer payment setup is incomplete', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Payment Setup Buyer',
      'payment-setup-buyer@example.com',
    );
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Incomplete Payment Organizer',
        isPlatformOrganizer: false,
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Payment Setup Event',
      price: 2500,
      totalTickets: 10,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });
    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      }),
    ).rejects.toThrow('has not connected a Stripe account');

    const inventory = await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      return event?.inventoryId ? ctx.db.get(event.inventoryId) : null;
    });
    expect(inventory?.heldCount).toBe(0);
  });

  it('rejects shared trust metadata without a via organizer when seeding an order', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Shared Trust', 'shared@example.com');
    const {eventId} = await createEventWithInventory(t);

    await expect(
      t.mutation(api.testing.orders.seedPayment, {
        userId,
        eventId,
        amount: 2500,
        quantity: 1,
        status: 'completed',
        tier: 'regular',
        trustSource: 'shared',
      }),
    ).rejects.toThrow('Shared trust metadata requires trustViaOrganizerId');
  });

  it('rejects via-organizer metadata for non-shared seeded orders', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Open Access Trust',
      'open-access@example.com',
    );
    const {eventId, organizerId} = await createEventWithInventory(t);

    await expect(
      t.mutation(api.testing.orders.seedPayment, {
        userId,
        eventId,
        amount: 2500,
        quantity: 1,
        status: 'completed',
        tier: 'regular',
        trustSource: 'open_access',
        trustViaOrganizerId: organizerId,
      }),
    ).rejects.toThrow('trustViaOrganizerId is only valid for shared trust');
  });

  it('open returns the same equivalent order and does not double-hold inventory', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Buyer', 'buyer@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t);

    const asUser = t.withIdentity({subject: userId});
    const first = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });
    const second = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });

    expect(second.orderId).toBe(first.orderId);

    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    expect(inventory?.heldCount).toBe(2);
  });

  it('same-owner retry after expiry releases the stale order inline and creates a fresh one', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Buyer', 'buyer2@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t);

    const asUser = t.withIdentity({subject: userId});
    const first = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- forces order expiry to test the stale-order inline-release path; no production mutation or seed helper accepts a past expiresAt
      await ctx.db.patch('ticket_orders', first.orderId, {
        expiresAt: Date.now() - 1,
      });
    });

    const second = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    expect(second.orderId).not.toBe(first.orderId);

    const staleOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', first.orderId),
    );
    const currentOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', second.orderId),
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(staleOrder?.state).toBe('released');
    expect(staleOrder?.releaseReason).toBe('expired');
    expect(currentOrder?.state).toBe('open');
    expect(inventory?.heldCount).toBe(1);
  });

  it('same-owner replacement with a different amount supersedes without leaking held inventory', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Supporter Buyer',
      'supporter-replace@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      supporterDefaultPrice: 3000,
    });

    const asUser = t.withIdentity({subject: userId});
    const first = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'supporter',
      totalAmount: 4000,
    });
    const second = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'supporter',
      totalAmount: 3000,
    });

    expect(second.orderId).not.toBe(first.orderId);

    const firstOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', first.orderId),
    );
    const secondOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', second.orderId),
    );
    let inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(firstOrder?.state).toBe('released');
    expect(firstOrder?.releaseReason).toBe('superseded');
    expect(secondOrder?.state).toBe('open');
    expect(inventory?.heldCount).toBe(1);

    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: second.orderId,
      stripePaymentIntentId: 'pi_superseded_replacement',
      stripeChargeId: 'ch_superseded_replacement',
      note: 'superseded_replacement',
    });

    inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    expect(inventory?.heldCount).toBe(0);
    expect(inventory?.soldCount).toBe(1);
  });

  it('same-owner replacement can reuse held capacity at the sold-out boundary', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Boundary Buyer',
      'boundary-replace@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 2,
      soldCount: 1,
      supporterDefaultPrice: 3000,
    });

    const asUser = t.withIdentity({subject: userId});
    const first = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'supporter',
      totalAmount: 4000,
    });
    const second = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'supporter',
      totalAmount: 3000,
    });

    expect(second.orderId).not.toBe(first.orderId);

    const firstOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', first.orderId),
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(firstOrder?.state).toBe('released');
    expect(firstOrder?.releaseReason).toBe('superseded');
    expect(inventory?.soldCount).toBe(1);
    expect(inventory?.heldCount).toBe(1);
  });

  it('invalid same-owner replacement leaves the existing hold open', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Invalid Replacement Buyer',
      'invalid-replacement@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      supporterDefaultPrice: 3000,
    });

    const asUser = t.withIdentity({subject: userId});
    const first = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'supporter',
      totalAmount: 4000,
    });

    await expect(
      asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'supporter',
        totalAmount: 2600,
      }),
    ).rejects.toThrow('Amount below supporter minimum');

    const firstOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', first.orderId),
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(firstOrder?.state).toBe('open');
    expect(inventory?.heldCount).toBe(1);
  });

  it('internal held inventory reconciliation reports and repairs primary hold drift', async () => {
    const t = convexTest();
    const {eventId, inventoryId} = await createEventWithInventory(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates production counter drift for the internal repair mutation.
      await ctx.db.patch('event_inventory', inventoryId, {heldCount: 5});
    });

    const before = await t.query(
      internal.orders.core.getHeldInventoryReconciliation,
      {eventId},
    );

    expect(before.storedHeldCount).toBe(5);
    expect(before.openPrimaryHeldCount).toBe(0);
    expect(before.drift).toBe(5);

    const repaired = await t.mutation(
      internal.orders.core.repairHeldInventoryCount,
      {eventId, expectedStoredHeldCount: 5},
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(repaired.repaired).toBe(true);
    expect(repaired.storedHeldCount).toBe(0);
    expect(repaired.openPrimaryHeldCount).toBe(0);
    expect(repaired.drift).toBe(0);
    expect(inventory?.heldCount).toBe(0);
  });

  it('openForGuest creates an open order owned by the guest session', async () => {
    const t = convexTest();
    const {eventId, inventoryId} = await createEventWithInventory(t);
    const {sessionId, sessionToken} = await createGuestSession(t);

    const result = await t.mutation(api.orders.core.openForGuest, {
      sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
      termsAccepted: true,
    });

    const order = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(order?.guestSessionId).toBe(sessionId);
    expect(order?.userId).toBeUndefined();
    expect(order?.state).toBe('open');
    expect(inventory?.heldCount).toBe(1);
  });

  it('completes a normal authenticated free claim', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Free Buyer', 'free-buyer@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
    });
    const asUser = t.withIdentity({subject: userId});

    const result = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: 'idem-normal-free-claim',
    });

    const [order, inventory] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('ticket_orders', result.orderId),
        ctx.db.get('event_inventory', inventoryId),
      ]),
    );
    expect(result.success).toBe(true);
    expect(order?.state).toBe('completed');
    expect(order?.amountCents).toBe(0);
    expect(inventory?.soldCount).toBe(1);
    expect(inventory?.heldCount).toBe(0);
  });

  it('replays the completed authenticated free order when the same idempotency key retries, without spending rate limit', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Free Retry Buyer',
      'free-retry-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      maxTicketsPerUser: 4,
    });
    const asUser = t.withIdentity({subject: userId});

    // Same key models the Convex client re-sending an identical mutation after
    // a transient network failure: it must replay the first order, not issue a
    // second ticket.
    const retryKey = 'idem-network-retry';
    const first = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: retryKey,
    });
    const second = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: retryKey,
    });

    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    expect(second.orderId).toBe(first.orderId);
    expect(inventory?.soldCount).toBe(1);
  });

  it('issues a fresh ticket for a legitimate second free claim (new key) under maxTicketsPerUser > 1', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Free Cumulative Buyer',
      'free-cumulative-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      maxTicketsPerUser: 4,
    });
    const asUser = t.withIdentity({subject: userId});

    // First claim.
    const first = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: 'idem-first-claim',
    });
    // A deliberate new claim (e.g. one more for a friend) with an identical
    // (event, tier, quantity) shape but a fresh key must create a new order
    // and issue a real ticket — not silently replay the first.
    const second = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: 'idem-second-claim',
    });

    const [inventory, tickets] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('event_inventory', inventoryId),
        ctx.db
          .query('tickets')
          .withIndex('by_user_event', (q) =>
            q.eq('userId', userId).eq('eventId', eventId),
          )
          .collect(),
      ]),
    );
    expect(second.orderId).not.toBe(first.orderId);
    expect(inventory?.soldCount).toBe(2);
    expect(tickets).toHaveLength(2);
  });

  it('issues a fresh ticket for a legitimate second guest free claim (new key) under maxTicketsPerUser > 1', async () => {
    const t = convexTest();
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      maxTicketsPerUser: 4,
    });
    const {sessionId, sessionToken} = await createGuestSession(t);

    const first = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
      sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      termsAccepted: true,
      idempotencyKey: 'idem-guest-first-claim',
    });
    const second = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
      sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      termsAccepted: true,
      idempotencyKey: 'idem-guest-second-claim',
    });

    const [inventory, tickets] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('event_inventory', inventoryId),
        ctx.db
          .query('tickets')
          .withIndex('by_guestSession_event', (q) =>
            q.eq('guestSessionId', sessionId).eq('eventId', eventId),
          )
          .collect(),
      ]),
    );
    expect(second.orderId).not.toBe(first.orderId);
    expect(inventory?.soldCount).toBe(2);
    expect(tickets).toHaveLength(2);
  });

  it('rejects an idempotency key reused for a different claim instead of silently replaying', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Free Key Reuse Buyer',
      'free-key-reuse-buyer@example.com',
    );
    const firstEvent = await createEventWithInventory(t, {
      title: 'Key Reuse Event 1',
      price: 0,
    });
    const secondEvent = await createEventWithInventory(t, {
      title: 'Key Reuse Event 2',
      price: 0,
    });
    const asUser = t.withIdentity({subject: userId});

    const sharedKey = 'idem-shared-across-claims';
    await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId: firstEvent.eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: sharedKey,
    });

    // Same key, different event: this is a client contract violation and must
    // be rejected loudly, not silently replay the first event's order (which
    // would return success while issuing no ticket for the second event).
    await expect(
      asUser.mutation(api.orders.core.claimFreeTicket, {
        eventId: secondEvent.eventId,
        quantity: 1,
        tier: 'regular',
        idempotencyKey: sharedKey,
      }),
    ).rejects.toThrow();

    const secondInventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', secondEvent.inventoryId),
    );
    expect(secondInventory?.soldCount).toBe(0);
  });

  it('issues a ticket for an old client that omits the idempotency key, still bounded by maxTicketsPerUser', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Legacy Client Buyer',
      'legacy-client-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      // Only one ticket allowed per user: the old-client fresh-claim path must
      // still enforce the per-user limit on a second attempt.
      maxTicketsPerUser: 1,
    });
    const asUser = t.withIdentity({subject: userId});

    // Old website tab loaded before this deploy: no idempotencyKey in args.
    // Convex still runs the call exactly once, so it is a fresh claim.
    const first = await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId,
      quantity: 1,
      tier: 'regular',
    });

    const [order, inventoryAfterFirst] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('ticket_orders', first.orderId),
        ctx.db.get('event_inventory', inventoryId),
      ]),
    );
    expect(first.success).toBe(true);
    expect(order?.state).toBe('completed');
    expect(order?.idempotencyKey).toBeUndefined();
    expect(inventoryAfterFirst?.soldCount).toBe(1);

    // A second keyless claim is a fresh claim too, so it must be bounded by the
    // per-user limit rather than silently replaying — the ticket limit rejects.
    await expect(
      asUser.mutation(api.orders.core.claimFreeTicket, {
        eventId,
        quantity: 1,
        tier: 'regular',
      }),
    ).rejects.toThrow();

    const inventoryAfterSecond = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    expect(inventoryAfterSecond?.soldCount).toBe(1);
  });

  it('issues a ticket for an old guest client that omits the idempotency key', async () => {
    const t = convexTest();
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      maxTicketsPerUser: 1,
    });
    const {sessionToken} = await createGuestSession(t);

    const result = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
      sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      termsAccepted: true,
    });

    const [order, inventory] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('ticket_orders', result.orderId),
        ctx.db.get('event_inventory', inventoryId),
      ]),
    );
    expect(result.success).toBe(true);
    expect(order?.state).toBe('completed');
    expect(order?.idempotencyKey).toBeUndefined();
    expect(inventory?.soldCount).toBe(1);
  });

  it('rejects a blank, over-long, or malformed idempotency key before any persistence', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Bad Key Buyer',
      'bad-key-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      price: 0,
      maxTicketsPerUser: 4,
    });
    const asUser = t.withIdentity({subject: userId});

    // 65 chars: one over the 64-char cap. A direct (non-browser) caller could
    // otherwise write an arbitrarily large value onto every order and index it.
    const overLongKey = 'a'.repeat(65);
    const malformedKey = 'has spaces and *!# punctuation';

    for (const badKey of ['', '   ', overLongKey, malformedKey]) {
      await expect(
        asUser.mutation(api.orders.core.claimFreeTicket, {
          eventId,
          quantity: 1,
          tier: 'regular',
          idempotencyKey: badKey,
        }),
      ).rejects.toThrow();
    }

    const [inventory, orders] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('event_inventory', inventoryId),
        ctx.db
          .query('ticket_orders')
          .withIndex('by_owner_user_event_state', (q) => q.eq('userId', userId))
          .collect(),
      ]),
    );
    // Nothing persisted: no hold, no order, no inventory movement.
    expect(inventory?.soldCount).toBe(0);
    expect(inventory?.heldCount).toBe(0);
    expect(orders).toHaveLength(0);
  });

  it('rate limits authenticated free claims before inventory side effects', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Free Rate Limited Buyer',
      'free-rate-limited-buyer@example.com',
    );
    const firstEvent = await createEventWithInventory(t, {
      title: 'Free Rate Event 1',
      price: 0,
    });
    const secondEvent = await createEventWithInventory(t, {
      title: 'Free Rate Event 2',
      price: 0,
    });
    const blockedEvent = await createEventWithInventory(t, {
      title: 'Free Rate Event 3',
      price: 0,
    });
    const asUser = t.withIdentity({subject: userId});

    await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId: firstEvent.eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: 'idem-rate-auth-1',
    });
    await asUser.mutation(api.orders.core.claimFreeTicket, {
      eventId: secondEvent.eventId,
      quantity: 1,
      tier: 'regular',
      idempotencyKey: 'idem-rate-auth-2',
    });

    await expect(
      asUser.mutation(api.orders.core.claimFreeTicket, {
        eventId: blockedEvent.eventId,
        quantity: 1,
        tier: 'regular',
        idempotencyKey: 'idem-rate-auth-3',
      }),
    ).rejects.toThrow();

    const blockedInventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', blockedEvent.inventoryId),
    );
    expect(blockedInventory?.soldCount).toBe(0);
    expect(blockedInventory?.heldCount).toBe(0);
  });

  it('rate limits guest free claims before inventory side effects', async () => {
    const t = convexTest();
    const firstEvent = await createEventWithInventory(t, {
      title: 'Guest Free Rate Event 1',
      price: 0,
    });
    const secondEvent = await createEventWithInventory(t, {
      title: 'Guest Free Rate Event 2',
      price: 0,
    });
    const blockedEvent = await createEventWithInventory(t, {
      title: 'Guest Free Rate Event 3',
      price: 0,
    });
    const {sessionToken} = await createGuestSession(t);

    await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
      sessionToken,
      eventId: firstEvent.eventId,
      quantity: 1,
      tier: 'regular',
      termsAccepted: true,
      idempotencyKey: 'idem-rate-guest-1',
    });
    await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
      sessionToken,
      eventId: secondEvent.eventId,
      quantity: 1,
      tier: 'regular',
      termsAccepted: true,
      idempotencyKey: 'idem-rate-guest-2',
    });

    await expect(
      t.mutation(api.orders.core.claimFreeTicketAsGuest, {
        sessionToken,
        eventId: blockedEvent.eventId,
        quantity: 1,
        tier: 'regular',
        termsAccepted: true,
        idempotencyKey: 'idem-rate-guest-3',
      }),
    ).rejects.toThrow('RateLimited');

    const blockedInventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', blockedEvent.inventoryId),
    );
    expect(blockedInventory?.soldCount).toBe(0);
    expect(blockedInventory?.heldCount).toBe(0);
  });

  describe('ToS assent evidence (BRA-455)', () => {
    it('openForGuest rejects the order when terms are not accepted', async () => {
      const t = convexTest();
      const {eventId} = await createEventWithInventory(t);
      const {sessionId, sessionToken} = await createGuestSession(t);

      await expect(
        t.mutation(api.orders.core.openForGuest, {
          sessionToken,
          eventId,
          quantity: 1,
          tier: 'regular',
          totalAmount: 2500,
          termsAccepted: false,
        }),
      ).rejects.toThrow('accept the terms of service');

      const orders = await t.run(async (ctx) =>
        ctx.db
          .query('ticket_orders')
          .withIndex('by_owner_guest_event_state', (q) =>
            q.eq('guestSessionId', sessionId).eq('eventId', eventId),
          )
          .collect(),
      );
      expect(orders).toHaveLength(0);
    });

    it('openForGuest stamps ToS assent evidence when terms are accepted', async () => {
      const t = convexTest();
      const {eventId} = await createEventWithInventory(t);
      const {sessionToken} = await createGuestSession(t);
      const before = Date.now();

      const result = await t.mutation(api.orders.core.openForGuest, {
        sessionToken,
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
        termsAccepted: true,
      });

      const order = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', result.orderId),
      );

      expect(typeof order?.tosAcceptedAt).toBe('number');
      expect(order!.tosAcceptedAt!).toBeGreaterThanOrEqual(before);
      expect(order!.tosAcceptedAt!).toBeLessThanOrEqual(Date.now());
      expect(order?.tosVersion).toBe(LEGAL_TERMS_VERSION);
    });

    it('claimFreeTicketAsGuest rejects the claim when terms are not accepted', async () => {
      const t = convexTest();
      const {eventId} = await createEventWithInventory(t, {price: 0});
      const {sessionId, sessionToken} = await createGuestSession(t);

      await expect(
        t.mutation(api.orders.core.claimFreeTicketAsGuest, {
          sessionToken,
          eventId,
          quantity: 1,
          tier: 'regular',
          termsAccepted: false,
          idempotencyKey: 'idem-guest-terms-rejected',
        }),
      ).rejects.toThrow('accept the terms of service');

      const orders = await t.run(async (ctx) =>
        ctx.db
          .query('ticket_orders')
          .withIndex('by_owner_guest_event_state', (q) =>
            q.eq('guestSessionId', sessionId).eq('eventId', eventId),
          )
          .collect(),
      );
      expect(orders).toHaveLength(0);
    });

    it('claimFreeTicketAsGuest stamps ToS assent evidence when terms are accepted', async () => {
      const t = convexTest();
      const {eventId} = await createEventWithInventory(t, {price: 0});
      const {sessionToken} = await createGuestSession(t);
      const before = Date.now();

      const result = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
        sessionToken,
        eventId,
        quantity: 1,
        tier: 'regular',
        termsAccepted: true,
        idempotencyKey: 'idem-guest-tos-stamp',
      });

      const order = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', result.orderId),
      );

      expect(order?.state).toBe('completed');
      expect(typeof order?.tosAcceptedAt).toBe('number');
      expect(order!.tosAcceptedAt!).toBeGreaterThanOrEqual(before);
      expect(order!.tosAcceptedAt!).toBeLessThanOrEqual(Date.now());
      expect(order?.tosVersion).toBe(LEGAL_TERMS_VERSION);
    });

    it('claimFreeTicketAsGuest replays the existing completed order without re-checking terms', async () => {
      const t = convexTest();
      const {eventId} = await createEventWithInventory(t, {price: 0});
      const {sessionToken} = await createGuestSession(t);

      const replayKey = 'idem-guest-replay';
      const first = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
        sessionToken,
        eventId,
        quantity: 1,
        tier: 'regular',
        termsAccepted: true,
        idempotencyKey: replayKey,
      });

      // Idempotent replay must short-circuit on the existing completed order
      // (same key) BEFORE the terms check, so a stale/false client value on
      // retry does not fail an already-completed claim.
      const second = await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
        sessionToken,
        eventId,
        quantity: 1,
        tier: 'regular',
        termsAccepted: false,
        idempotencyKey: replayKey,
      });

      expect(second.success).toBe(true);
      expect(second.orderId).toBe(first.orderId);
    });

    it('open (signed-in) creates an order without ToS assent fields', async () => {
      const t = convexTest();
      const userId = await createUser(
        t,
        'Signed In Buyer',
        'signed-in-buyer@example.com',
      );
      const {eventId} = await createEventWithInventory(t);
      const asUser = t.withIdentity({subject: userId});

      const result = await asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      });

      const order = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', result.orderId),
      );

      expect(order?.tosAcceptedAt).toBeUndefined();
      expect(order?.tosVersion).toBeUndefined();
    });

    it('claimFreeTicket (signed-in) creates an order without ToS assent fields', async () => {
      const t = convexTest();
      const userId = await createUser(
        t,
        'Signed In Free Buyer',
        'signed-in-free-buyer@example.com',
      );
      const {eventId} = await createEventWithInventory(t, {price: 0});
      const asUser = t.withIdentity({subject: userId});

      const result = await asUser.mutation(api.orders.core.claimFreeTicket, {
        eventId,
        quantity: 1,
        tier: 'regular',
        idempotencyKey: 'idem-signed-in-no-tos',
      });

      const order = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', result.orderId),
      );

      expect(order?.tosAcceptedAt).toBeUndefined();
      expect(order?.tosVersion).toBeUndefined();
    });
  });

  it('does not apply the free-claim rate limit to paid checkout opens', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Paid Buyer', 'paid-buyer@example.com');
    const firstEvent = await createEventWithInventory(t, {
      title: 'Paid Rate Event 1',
    });
    const secondEvent = await createEventWithInventory(t, {
      title: 'Paid Rate Event 2',
    });
    const thirdEvent = await createEventWithInventory(t, {
      title: 'Paid Rate Event 3',
    });
    const asUser = t.withIdentity({subject: userId});

    await asUser.mutation(api.orders.core.open, {
      eventId: firstEvent.eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });
    await asUser.mutation(api.orders.core.open, {
      eventId: secondEvent.eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    const third = await asUser.mutation(api.orders.core.open, {
      eventId: thirdEvent.eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    expect(third.state).toBe('open');
  });

  it('releases an order for caller-reported payment failures', async () => {
    const t = convexTest();
    const buyerId = await createUser(
      t,
      'Failure Buyer',
      'failure-buyer@example.com',
    );
    const {eventId} = await createEventWithInventory(t);
    const asBuyer = t.withIdentity({subject: buyerId});
    const result = await asBuyer.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    await t.mutation(internal.orders.core.releaseForPaymentFailure, {
      orderId: result.orderId,
      errorCode: 'connected_account_mismatch',
      failureStage: 'checkout_session',
    });

    const releasedOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    expect(releasedOrder?.state).toBe('released');
    expect(releasedOrder?.releaseReason).toBe('payment_failed');
  });

  it('allows different guest emails to open independent holds', async () => {
    const t = convexTest();
    const sharedClientKey = 'shared-browser-client';
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const firstSession = await createGuestSession(
      t,
      'alpha@example.com',
      sharedClientKey,
    );
    const secondSession = await createGuestSession(
      t,
      'beta@example.com',
      sharedClientKey,
    );

    const firstOrder = await t.mutation(api.orders.core.openForGuest, {
      sessionToken: firstSession.sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
      termsAccepted: true,
    });
    const secondOrder = await t.mutation(api.orders.core.openForGuest, {
      sessionToken: secondSession.sessionToken,
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
      termsAccepted: true,
    });

    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(secondOrder.orderId).not.toBe(firstOrder.orderId);
    expect(inventory?.heldCount).toBe(2);
  });

  it('blocks unvetted authenticated users from opening private-event orders', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Untrusted', 'untrusted@example.com');
    const {eventId} = await createEventWithInventory(t, {
      visibility: 'private',
      organizerVettingQuestions: [
        {
          id: 'why',
          question: 'Why do you want to attend?',
          type: 'text',
          required: true,
        },
      ],
    });

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      }),
    ).rejects.toThrow('community vetting process');
  });

  it('prevents other users from reading an order they do not own', async () => {
    const t = convexTest();
    const ownerId = await createUser(t, 'Owner', 'owner@example.com');
    const otherUserId = await createUser(t, 'Other', 'other@example.com');
    const {eventId} = await createEventWithInventory(t);

    const owner = t.withIdentity({subject: ownerId});
    const other = t.withIdentity({subject: otherUserId});

    const order = await owner.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    await expect(
      other.query(api.orders.core.getCheckoutStatus, {orderId: order.orderId}),
    ).rejects.toThrow();
  });

  it('resale checkout reserves the oldest listed resale listing without touching primary holds', async () => {
    const t = convexTest();
    const sellerId = await createUser(t, 'Seller', 'seller@example.com');
    const buyerId = await createUser(t, 'Buyer', 'buyer3@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
    });

    const listingId = await createResaleListing(t, {sellerId, eventId});
    const asBuyer = t.withIdentity({subject: buyerId});
    const result = await asBuyer.mutation(api.orders.core.openResale, {
      eventId,
      tier: 'regular',
      totalAmount: 2500,
    });

    const order = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    const listing = await t.run(async (ctx) =>
      ctx.db.get('resale_listings', listingId),
    );
    const inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );

    expect(order?.kind).toBe('resale');
    expect(order?.resaleListingId).toBe(listingId);
    expect(listing?.status).toBe('pending');
    expect(listing?.pendingOrderId).toBe(result.orderId);
    expect(inventory?.heldCount).toBe(0);
  });

  it('resale checkout skips the buyer-owned oldest listing and reserves the next eligible listing', async () => {
    const t = convexTest();
    const buyerId = await createUser(
      t,
      'Buyer Seller',
      'buyerseller@example.com',
    );
    const otherSellerId = await createUser(
      t,
      'Other Seller',
      'other-seller@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
    });

    const buyerListingId = await createResaleListing(t, {
      sellerId: buyerId,
      eventId,
    });
    const eligibleListingId = await createResaleListing(t, {
      sellerId: otherSellerId,
      eventId,
    });

    const asBuyer = t.withIdentity({subject: buyerId});
    const result = await asBuyer.mutation(api.orders.core.openResale, {
      eventId,
      tier: 'regular',
      totalAmount: 2500,
    });

    const order = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    const buyerListing = await t.run(async (ctx) =>
      ctx.db.get('resale_listings', buyerListingId),
    );
    const eligibleListing = await t.run(async (ctx) =>
      ctx.db.get('resale_listings', eligibleListingId),
    );

    expect(order?.resaleListingId).toBe(eligibleListingId);
    expect(buyerListing?.status).toBe('listed');
    expect(eligibleListing?.status).toBe('pending');
    expect(eligibleListing?.pendingOrderId).toBe(result.orderId);
  });

  it('resale checkout requires an eligible listing for the requested tier', async () => {
    const t = convexTest();
    const sellerId = await createUser(
      t,
      'Regular Seller',
      'regular-seller@example.com',
    );
    const buyerId = await createUser(
      t,
      'Supporter Buyer',
      'supporter-buyer@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
      supporterDefaultPrice: 5000,
    });

    await createResaleListing(t, {
      sellerId,
      eventId,
      tier: 'regular',
    });

    const asBuyer = t.withIdentity({subject: buyerId});
    await expect(
      asBuyer.mutation(api.orders.core.openResale, {
        eventId,
        tier: 'supporter',
        totalAmount: 5000,
      }),
    ).rejects.toThrow('No resale tickets are available');
  });

  it('resale settlement issues the buyer ticket with the canonical order link', async () => {
    const t = convexTest();
    const sellerId = await createUser(
      t,
      'Supporter Seller',
      'supporter-seller@example.com',
    );
    const buyerId = await createUser(
      t,
      'Supporter Buyer',
      'supporter@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
      supporterDefaultPrice: 5000,
    });

    await createResaleListing(t, {
      sellerId,
      eventId,
      tier: 'supporter',
    });

    const asBuyer = t.withIdentity({subject: buyerId});
    const order = await asBuyer.mutation(api.orders.core.openResale, {
      eventId,
      tier: 'supporter',
      totalAmount: 5000,
    });

    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_resale_supporter',
      stripeChargeId: 'ch_resale_supporter',
      note: 'resale_test',
    });

    const buyerTickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', buyerId).eq('eventId', eventId),
        )
        .collect(),
    );

    const activeBuyerTickets = buyerTickets.filter(
      (ticket) => ticket.status === 'valid',
    );
    expect(activeBuyerTickets).toHaveLength(1);
    expect(activeBuyerTickets[0]?.tier).toBe('supporter');
    expect(activeBuyerTickets[0]?.orderId).toBe(order.orderId);
  });

  it('rejects resale settlement when the listing is no longer pending', async () => {
    const t = convexTest();
    const sellerId = await createUser(
      t,
      'Supporter Seller',
      'supporter-seller-2@example.com',
    );
    const buyerId = await createUser(
      t,
      'Supporter Buyer',
      'supporter-buyer-2@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
      supporterDefaultPrice: 5000,
    });

    const listingId = await createResaleListing(t, {
      sellerId,
      eventId,
      tier: 'supporter',
    });

    const asBuyer = t.withIdentity({subject: buyerId});
    const order = await asBuyer.mutation(api.orders.core.openResale, {
      eventId,
      tier: 'supporter',
      totalAmount: 5000,
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a stale resale listing that was reopened outside the pending order path
      await ctx.db.patch('resale_listings', listingId, {
        status: 'listed',
        buyerId: undefined,
        pendingOrderId: undefined,
      });
    });

    await expect(
      t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_resale_supporter_not_pending',
        stripeChargeId: 'ch_resale_supporter_not_pending',
        note: 'resale_test',
      }),
    ).rejects.toThrow('listing is not in the expected state');
  });

  it('settles late invalid payments by refunding instead of issuing tickets', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const firstBuyerId = await createUser(
      t,
      'First Buyer',
      'first@example.com',
    );
    const secondBuyerId = await createUser(
      t,
      'Second Buyer',
      'second@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 1,
    });

    const firstBuyer = t.withIdentity({subject: firstBuyerId});
    const secondBuyer = t.withIdentity({subject: secondBuyerId});

    try {
      const firstOrder = await firstBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      });
      await t.mutation(internal.orders.core.expire, {
        orderId: firstOrder.orderId,
        force: true,
      });

      const secondOrder = await secondBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: secondOrder.orderId,
        stripePaymentIntentId: 'pi_live_second',
        stripeChargeId: 'ch_live_second',
        note: 'second_payment',
      });

      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: firstOrder.orderId,
        stripePaymentIntentId: 'pi_late_first',
        stripeChargeId: 'ch_late_first',
        note: 'late_payment',
      });

      const lateOrder = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', firstOrder.orderId),
      );
      const lateEvents = await t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', firstOrder.orderId))
          .collect(),
      );
      const inventory = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );
      const lateTickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', firstOrder.orderId))
          .collect(),
      );

      expect(lateOrder?.state).toBe('released');
      expect(lateOrder?.releaseReason).toBe('late_invalid');
      expect(lateTickets).toHaveLength(0);
      expect(inventory?.soldCount).toBe(1);
      expect(lateEvents.map((event) => event.kind)).toEqual([
        'late_payment_after_release',
        'payment_refunded',
      ]);
      expect(lateEvents[1]?.stripeRefundId).toBeDefined();
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('scheduler-fired expiry releases the hold without operator intervention', async () => {
    // Production expiry is driven by the scheduler registered inside
    // openPrimaryOrderState — ORDER_RELEASE_GRACE_MS after expiresAt. Other
    // tests call internal.orders.core.expire directly; this one exercises the real
    // scheduled path so a regression in the scheduler registration or
    // releaseOpenOrder idempotency guard would surface.
    vi.useFakeTimers();
    try {
      const t = convexTest();
      const userId = await createUser(
        t,
        'Scheduler Buyer',
        'scheduler@example.com',
      );
      const {eventId, inventoryId} = await createEventWithInventory(t, {
        totalTickets: 10,
      });
      const asUser = t.withIdentity({subject: userId});

      const order = await asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });

      const beforeExpiry = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );
      expect(beforeExpiry?.heldCount).toBe(2);

      // Fast-forward well past the grace period; the scheduler's expire
      // callback should fire and release the hold.
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      await finishAllScheduledFunctions(t);

      const releasedOrder = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', order.orderId),
      );
      const afterExpiry = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );

      expect(releasedOrder?.state).toBe('released');
      expect(releasedOrder?.releaseReason).toBe('expired');
      expect(afterExpiry?.heldCount).toBe(0);
      expect(afterExpiry?.soldCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reschedules expiry when checkout extends the reservation past the original job', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    try {
      const t = convexTest();
      const userId = await createUser(
        t,
        'Extended Reservation Buyer',
        'extended-reservation@example.com',
      );
      const {eventId, inventoryId} = await createEventWithInventory(t, {
        totalTickets: 10,
      });
      const asUser = t.withIdentity({subject: userId});

      const order = await asUser.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });
      const extendedExpiresAt = Date.now() + 60 * 60 * 1000;

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Force the exact checkout-extension race: scheduled job fires before the extended reservation expires.
        await ctx.db.patch('ticket_orders', order.orderId, {
          expiresAt: extendedExpiresAt,
        });
      });

      vi.advanceTimersByTime(32 * 60 * 1000 + 1);
      await finishAllScheduledFunctions(t);

      let currentOrder = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', order.orderId),
      );
      let inventory = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );
      expect(currentOrder?.state).toBe('open');
      expect(inventory?.heldCount).toBe(2);

      vi.advanceTimersByTime(60 * 60 * 1000 + ORDER_RELEASE_GRACE_MS);
      await finishAllScheduledFunctions(t);

      currentOrder = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', order.orderId),
      );
      inventory = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );
      expect(currentOrder?.state).toBe('released');
      expect(currentOrder?.releaseReason).toBe('expired');
      expect(inventory?.heldCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('full lifecycle: open → settle moves held → sold atomically and creates valid tickets', async () => {
    // Covers the canonical sale path end-to-end so a regression in either the
    // inventory transition or ticket insertion side trips this test.
    const t = convexTest();
    const userId = await createUser(t, 'Lifecycle Buyer', 'life@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 10,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 3,
      tier: 'regular',
      totalAmount: 7500,
    });

    // Mid-order assertion: inventory reflects a live hold, nothing sold yet.
    let inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    expect(inventory?.heldCount).toBe(3);
    expect(inventory?.soldCount).toBe(0);

    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_lifecycle',
      stripeChargeId: 'ch_lifecycle',
      note: 'lifecycle_settle',
    });

    inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    const completedOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', order.orderId),
    );
    const tickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );

    expect(completedOrder?.state).toBe('completed');
    // soldCount and heldCount move as a pair — the invariant that protects
    // remaining = total - sold - held.
    expect(inventory?.heldCount).toBe(0);
    expect(inventory?.soldCount).toBe(3);
    // Ticket count must match the inventory transition — same quantity, no drift.
    expect(tickets).toHaveLength(3);
    expect(tickets.every((ticket) => ticket.status === 'valid')).toBe(true);
    expect(tickets.some((ticket) => 'paymentId' in ticket)).toBe(false);
  });

  it('completion preserves the checkout session id for webhook-first buyer sync', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Webhook First Buyer',
      'webhook-first@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 10,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    await t.mutation(internal.orders.core.bindCheckoutSession, {
      orderId: order.orderId,
      stripeCheckoutSessionId: 'cs_webhook_first',
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_webhook_first',
      stripeChargeId: 'ch_webhook_first',
      note: 'webhook_first_regression',
    });

    const completedOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', order.orderId),
    );

    expect(completedOrder?.state).toBe('completed');
    expect(completedOrder?.stripeCheckoutSessionId).toBe('cs_webhook_first');
    expect(completedOrder?.stripePaymentIntentId).toBe('pi_webhook_first');
    expect(completedOrder?.stripeChargeId).toBe('ch_webhook_first');
  });

  it('expired-then-paid recovery: releases hold, then completing adds soldCount without re-decrementing heldCount', async () => {
    // Simulates the Stripe race: order expired locally, webhook arrives later
    // confirming payment. completePrimaryOrderState takes the releaseReason='expired'
    // branch which only increments soldCount — correct because releaseOpenOrder
    // already decremented heldCount at expiry time.
    const t = convexTest();
    const userId = await createUser(
      t,
      'Recovery Buyer',
      'recovery@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });

    // Simulate expiry: heldCount should drop back to 0.
    await t.mutation(internal.orders.core.expire, {
      orderId: order.orderId,
      force: true,
    });

    const postExpireInventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    const expiredOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', order.orderId),
    );
    expect(expiredOrder?.state).toBe('released');
    expect(expiredOrder?.releaseReason).toBe('expired');
    expect(postExpireInventory?.heldCount).toBe(0);
    expect(postExpireInventory?.soldCount).toBe(0);

    // Late Stripe webhook arrives. completePrimaryOrderState must handle this
    // path without double-decrementing heldCount (would underflow past 0) and
    // without leaving the order stuck in 'released'.
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_recovery_late',
      stripeChargeId: 'ch_recovery_late',
      note: 'expired_recovery',
    });

    const recoveredOrder = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', order.orderId),
    );
    const finalInventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    const recoveredTickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );

    expect(recoveredOrder?.state).toBe('completed');
    expect(finalInventory?.heldCount).toBe(0);
    expect(finalInventory?.soldCount).toBe(2);
    expect(recoveredTickets).toHaveLength(2);
    expect(recoveredTickets.every((ticket) => ticket.status === 'valid')).toBe(
      true,
    );
  });

  it('getManagementSummary exposes canonical isSoldOut / heldCount / remainingCount sourced from inventory', async () => {
    // Regression guard for the frontend divergence bug — event-management was
    // recomputing isSoldOut client-side and ignoring heldCount, so admins saw
    // "not sold out" while public cards said "sold out". Server now ships the
    // canonical values and the frontend reads them directly.
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Mgmt Admin', 'mgmt@example.com');
    // Use distinct buyers so the dedup-by-owner logic in openPrimaryOrderState
    // doesn't release our first hold when we open the second order.
    const holdingBuyerId = await createUser(
      t,
      'Holding Buyer',
      'hold@example.com',
    );
    const payingBuyerId = await createUser(
      t,
      'Paying Buyer',
      'pay@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 10,
      // Default maxTicketsPerUser is 4; bump it so the holding buyer can
      // reserve 7 seats in a single order.
      maxTicketsPerUser: 10,
    });
    const asHoldingBuyer = t.withIdentity({subject: holdingBuyerId});
    const asPayingBuyer = t.withIdentity({subject: payingBuyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    // Set up a mid-flight state: 3 sold + 7 held = 10 total (sold-out only via
    // holds). Holding buyer keeps 7 open, paying buyer completes 3.
    await asHoldingBuyer.mutation(api.orders.core.open, {
      eventId,
      quantity: 7,
      tier: 'regular',
      totalAmount: 17500,
    });
    const soldOrder = await asPayingBuyer.mutation(api.orders.core.open, {
      eventId,
      quantity: 3,
      tier: 'regular',
      totalAmount: 7500,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: soldOrder.orderId,
      stripePaymentIntentId: 'pi_mgmt_sold',
      stripeChargeId: 'ch_mgmt_sold',
      note: 'mgmt_sold',
    });

    const data = await asAdmin.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );

    expect(data.soldCount).toBe(3);
    expect(data.heldCount).toBe(7);
    expect(data.remainingCount).toBe(0);
    expect(data.isSoldOut).toBe(true);
    expect(data.totalTickets).toBe(10);
  });

  it('getManagementSummary public action surfaces canonical inventory shape and writes an audit log', async () => {
    // Sibling to the internalQuery shape test above. Exercises the public action
    // wrapper end-to-end so the auth gate + audit-log path can't silently
    // regress the canonical sold/held/remaining/isSoldOut contract.
    const t = convexTest();
    const adminId = await createRootAdmin(
      t,
      'Action Admin',
      'action-admin@example.com',
    );
    const holdingBuyerId = await createUser(
      t,
      'Action Holder',
      'action-hold@example.com',
    );
    const payingBuyerId = await createUser(
      t,
      'Action Payer',
      'action-pay@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 10,
      maxTicketsPerUser: 10,
    });
    const asHoldingBuyer = t.withIdentity({subject: holdingBuyerId});
    const asPayingBuyer = t.withIdentity({subject: payingBuyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    await asHoldingBuyer.mutation(api.orders.core.open, {
      eventId,
      quantity: 7,
      tier: 'regular',
      totalAmount: 17500,
    });
    const soldOrder = await asPayingBuyer.mutation(api.orders.core.open, {
      eventId,
      quantity: 3,
      tier: 'regular',
      totalAmount: 7500,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: soldOrder.orderId,
      stripePaymentIntentId: 'pi_action_sold',
      stripeChargeId: 'ch_action_sold',
      note: 'action_sold',
    });

    const data = await asAdmin.action(
      api.events.management.getManagementSummary,
      {
        eventId,
      },
    );

    expect(data.soldCount).toBe(3);
    expect(data.heldCount).toBe(7);
    expect(data.remainingCount).toBe(0);
    expect(data.isSoldOut).toBe(true);

    const auditLogs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', adminId))
        .collect(),
    );
    expect(
      auditLogs.some(
        (log) =>
          log.action === 'event.management.view' && log.eventId === eventId,
      ),
    ).toBe(true);
  });

  it('applies external refunds incrementally instead of revoking every ticket at once', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Refund Buyer', 'refund@example.com');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_partial_refund',
      stripeChargeId: 'ch_partial_refund',
      note: 'initial_payment',
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_partial_1',
    });

    let tickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );
    let inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    let financialEvents = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );

    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(1);
    expect(tickets.filter((ticket) => ticket.status === 'valid')).toHaveLength(
      1,
    );
    expect(inventory?.soldCount).toBe(1);
    expect(
      financialEvents
        .filter((event) => event.kind === 'payment_refunded')
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
    ).toBe(2500);

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_partial_2',
    });

    tickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );
    inventory = await t.run(async (ctx) =>
      ctx.db.get('event_inventory', inventoryId),
    );
    financialEvents = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );

    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(2);
    expect(inventory?.soldCount).toBe(0);
    expect(
      financialEvents
        .filter((event) => event.kind === 'payment_refunded')
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
    ).toBe(5000);
  });

  it('keeps per-refund ledger amounts separate from cumulative external refund state', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Out Of Order Refund Buyer',
      'out-of-order-refund@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_out_of_order_refund',
      stripeChargeId: 'ch_out_of_order_refund',
      note: 'initial_payment',
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_partial_2',
      ledgerRefundAmountCents: 2500,
      connectedAccountNetCents: -2400,
    });

    let [tickets, inventory, financialEvents] = await Promise.all([
      t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
      t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
    ]);

    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(2);
    expect(inventory?.soldCount).toBe(0);
    expect(
      financialEvents
        .filter((event) => event.kind === 'payment_refunded')
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
    ).toBe(2500);

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_partial_1',
      ledgerRefundAmountCents: 2500,
      connectedAccountNetCents: -2400,
    });

    [tickets, inventory, financialEvents] = await Promise.all([
      t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
      t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
    ]);

    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(2);
    expect(inventory?.soldCount).toBe(0);
    expect(
      financialEvents
        .filter((event) => event.kind === 'payment_refunded')
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
    ).toBe(5000);
  });

  it('enriches a bare capture ledger row with Stripe settlement fields', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Capture Enrichment Buyer',
      'capture-enrichment@example.com',
    );
    const {eventId} = await createEventWithInventory(t);
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_capture_enrich',
      stripeChargeId: 'ch_capture_enrich',
      stripeEventId: 'evt_checkout_complete',
      note: 'checkout.session.completed',
    });

    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId: order.orderId,
      eventId,
      kind: 'payment_captured',
      amountCents: 2500,
      stripePaymentIntentId: 'pi_capture_enrich',
      stripeChargeId: 'ch_capture_enrich',
      stripeEventId: 'evt_checkout_complete',
      processorFeeCents: 100,
      platformFeeCents: 50,
      connectedAccountNetCents: 2350,
    });

    const captures = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind', (q) =>
          q.eq('orderId', order.orderId).eq('kind', 'payment_captured'),
        )
        .collect(),
    );

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      amountCents: 2500,
      processorFeeCents: 100,
      platformFeeCents: 50,
      connectedAccountNetCents: 2350,
    });
  });

  it('enriches an existing refund ledger row with Stripe settlement fields', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Refund Enrichment Buyer',
      'refund-enrichment@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {totalTickets: 5});
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_refund_enrich',
      stripeChargeId: 'ch_refund_enrich',
      note: 'initial_payment',
    });
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_refund_enrich',
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_refund_enrich',
      processorFeeCents: 0,
      platformFeeCents: -50,
      connectedAccountNetCents: -2450,
    });

    const refunds = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind_and_stripeRefundId', (q) =>
          q
            .eq('orderId', order.orderId)
            .eq('kind', 'payment_refunded')
            .eq('stripeRefundId', 're_refund_enrich'),
        )
        .collect(),
    );

    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amountCents: 2500,
      processorFeeCents: 0,
      platformFeeCents: -50,
      connectedAccountNetCents: -2450,
    });
  });

  it('maps rounded-full external refunds to all tickets for uneven per-ticket pricing', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Rounded Refund Buyer',
      'rounded-refund@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 3,
      tier: 'regular',
      totalAmount: 7500,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_external_refund_edge',
      stripeChargeId: 'ch_external_refund_edge',
      note: 'initial_payment',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- creates a legacy uneven order total to exercise external refund inference
      await ctx.db.patch('ticket_orders', order.orderId, {
        amountCents: 10_001,
      });
      const capture = await ctx.db
        .query('order_financial_events')
        .withIndex('by_order_and_kind', (q) =>
          q.eq('orderId', order.orderId).eq('kind', 'payment_captured'),
        )
        .first();
      if (!capture) throw new Error('Expected capture event');
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- keeps the synthetic legacy ledger consistent with the patched order total
      await ctx.db.patch('order_financial_events', capture._id, {
        amountCents: 10_001,
      });
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId: order.orderId,
      refundedAmountCents: 10001,
      stripeRefundId: 're_full_rounded',
    });

    const [tickets, inventory, financialEvents] = await Promise.all([
      t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
      t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      ),
    ]);

    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(3);
    expect(inventory?.soldCount).toBe(0);
    expect(
      financialEvents
        .filter((event) => event.kind === 'payment_refunded')
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
    ).toBe(10001);
  });

  it('admin partial refunds append canonical ledger events without fully refunding the order', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-refund@example.com',
    );
    const buyerId = await createUser(
      t,
      'Partial Buyer',
      'partial-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_admin_partial_refund',
        stripeChargeId: 'ch_admin_partial_refund',
        note: 'initial_payment',
      });

      const tickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );
      expect(tickets).toHaveLength(2);
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in (used) ticket to test partial refund logic; no production path transitions a ticket from 'valid' to 'used' without the check-in scanner flow
        await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
      });

      await asAdmin.action(api.payments.refunds.refund, {
        orderId: order.orderId,
      });

      const [refreshedTickets, inventory, financialEvents] = await Promise.all([
        t.run(async (ctx) =>
          ctx.db
            .query('tickets')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
        t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
        t.run(async (ctx) =>
          ctx.db
            .query('order_financial_events')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
      ]);

      expect(
        refreshedTickets.filter((ticket) => ticket.status === 'refunded'),
      ).toHaveLength(1);
      expect(
        refreshedTickets.filter((ticket) => ticket.status === 'used'),
      ).toHaveLength(1);
      expect(inventory?.soldCount).toBe(1);
      expect(
        financialEvents.filter((event) => event.kind === 'payment_refunded'),
      ).toEqual([
        expect.objectContaining({
          amountCents: 2500,
          stripeRefundId: expect.stringMatching(/^re_mock_/),
        }),
      ]);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('admin full refunds mark the order refunded and consume the remaining canonical balance', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-force-refund@example.com',
    );
    const buyerId = await createUser(
      t,
      'Force Buyer',
      'force-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_admin_force_refund',
        stripeChargeId: 'ch_admin_force_refund',
        note: 'initial_payment',
      });

      const tickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in (used) ticket to test full force-refund path; no production path transitions a ticket from 'valid' to 'used' without the check-in scanner flow
        await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
      });

      await asAdmin.action(api.payments.refunds.refund, {
        orderId: order.orderId,
      });
      await asAdmin.action(api.payments.refunds.forceRefundAll, {
        orderId: order.orderId,
      });

      const [refreshedTickets, inventory, financialEvents] = await Promise.all([
        t.run(async (ctx) =>
          ctx.db
            .query('tickets')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
        t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
        t.run(async (ctx) =>
          ctx.db
            .query('order_financial_events')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
      ]);

      expect(
        refreshedTickets.filter((ticket) => ticket.status === 'refunded'),
      ).toHaveLength(2);
      expect(inventory?.soldCount).toBe(0);
      expect(
        financialEvents
          .filter((event) => event.kind === 'payment_refunded')
          .map((event) => event.amountCents),
      ).toEqual([2500, 2500]);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('admin single-ticket refunds append canonical refund events for the exact ticket', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-ticket-refund@example.com',
    );
    const buyerId = await createUser(
      t,
      'Ticket Buyer',
      'ticket-buyer@example.com',
    );
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_admin_ticket_refund',
        stripeChargeId: 'ch_admin_ticket_refund',
        note: 'initial_payment',
      });

      const tickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );
      expect(tickets).toHaveLength(2);

      await asAdmin.action(api.payments.refunds.refundTicket, {
        ticketId: tickets[0]!._id,
      });

      const [refreshedTickets, inventory, financialEvents] = await Promise.all([
        t.run(async (ctx) =>
          ctx.db
            .query('tickets')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
        t.run(async (ctx) => ctx.db.get('event_inventory', inventoryId)),
        t.run(async (ctx) =>
          ctx.db
            .query('order_financial_events')
            .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
            .collect(),
        ),
      ]);

      expect(
        refreshedTickets.find((ticket) => ticket._id === tickets[0]!._id)
          ?.status,
      ).toBe('refunded');
      expect(
        refreshedTickets.find((ticket) => ticket._id === tickets[1]!._id)
          ?.status,
      ).toBe('valid');
      expect(inventory?.soldCount).toBe(1);
      expect(
        financialEvents.filter((event) => event.kind === 'payment_refunded'),
      ).toEqual([
        expect.objectContaining({
          amountCents: 2500,
          stripeRefundId: expect.stringMatching(/^re_mock_/),
        }),
      ]);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('single-ticket refunds use cumulative odd-cent deltas for Stripe and ledger amounts', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-odd-cent-refund@example.com',
    );
    const buyerId = await createUser(
      t,
      'Odd Cent Buyer',
      'odd-cent-buyer@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      price: 3333,
      totalTickets: 5,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 3,
        tier: 'regular',
        totalAmount: 9999,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_odd_cent_refund',
        stripeChargeId: 'ch_odd_cent_refund',
        note: 'initial_payment',
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a legacy odd-cent order total that cannot be represented by the current per-tier pricing form
        await ctx.db.patch('ticket_orders', order.orderId, {
          amountCents: 10_001,
        });
        const capture = await ctx.db
          .query('order_financial_events')
          .withIndex('by_order_and_kind', (q) =>
            q.eq('orderId', order.orderId).eq('kind', 'payment_captured'),
          )
          .first();
        if (!capture) throw new Error('Expected capture event');
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- keeps the synthetic legacy ledger consistent with the patched order total
        await ctx.db.patch('order_financial_events', capture._id, {
          amountCents: 10_001,
        });
      });

      const tickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );
      tickets.sort((a, b) => a._creationTime - b._creationTime);

      const firstRefund = await asAdmin.action(
        api.payments.refunds.refundTicket,
        {ticketId: tickets[0]!._id},
      );
      const secondRefund = await asAdmin.action(
        api.payments.refunds.refundTicket,
        {ticketId: tickets[1]!._id},
      );
      const thirdRefund = await asAdmin.action(
        api.payments.refunds.refundTicket,
        {ticketId: tickets[2]!._id},
      );

      const refundEvents = await t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order_and_kind', (q) =>
            q.eq('orderId', order.orderId).eq('kind', 'payment_refunded'),
          )
          .collect(),
      );
      refundEvents.sort((a, b) => a._creationTime - b._creationTime);

      expect([
        firstRefund.refundedAmount,
        secondRefund.refundedAmount,
        thirdRefund.refundedAmount,
      ]).toEqual([3334, 3333, 3334]);
      expect(refundEvents.map((event) => event.amountCents)).toEqual([
        3334, 3333, 3334,
      ]);
      expect(
        refundEvents.reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
      ).toBe(10_001);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('normal single-ticket refunds reject used tickets without invalidating them', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-used-ticket-refund@example.com',
    );
    const buyerId = await createUser(
      t,
      'Used Ticket Buyer',
      'used-ticket-buyer@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 5,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_used_ticket_refund',
        stripeChargeId: 'ch_used_ticket_refund',
        note: 'initial_payment',
      });

      const [ticket] = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates scanner check-in before an admin attempts the normal single-ticket refund path
        await ctx.db.patch('tickets', ticket!._id, {status: 'used'});
      });

      await expect(
        asAdmin.action(api.payments.refunds.refundTicket, {
          ticketId: ticket!._id,
        }),
      ).rejects.toThrow('Used tickets require force refund');

      const [refreshedTicket, refundEvents] = await Promise.all([
        t.run(async (ctx) => ctx.db.get(ticket!._id)),
        t.run(async (ctx) =>
          ctx.db
            .query('order_financial_events')
            .withIndex('by_order_and_kind', (q) =>
              q.eq('orderId', order.orderId).eq('kind', 'payment_refunded'),
            )
            .collect(),
        ),
      ]);
      expect(refreshedTicket?.status).toBe('used');
      expect(refundEvents).toHaveLength(0);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('single-ticket refund query rejects tickets for impossible order quantity', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Invalid Quantity Buyer',
      'invalid-quantity@example.com',
    );
    const {eventId} = await createEventWithInventory(t);
    const asUser = t.withIdentity({subject: userId});

    const order = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 2,
      tier: 'regular',
      totalAmount: 5000,
    });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_invalid_qty',
      stripeChargeId: 'ch_invalid_qty',
      note: 'initial_payment',
    });

    const tickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
        .collect(),
    );

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates corrupt legacy order quantity to verify refund code fails closed
      await ctx.db.patch('ticket_orders', order.orderId, {
        quantity: 0,
      });
    });

    const refundInfo = await t.run(async (ctx) =>
      ctx.runQuery(internal.payments.refunds.calculateSingleTicketRefund, {
        ticketId: tickets[0]!._id,
      }),
    );

    expect(refundInfo.canRefund).toBe(false);
    expect(refundInfo.refundAmount).toBe(0);
    expect(refundInfo.reason).toBe('Order has no refundable tickets');
  });

  it('admin refunds fail closed when processor identifiers are missing', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-processor-missing@example.com',
    );
    const buyerId = await createUser(
      t,
      'Processor Missing Buyer',
      'missing-processor@example.com',
    );
    const {eventId} = await createEventWithInventory(t);
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 2,
        tier: 'regular',
        totalAmount: 5000,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_missing_processor',
        stripeChargeId: 'ch_missing_processor',
        note: 'initial_payment',
      });

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates corrupt paid order missing processor identifiers
        await ctx.db.patch('ticket_orders', order.orderId, {
          stripePaymentIntentId: undefined,
        });
      });

      await expect(
        asAdmin.action(api.payments.refunds.refund, {orderId: order.orderId}),
      ).rejects.toThrow('order cannot be refunded');
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('reuses the original processor fee when refunding multiple tickets over time', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-fee-regression@example.com',
    );
    const buyerId = await createUser(t, 'Fee Buyer', 'fee-buyer@example.com');
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 8,
    });
    const asBuyer = t.withIdentity({subject: buyerId});
    const asAdmin = t.withIdentity({subject: adminId});

    try {
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId,
        quantity: 4,
        tier: 'regular',
        totalAmount: 10000,
      });
      await t.action(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order.orderId,
        stripePaymentIntentId: 'pi_fee_regression',
        stripeChargeId: 'ch_fee_regression',
        note: 'initial_payment',
      });

      const tickets = await t.run(async (ctx) =>
        ctx.db
          .query('tickets')
          .withIndex('by_order', (q) => q.eq('orderId', order.orderId))
          .collect(),
      );

      const firstRefund = await asAdmin.action(
        api.payments.refunds.refundTicket,
        {
          ticketId: tickets[0]!._id,
        },
      );
      const secondRefund = await asAdmin.action(
        api.payments.refunds.refundTicket,
        {
          ticketId: tickets[1]!._id,
        },
      );

      expect(firstRefund.lostProcessingFee).toBe(80);
      expect(secondRefund.lostProcessingFee).toBe(80);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('listMyOrders returns the newest 100 orders instead of the first 100 in index order', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Collector', 'collector@example.com');
    const {eventId} = await createEventWithInventory(t);

    // bulk-inserts 100 completed + 1 released orders to test pagination boundary;
    // 'released' state is not reachable via seedPayment, and running 101 mutations is impractically slow for this invariant test
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation */
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i += 1) {
        await ctx.db.insert('ticket_orders', {
          userId,
          eventId,
          kind: 'primary',
          quantity: 1,
          tier: 'regular',
          amountCents: 2500,
          currency: 'USD',
          state: 'completed',
          expiresAt: Date.now() + 60_000,
          completedAt: Date.now() + i,
          trustSource: 'open_access',
        });
      }

      await ctx.db.insert('ticket_orders', {
        userId,
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 2500,
        currency: 'USD',
        state: 'released',
        expiresAt: Date.now() + 60_000,
        releasedAt: Date.now() + 1_000,
        releaseReason: 'cancelled',
        trustSource: 'open_access',
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asUser = t.withIdentity({subject: userId});
    const orders = await asUser.query(api.orders.core.listMyOrders, {});

    expect(orders).toHaveLength(100);
    expect(orders[0]?.state).toBe('released');
    expect(
      orders.some(
        (order: (typeof orders)[number]) => order.state === 'released',
      ),
    ).toBe(true);
  });

  it('recordFinancialEvent dedupes dispute ledger rows for the same dispute', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Dispute User', 'dispute@example.com');
    const {eventId} = await createEventWithInventory(t);

    // creates a completed order without a payment_captured ledger row so the dedup test
    // can assert toHaveLength(1); seedPayment would add that row and break the count assertion
    const orderId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: completed order with no financial events, to test dedup in isolation
      return ctx.db.insert('ticket_orders', {
        userId,
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 2500,
        currency: 'USD',
        state: 'completed',
        expiresAt: Date.now() + 60_000,
        completedAt: Date.now(),
        trustSource: 'open_access',
      });
    });

    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId,
      eventId,
      kind: 'dispute_opened',
      amountCents: 2500,
      stripeDisputeId: 'dp_dup_1',
    });
    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId,
      eventId,
      kind: 'dispute_opened',
      amountCents: 2500,
      stripeDisputeId: 'dp_dup_1',
    });

    const [duplicateEvent, events] = await Promise.all([
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order_and_kind_and_stripeDisputeId', (q) =>
            q
              .eq('orderId', orderId)
              .eq('kind', 'dispute_opened')
              .eq('stripeDisputeId', 'dp_dup_1'),
          )
          .unique(),
      ),
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', orderId))
          .collect(),
      ),
    ]);

    expect(events).toHaveLength(1);
    expect(duplicateEvent?.stripeDisputeId).toBe('dp_dup_1');
  });

  it('recordFinancialEvent dedupes dispute resolution rows for the same dispute', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Resolved Dispute User',
      'resolved-dispute@example.com',
    );
    const {eventId} = await createEventWithInventory(t);

    // creates a completed order without a payment_captured ledger row so the dedup test
    // can assert toHaveLength(1); seedPayment would add that row and break the count assertion
    const orderId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: completed order with no financial events, to test dedup in isolation
      return ctx.db.insert('ticket_orders', {
        userId,
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 2500,
        currency: 'USD',
        state: 'completed',
        expiresAt: Date.now() + 60_000,
        completedAt: Date.now(),
        trustSource: 'open_access',
      });
    });

    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId,
      eventId,
      kind: 'dispute_closed',
      amountCents: 2500,
      stripeDisputeId: 'dp_dup_closed_1',
    });
    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId,
      eventId,
      kind: 'dispute_closed',
      amountCents: 2500,
      stripeDisputeId: 'dp_dup_closed_1',
    });

    const [duplicateEvent, events] = await Promise.all([
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order_and_kind_and_stripeDisputeId', (q) =>
            q
              .eq('orderId', orderId)
              .eq('kind', 'dispute_closed')
              .eq('stripeDisputeId', 'dp_dup_closed_1'),
          )
          .unique(),
      ),
      t.run(async (ctx) =>
        ctx.db
          .query('order_financial_events')
          .withIndex('by_order', (q) => q.eq('orderId', orderId))
          .collect(),
      ),
    ]);

    expect(events).toHaveLength(1);
    expect(duplicateEvent?.stripeDisputeId).toBe('dp_dup_closed_1');
  });

  it('snapshots the organizer stripeConnectedAccountId onto ticket_orders.connectedAccountId for direct-charge events', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Connect Buyer',
      'connect-buyer@example.com',
    );
    // Non-platform organizer with a connected Stripe account — the
    // direct-charge branch that every real promoter event will hit.
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Connected Org',
        isPlatformOrganizer: false,
        stripeConnectedAccountId: 'acct_ORDER_SNAPSHOT',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Connected Event',
      price: 2500,
      totalTickets: 10,
      maxTicketsPerUser: 4,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    const order = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    expect(order?.connectedAccountId).toBe('acct_ORDER_SNAPSHOT');
  });

  it('omits connectedAccountId on ticket_orders for platform-owned events even when the organizer carries one', async () => {
    const t = convexTest();
    const userId = await createUser(
      t,
      'Platform Buyer',
      'platform-buyer@example.com',
    );
    // Platform-owned organizer: the direct-charge snapshot must be
    // skipped even if the org row carries a connected account id — the
    // charge path for platform events runs on the platform account.
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Platform Org',
        isPlatformOrganizer: true,
        stripeConnectedAccountId: 'acct_PLATFORM_IGNORED',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Platform Event',
      price: 2500,
      totalTickets: 10,
      maxTicketsPerUser: 4,
      date: '2030-12-15',
      visibility: 'public',
      organizerId,
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: 2500,
    });

    const order = await t.run(async (ctx) =>
      ctx.db.get('ticket_orders', result.orderId),
    );
    expect(order?.connectedAccountId).toBeUndefined();
  });
});
