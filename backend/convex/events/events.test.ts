import type {EventStatus} from '@shared/domain/event-status';
import type {EventVisibility} from '@shared/domain/event-visibility';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, it, expect, vi, assert} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, authz} from '../lib/authz';

async function createEventWithInventory(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    title: string;
    price: number;
    totalTickets: number;
    date: string;
    status: EventStatus;
    visibility: EventVisibility;
    resaleEnabled: boolean;
  }> = {},
): Promise<{
  eventId: Id<'events'>;
  organizerId: Id<'organizers'>;
  inventoryId: Id<'event_inventory'>;
}> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: overrides.title ?? 'Test Event',
    price: overrides.price ?? 1000,
    totalTickets: overrides.totalTickets ?? 10,
    date: overrides.date ?? '2027-06-01T00:00:00.000Z',
    status: overrides.status ?? 'published',
    visibility: overrides.visibility ?? 'public',
    resaleEnabled: overrides.resaleEnabled,
    organizerId,
  });
  const inventoryId = await t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId);
    return event!.inventoryId!;
  });
  return {eventId, organizerId, inventoryId};
}

function isoDateDaysFrom(baseDate: string, daysFromBase: number): string {
  const date = new Date(`${baseDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + daysFromBase);
  return date.toISOString().slice(0, 10);
}

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name: string,
  email?: string,
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email:
      email ?? `${name.toLowerCase().replace(/\s+/g, '-')}@test-events.com`,
    isRootAdmin: true,
  });
}

async function assignCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, userId, 'community_admin', {
      type: 'organizer',
      id: organizerId,
    });
    await addMember(ctx, userId, organizerId);
  });
}

async function assignCommunityMember(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await addMember(ctx, userId, organizerId);
  });
}

describe('Event management data', () => {
  it('normalizes legacy visibility in management payloads', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Management Org',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Management Event',
      price: 2000,
      totalTickets: 50,
      date: '2026-09-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const management = await t.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );

    expect(management.event.visibility).toBe('public');
    expect(management.event).not.toHaveProperty('isPublic');
  });

  it('surfaces canonical heldCount so remainingCount shrinks and isSoldOut flips at capacity', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Mgmt Admin');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      title: 'Mgmt Held Event',
      totalTickets: 5,
      date: '2026-11-01T00:00:00.000Z',
    });

    const initial = await t.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );
    expect(initial.heldCount).toBe(0);
    expect(initial.remainingCount).toBe(5);
    expect(initial.isSoldOut).toBe(false);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulating held reservations to exercise management remainingCount/isSoldOut boundary; no production mutation sets heldCount directly
      await ctx.db.patch('event_inventory', inventoryId, {heldCount: 2});
    });

    const partial = await t.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );
    expect(partial.heldCount).toBe(2);
    expect(partial.remainingCount).toBe(3);
    expect(partial.isSoldOut).toBe(false);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- saturating inventory via sold+held to verify management isSoldOut threshold flip
      await ctx.db.patch('event_inventory', inventoryId, {
        soldCount: 3,
        heldCount: 2,
      });
    });

    const full = await t.query(
      internal.events.management.getManagementSummaryInternal,
      {
        eventId,
        requestUserId: adminId,
      },
    );
    expect(full.soldCount).toBe(3);
    expect(full.heldCount).toBe(2);
    expect(full.remainingCount).toBe(0);
    expect(full.isSoldOut).toBe(true);
  });

  it('updates a draft event to published', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Publish Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Publish Org',
      },
    );
    const asAdmin = t.withIdentity({subject: adminId});

    const eventId = await asAdmin.mutation(api.events.management.create, {
      title: 'Draft to Publish Event',
      date: '2026-11-20T20:00:00.000Z',
      price: 1500,
      totalTickets: 20,
      status: 'draft',
      visibility: 'public',
      organizerId,
      supporterDefaultPrice: 2500,
      sliderConfig: {
        enabled: true,
        min: 0,
        max: 5000,
      },
    });

    await asAdmin.mutation(api.events.management.update, {
      id: eventId,
      status: 'published',
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe('published');
    expect(event?.organizerId).toBe(organizerId);
    expect(event?.visibility).toBe('public');
    expect(event?.supporterDefaultPrice).toBe(2500);
    expect(event?.slidingScaleEnabled).toBe(true);
  });
});

describe('Events Availability', () => {
  it('getAvailability uses canonical held inventory in remaining count', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin User');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      title: 'Limited Event',
      totalTickets: 5,
      date: '2026-02-01',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const initialAvailability = await asAdmin.query(
      api.events.public.getAvailability,
      {
        eventId,
        now: Date.now(),
      },
    );
    expect(initialAvailability?.remainingTickets).toBe(5);
    expect(initialAvailability?.isSoldOut).toBe(false);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulating held reservations to test remainingTickets boundary; no production mutation sets heldCount directly
      await ctx.db.patch('event_inventory', inventoryId, {heldCount: 2});
    });

    const afterReservation = await asAdmin.query(
      api.events.public.getAvailability,
      {
        eventId,
        now: Date.now(),
      },
    );

    expect(afterReservation?.remainingTickets).toBe(3);
    expect(afterReservation?.isSoldOut).toBe(false);
  });

  it('getAvailability shows sold out when held inventory fills remaining capacity', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      title: 'Tiny Event',
      price: 500,
      totalTickets: 2,
      date: '2026-02-01',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulating full reservation to test sold-out boundary; no production mutation sets heldCount directly
      await ctx.db.patch('event_inventory', inventoryId, {heldCount: 2});
    });

    const availability = await asAdmin.query(
      api.events.public.getAvailability,
      {
        eventId,
        now: Date.now(),
      },
    );

    expect(availability?.remainingTickets).toBe(0);
    expect(availability?.isSoldOut).toBe(true);
  });

  it('getBatchAvailability uses canonical inventory for non-admin responses', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user@test-events.com',
    });
    const event1 = await createEventWithInventory(t, {
      title: 'Fast Path Event - Available',
      totalTickets: 10,
      date: '2026-06-01',
    });
    const event2 = await createEventWithInventory(t, {
      title: 'Fast Path Event - Sold Out',
      totalTickets: 5,
      date: '2026-06-01',
    });
    const event3 = await createEventWithInventory(t, {
      title: 'Fast Path Event - Partial',
      totalTickets: 20,
      date: '2026-06-01',
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- setting inventory soldCount/heldCount to specific values to test availability math boundary conditions
      await ctx.db.patch('event_inventory', event1.inventoryId, {soldCount: 3});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.patch('event_inventory', event2.inventoryId, {soldCount: 5});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.patch('event_inventory', event3.inventoryId, {
        soldCount: 5,
        heldCount: 2,
      });
    });

    const asUser = t.withIdentity({subject: userId});
    const batch = await asUser.query(api.events.public.getBatchAvailability, {
      now: Date.now(),
      eventIds: [event1.eventId, event2.eventId, event3.eventId],
    });

    const result1 = batch[event1.eventId];
    const result2 = batch[event2.eventId];
    const result3 = batch[event3.eventId];

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();
    expect(result1?.isSoldOut).toBe(false);
    expect(result2?.isSoldOut).toBe(true);
    expect(result3?.isSoldOut).toBe(false);
    expect('remainingTickets' in (result1 ?? {})).toBe(false);
  });

  it('getAvailability exposes canonical open-access purchase policy for rejected public events', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rejected Public Buyer',
      email: 'rejected-public-buyer@test-events.com',
    });
    const {eventId, organizerId} = await createEventWithInventory(t, {
      title: 'Open Access Event',
      visibility: 'public',
      date: '2026-06-01',
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'rejected',
    });

    const asUser = t.withIdentity({subject: userId});
    const availability = await asUser.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(availability?.purchaseAccess).toEqual({
      allowed: true,
      source: 'open_access',
    });
  });

  it('getBatchAvailability exposes canonical purchase policy for root admins without approvals', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Root Access Buyer');
    const {eventId} = await createEventWithInventory(t, {
      title: 'Private Root Event',
      visibility: 'private',
      date: '2026-06-01',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const batch = await asAdmin.query(api.events.public.getBatchAvailability, {
      now: Date.now(),
      eventIds: [eventId],
    });

    expect(batch[eventId]?.purchaseAccess).toEqual({
      allowed: true,
      source: 'direct',
    });
  });

  it('getBatchAvailability returns null for events the caller cannot view', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-hidden-events@test-events.com',
    });
    const visibleEvent = await createEventWithInventory(t, {
      title: 'Visible Event',
      totalTickets: 10,
      date: '2026-06-01',
    });
    const privateDraftEvent = await createEventWithInventory(t, {
      title: 'Private Draft Event',
      totalTickets: 10,
      date: '2026-06-01',
      status: 'draft',
      visibility: 'private',
    });
    const privateCancelledEvent = await createEventWithInventory(t, {
      title: 'Private Cancelled Event',
      totalTickets: 10,
      date: '2026-06-01',
      status: 'cancelled',
      visibility: 'private',
    });

    const asUser = t.withIdentity({subject: userId});
    const batch = await asUser.query(api.events.public.getBatchAvailability, {
      now: Date.now(),
      eventIds: [
        visibleEvent.eventId,
        privateDraftEvent.eventId,
        privateCancelledEvent.eventId,
      ],
    });

    expect(batch[visibleEvent.eventId]).not.toBeNull();
    expect(batch[privateDraftEvent.eventId]).toBeNull();
    expect(batch[privateCancelledEvent.eventId]).toBeNull();
  });

  it('getBatchAvailability includes canonical held inventory for admins', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const event1 = await createEventWithInventory(t, {
      title: 'Event 1',
      totalTickets: 10,
      date: '2026-02-01',
    });
    const event2 = await createEventWithInventory(t, {
      title: 'Event 2',
      totalTickets: 5,
      date: '2026-02-01',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- setting heldCount to test admin remainingTickets boundary; no production mutation sets heldCount directly
      await ctx.db.patch('event_inventory', event1.inventoryId, {heldCount: 3});
    });

    const batch = await asAdmin.query(api.events.public.getBatchAvailability, {
      now: Date.now(),
      eventIds: [event1.eventId, event2.eventId],
    });

    const result1 = batch[event1.eventId];
    const result2 = batch[event2.eventId];

    if (!result1 || !('remainingTickets' in result1)) {
      throw new Error('Expected admin response with remainingTickets');
    }
    if (!result2 || !('remainingTickets' in result2)) {
      throw new Error('Expected admin response with remainingTickets');
    }

    expect(result1.remainingTickets).toBe(7);
    expect(result2.remainingTickets).toBe(5);
  });

  it('getBatchAvailability counts only requested events for users with many tickets', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Power User',
      email: 'power-user@test-events.com',
    });
    const requestedEvent1 = await createEventWithInventory(t, {
      title: 'Requested Event 1',
      totalTickets: 10,
      date: '2026-06-01',
    });
    const requestedEvent2 = await createEventWithInventory(t, {
      title: 'Requested Event 2',
      totalTickets: 10,
      date: '2026-06-01',
    });
    const unrelatedEvent = await createEventWithInventory(t, {
      title: 'Unrelated Event',
      totalTickets: 2_000,
      date: '2026-06-01',
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 1_005; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert 1005 tickets to exceed the per-user query page size; using seedTicket would update inventory on every call making this test impractically slow
        await ctx.db.insert('tickets', {
          userId,
          eventId: unrelatedEvent.eventId,
          status: 'valid',
          tier: 'regular',
        });
      }
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seeding user's specific ticket state for userTicketCount boundary test; tickets are deliberately partial (valid+used on event1, valid+refunded on event2)
      await ctx.db.insert('tickets', {
        userId,
        eventId: requestedEvent1.eventId,
        status: 'valid',
        tier: 'regular',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        userId,
        eventId: requestedEvent1.eventId,
        status: 'used',
        tier: 'regular',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        userId,
        eventId: requestedEvent2.eventId,
        status: 'valid',
        tier: 'regular',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        userId,
        eventId: requestedEvent2.eventId,
        status: 'refunded',
        tier: 'regular',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- set soldCount to match the tickets manually inserted above (bypassing seedTicket which would auto-increment)
      await ctx.db.patch('event_inventory', requestedEvent1.inventoryId, {
        soldCount: 2,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.patch('event_inventory', requestedEvent2.inventoryId, {
        soldCount: 1,
      });
    });

    const asUser = t.withIdentity({subject: userId});
    const batch = await asUser.query(api.events.public.getBatchAvailability, {
      now: Date.now(),
      eventIds: [requestedEvent1.eventId, requestedEvent2.eventId],
    });

    expect(batch[requestedEvent1.eventId]?.userTicketCount).toBe(2);
    expect(batch[requestedEvent2.eventId]?.userTicketCount).toBe(1);
    expect(batch[requestedEvent1.eventId]?.isSoldOut).toBe(false);
    expect(batch[requestedEvent2.eventId]?.isSoldOut).toBe(false);
    expect('remainingTickets' in (batch[requestedEvent1.eventId] ?? {})).toBe(
      false,
    );
  });

  it('fails closed when an event is missing its canonical inventory link', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    // Intentional invalid state: event without inventoryId to test fail-closed behavior.
    const eventId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- creating an event without inventory is an intentionally invalid state to verify the fail-closed guard; seedEvent always creates inventory
      const organizerId = await ctx.db.insert('organizers', {
        name: 'Test Org',
        slug: 'test-org-missing-inventory',
        isPublicDirectory: true,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      return ctx.db.insert('events', {
        title: 'Test Event',
        price: 1000,
        totalTickets: 5,
        date: '2026-02-01',
        status: 'published',
        visibility: 'public',
        organizerId,
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expect(
      asAdmin.query(api.events.public.getAvailability, {
        eventId,
        now: Date.now(),
      }),
    ).rejects.toThrow('missing inventoryId');
  });
});

describe('getAvailability resale notification subscription', () => {
  it('returns isSubscribedToResaleNotifications false when not subscribed', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'user@test.com',
    });

    const {eventId} = await createEventWithInventory(t, {resaleEnabled: true});

    const asUser = t.withIdentity({subject: userId});
    const availability = await asUser.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(availability?.isSubscribedToResaleNotifications).toBe(false);
  });

  it('returns isSubscribedToResaleNotifications true after subscribing', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'user@test.com',
    });

    const {eventId} = await createEventWithInventory(t, {resaleEnabled: true});

    const asUser = t.withIdentity({subject: userId});

    // Subscribe to notifications
    await asUser.mutation(api.resale.listings.subscribeToResaleNotifications, {
      eventId,
    });

    const availability = await asUser.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(availability?.isSubscribedToResaleNotifications).toBe(true);
  });

  it('returns isSubscribedToResaleNotifications false after unsubscribing', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'user@test.com',
    });

    const {eventId} = await createEventWithInventory(t, {resaleEnabled: true});

    const asUser = t.withIdentity({subject: userId});

    // Subscribe then unsubscribe
    await asUser.mutation(api.resale.listings.subscribeToResaleNotifications, {
      eventId,
    });
    await asUser.mutation(
      api.resale.listings.unsubscribeFromResaleNotifications,
      {
        eventId,
      },
    );

    const availability = await asUser.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(availability?.isSubscribedToResaleNotifications).toBe(false);
  });
});

describe('Events Admin List', () => {
  it('rejects unauthenticated users', async () => {
    const t = convexTest();

    await expect(t.query(api.events.management.adminList, {})).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-admin-list@test-events.com',
    });

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.query(api.events.management.adminList, {}),
    ).rejects.toThrow('Unauthorized');
  });

  it('includes canonical soldCount for admin-visible events', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const {eventId, inventoryId} = await createEventWithInventory(t, {
      title: 'Night Market',
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- syncing canonical inventory for admin list regression coverage; no production mutation sets this test fixture directly
      await ctx.db.patch('event_inventory', inventoryId, {soldCount: 3});
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const events = await asAdmin.query(api.events.management.adminList, {});
    const event = events.find((entry) => entry._id === eventId);

    expect(event).toMatchObject({
      _id: eventId,
      soldCount: 3,
      isSoldOut: false,
    });
  });

  it('includes delete-block metadata for completed orders and ticket history', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const {eventId} = await createEventWithInventory(t, {
      title: 'Protected Event',
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seeding a completed order deletion blocker for admin list regression coverage; no production mutation exposes this exact historical fixture state
      const userId = await ctx.db.insert('users', {
        name: 'Protected Event Buyer',
        email: 'protected-event-buyer@example.com',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('ticket_orders', {
        userId,
        eventId,
        kind: 'primary',
        quantity: 1,
        tier: 'regular',
        amountCents: 1000,
        currency: 'USD',
        state: 'completed',
        expiresAt: Date.now() + 60_000,
        completedAt: Date.now(),
        trustSource: 'open_access',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId,
        userId,
        status: 'refunded',
        tier: 'regular',
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const events = await asAdmin.query(api.events.management.adminList, {});
    const event = events.find((entry) => entry._id === eventId);

    expect(event).toMatchObject({
      _id: eventId,
      hasAnyTickets: true,
      hasCompletedOrders: true,
    });
  });

  it('scopes platform admin results to the requested organizer', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const lot45Id = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Lot 45',
    });
    const midnightId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Midnight Sound',
    });

    const lot45EventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Lot 45 Show',
      price: 1000,
      totalTickets: 10,
      date: '2027-06-01T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: lot45Id,
    });
    const midnightEventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Midnight Sound Show',
      price: 1000,
      totalTickets: 10,
      date: '2027-06-02T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: midnightId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const events = await asAdmin.query(api.events.management.adminList, {
      organizerId: lot45Id,
    });
    const eventIds = events.map((event) => event._id);

    expect(eventIds).toContain(lot45EventId);
    expect(eventIds).not.toContain(midnightEventId);
    expect(events.every((event) => event.organizerId === lot45Id)).toBe(true);
  });

  it('rejects organizer-scoped admin list requests without access to that organizer', async () => {
    const t = convexTest();
    const adminUserId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'scoped-community-admin@test-events.com',
    });
    const ownOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Own Community',
      },
    );
    const otherOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other Community',
      },
    );
    await assignCommunityAdmin(t, adminUserId, ownOrganizerId);

    const asCommunityAdmin = t.withIdentity({subject: adminUserId});

    await expect(
      asCommunityAdmin.query(api.events.management.adminList, {
        organizerId: otherOrganizerId,
      }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('Event date validation', () => {
  it('create accepts a valid ISO 8601 UTC date string', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Valid Date Event',
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 50,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).resolves.toBeDefined();
  });

  it('create rejects a human-readable date string', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Bad Date Event',
        date: 'Dec 15, 2030',
        price: 1000,
        totalTickets: 50,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow();
  });

  it('create rejects a non-date string', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Bad Date Event',
        date: 'not-a-date',
        price: 1000,
        totalTickets: 50,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow();
  });

  it('update rejects an invalid date format', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Existing Event',
      date: '2030-12-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });
    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.management.update, {
        id: eventId,
        date: 'Dec 15, 2030',
      }),
    ).rejects.toThrow();
  });

  it('update accepts a valid ISO date string', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Existing Event',
      date: '2030-12-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });
    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.management.update, {
        id: eventId,
        date: '2031-06-01T18:00:00.000Z',
      }),
    ).resolves.toBeNull();
  });
});

describe('Event write validation', () => {
  async function setupEventWriteValidation() {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
      },
    );
    return {t, organizerId, asAdmin: t.withIdentity({subject: adminId})};
  }

  it('create rejects title exceeding max length', async () => {
    const {asAdmin, organizerId} = await setupEventWriteValidation();

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'a'.repeat(10_000),
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 100,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow('Title exceeds maximum length');
  });

  it('create rejects description exceeding max length', async () => {
    const {asAdmin, organizerId} = await setupEventWriteValidation();

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Long Description Event',
        description: 'x'.repeat(100_000),
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 100,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow('Description exceeds maximum length');
  });

  it('create rejects negative price', async () => {
    const {asAdmin, organizerId} = await setupEventWriteValidation();

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Negative Price Event',
        date: '2030-12-15T20:00:00.000Z',
        price: -1000,
        totalTickets: 100,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow('Price cannot be negative');
  });

  it('create rejects totalTickets = 0', async () => {
    const {asAdmin, organizerId} = await setupEventWriteValidation();

    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Zero Ticket Event',
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 0,
        status: 'draft',
        visibility: 'private',
        organizerId,
      }),
    ).rejects.toThrow('Total tickets cannot be zero');
  });

  it('update rejects maxTicketsPerUser = 0', async () => {
    const {t, asAdmin, organizerId} = await setupEventWriteValidation();
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Existing Event',
      date: '2030-12-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });

    await expect(
      asAdmin.mutation(api.events.management.update, {
        id: eventId,
        maxTicketsPerUser: 0,
      }),
    ).rejects.toThrow('Max tickets per user cannot be zero');
  });
});

describe('events.listByOrganizer', () => {
  it('returns organizerName and published events for a valid organizer', async () => {
    const t = convexTest();

    // RLS requires authentication to read organizers
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-lbo@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Underground Collective',
      },
    );

    // seedEvent creates event+inventory atomically with soldCount. The inventory has soldCount=4
    // and heldCount=1 making it sold-out. We use seedEvent with soldCount=4 then patch heldCount.
    const publishedPartyId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Published Party',
      date: '2030-06-01T20:00:00.000Z',
      price: 1500,
      totalTickets: 5,
      status: 'published',
      visibility: 'public',
      organizerId,
      soldCount: 4,
    });
    await t.run(async (ctx) => {
      const event = await ctx.db.get('events', publishedPartyId);
      if (event?.inventoryId) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- setting heldCount=1 to make event sold-out (soldCount+heldCount >= totalTickets) to test isSoldOut boundary
        await ctx.db.patch('event_inventory', event.inventoryId, {
          heldCount: 1,
        });
      }
    });

    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Underground Collective');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Published Party');
    expect(result.events[0].posterUrl).toBeNull();
    expect(result.events[0].soldCount).toBe(4);
    expect(result.events[0]).toMatchObject({isSoldOut: true});
  });

  it('returns organizerDescription when organizer has a description', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-description@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Described Crew',
        description: 'Oakland nightlife collective',
      },
    );

    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Described Crew');
    expect(result.organizerDescription).toBe('Oakland nightlife collective');
  });

  it('omits organizerDescription when organizer has no description', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-nobio@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'No Bio Crew',
      },
    );

    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('No Bio Crew');
    expect(result.organizerDescription).toBeUndefined();
  });

  it('returns empty events array when organizer has no published events', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-quiet@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Quiet Crew',
      },
    );

    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Quiet Crew');
    expect(result.events).toHaveLength(0);
  });

  it('excludes draft and cancelled events', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-mixed@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Mixed Status Crew',
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Draft Event',
      date: '2030-07-01T20:00:00.000Z',
      price: 500,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Cancelled Event',
      date: '2030-08-01T20:00:00.000Z',
      price: 500,
      totalTickets: 50,
      status: 'cancelled',
      visibility: 'public',
      organizerId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Live Event',
      date: '2030-09-01T20:00:00.000Z',
      price: 500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Mixed Status Crew');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Live Event');
  });

  it('excludes past published events from organizer listing', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T20:00:00.000Z'));
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Past Event Crew',
          isPublicDirectory: true,
        },
      );

      await t.mutation(api.testing.events.seedEvent, {
        title: 'Sold-Out Past Event',
        date: '2026-05-15T20:00:00.000Z',
        price: 1500,
        totalTickets: 5,
        status: 'published',
        visibility: 'public',
        organizerId,
        soldCount: 5,
      });
      await t.mutation(api.testing.events.seedEvent, {
        title: 'Upcoming Event',
        date: '2026-06-15T20:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });

      const result = await t.query(api.events.public.listByOrganizer, {
        organizerId,
      });

      assert(result);
      expect(result.organizerName).toBe('Past Event Crew');
      expect(result.events.map((event) => event.title)).toEqual([
        'Upcoming Event',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludes UTC-same-day events that already passed in Los Angeles', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T20:00:00.000Z'));
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Timezone Boundary Crew',
          isPublicDirectory: true,
        },
      );

      await t.mutation(api.testing.events.seedEvent, {
        title: 'LA Past Event',
        date: '2026-06-01T01:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      await t.mutation(api.testing.events.seedEvent, {
        title: 'LA Upcoming Event',
        date: '2026-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });

      const result = await t.query(api.events.public.listByOrganizer, {
        organizerId,
      });

      assert(result);
      expect(result.organizerName).toBe('Timezone Boundary Crew');
      expect(result.events.map((event) => event.title)).toEqual([
        'LA Upcoming Event',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps scanning past 500 future draft or cancelled rows to find later published events', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Crowded Queue Crew',
        isPublicDirectory: true,
      },
    );

    await t.mutation(api.testing.events.seedEventsBatch, {
      events: Array.from({length: 501}, (_, index) => ({
        title: `Crowding Event ${index + 1}`,
        date: `${isoDateDaysFrom('2032-01-01', index)}T12:00:00.000Z`,
        price: 1000,
        totalTickets: 100,
        status: index % 2 === 0 ? ('draft' as const) : ('cancelled' as const),
        visibility: 'public' as const,
        organizerId,
      })),
    });

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Published After Crowding',
      date: '2035-01-01T12:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Crowded Queue Crew');
    expect(result.events.map((event) => event.title)).toEqual([
      'Published After Crowding',
    ]);
  });

  it('returns null when organizer does not exist', async () => {
    const t = convexTest();

    // Seed a real organizer to obtain a valid ID format, then delete it
    const realId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Real Org',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally deleting the organizer to test the "not found" fallback behavior; no production delete mutation exists
      await ctx.db.delete(realId);
    });

    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId: realId,
    });

    expect(result).toBeNull();
  });

  it('allows unauthenticated access to public organizer events by ID', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Public Community',
        isPublicDirectory: true,
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Event',
      date: '2030-06-01T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // Unauthenticated query
    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Public Community');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Public Event');
  });

  it('hides private organizer events from unauthenticated callers', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Public Community With Private Event',
        isPublicDirectory: true,
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Event',
      date: '2030-06-01T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Members Only Event',
      date: '2030-06-02T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'private',
      organizerId,
    });

    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Public Community With Private Event');
    expect(result.events.map((event) => event.title)).toEqual(['Public Event']);
  });

  it('shows private organizer events to vetted members', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Vetted User',
      email: 'vetted-user-lbo@test-events.com',
    });

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Member Community',
        isPublicDirectory: true,
      },
    );
    await assignCommunityMember(t, userId, organizerId);

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Members Only Event',
      date: '2030-06-02T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'private',
      organizerId,
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Member Community');
    expect(result.events.map((event) => event.title)).toEqual([
      'Members Only Event',
    ]);
  });

  it('allows unauthenticated access to public organizer events by slug', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Public Slug',
        slug: 'public-slug',
        isPublicDirectory: true,
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Slug Event',
      date: '2030-06-01T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // Unauthenticated query by slug
    const result = await t.query(api.events.public.listByOrganizer, {
      slug: 'public-slug',
    });

    assert(result);
    expect(result.organizerName).toBe('Public Slug');
    expect(result.events).toHaveLength(1);
  });

  it('allows unauthenticated access to public events from community with default isPublicDirectory', async () => {
    const t = convexTest();

    // Community with isPublicDirectory defaulting to true
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'No Directory Flag Crew',
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Event No Flag',
      date: '2030-06-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // Unauthenticated query — should see the event via RLS on the event itself
    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('No Directory Flag Crew');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Public Event No Flag');
  });

  it('denies unauthenticated access to events from isPublicDirectory: false community', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Private Community',
        isPublicDirectory: false,
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Event',
      date: '2030-06-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // Unauthenticated query — should NOT see events from private community
    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    expect(result).toBeNull();
  });

  it('allows community admin to access events from isPublicDirectory: false community', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin User',
      email: 'admin-user-private@test-events.com',
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Private Community',
        isPublicDirectory: false,
      },
    );
    await assignCommunityAdmin(t, userId, organizerId);

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Event',
      date: '2030-06-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: userId});
    const result = await asAdmin.query(api.events.public.listByOrganizer, {
      organizerId,
    });

    assert(result);
    expect(result.organizerName).toBe('Private Community');
    expect(result.events).toHaveLength(1);
  });

  it('returns empty results when neither organizerId nor slug is provided', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-empty@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const result = await asUser.query(api.events.public.listByOrganizer, {});

    expect(result).toBeNull();
  });

  it('throws error when both organizerId and slug are provided', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-both@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        slug: 'test-org',
      },
    );

    await expect(
      asUser.query(api.events.public.listByOrganizer, {
        organizerId,
        slug: 'test-org',
      }),
    ).rejects.toThrow('Provide either organizerId or slug, not both');
  });

  it('looks up organizer by slug and returns events', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-slug@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Slug Test Org',
        slug: 'slug-test-org',
      },
    );

    await t.mutation(api.testing.events.seedEvent, {
      title: 'Slug Event',
      date: '2030-06-01T20:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const result = await asUser.query(api.events.public.listByOrganizer, {
      slug: 'slug-test-org',
    });

    assert(result);
    expect(result.organizerName).toBe('Slug Test Org');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Slug Event');
  });

  it('returns null when slug does not exist', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test-user-noexist@test-events.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const result = await asUser.query(api.events.public.listByOrganizer, {
      slug: 'non-existent-slug',
    });

    expect(result).toBeNull();
  });

  it('returns null when organizerId does not resolve and no access (slug and id)', async () => {
    const t = convexTest();

    // Test via unknown slug
    const slugResult = await t.query(api.events.public.listByOrganizer, {
      slug: 'completely-unknown-slug-xyz',
    });
    expect(slugResult).toBeNull();

    // Test via deleted organizerId
    const realId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Temp Org For Delete',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally deleting to test null return for unknown id
      await ctx.db.delete(realId);
    });
    const idResult = await t.query(api.events.public.listByOrganizer, {
      organizerId: realId,
    });
    expect(idResult).toBeNull();
  });

  it('hides draft organizer events from unauthenticated callers', async () => {
    const t = convexTest();

    // Draft organizer with a published event is an intentionally invalid state:
    // seedEvent rejects published events under draft organizers.
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is an intentionally invalid state; seedEvent rejects this combination
      return ctx.db.insert('organizers', {
        name: 'Draft Organizer',
        slug: 'draft-organizer',
        status: 'draft',
        isPublicDirectory: true,
      });
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org is intentionally invalid; tests RLS hide behaviour
      await ctx.db.insert('events', {
        title: 'Draft Organizer Public Event',
        date: '2030-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
    });

    const result = await t.query(api.events.public.listByOrganizer, {
      organizerId,
    });
    expect(result).toBeNull();
  });

  it('hides draft organizer events from authenticated non-admin callers', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-draft-org@test-events.com',
    });
    // Draft organizer with a published event is an intentionally invalid state:
    // seedEvent rejects published events under draft organizers.
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is an intentionally invalid state; seedEvent rejects this combination
      return ctx.db.insert('organizers', {
        name: 'Draft Organizer',
        slug: 'draft-organizer-user',
        status: 'draft',
        isPublicDirectory: true,
      });
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org is intentionally invalid; tests RLS hide behaviour
      await ctx.db.insert('events', {
        title: 'Draft Organizer Public Event',
        date: '2030-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.events.public.listByOrganizer, {
      organizerId,
    });
    expect(result).toBeNull();
  });

  it('allows organizer community admins to access draft organizer events', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'community-admin-draft-org@test-events.com',
    });
    // Draft organizer with a published event is an intentionally invalid state:
    // seedEvent rejects published events under draft organizers.
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is an intentionally invalid state; seedEvent rejects this combination
      return ctx.db.insert('organizers', {
        name: 'Draft Organizer',
        slug: 'draft-organizer-admin',
        status: 'draft',
        isPublicDirectory: true,
      });
    });
    await assignCommunityAdmin(t, userId, organizerId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org is intentionally invalid; tests that community admin can still access it
      const eventId = await ctx.db.insert('events', {
        title: 'Draft Organizer Event',
        date: '2030-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- inventory for intentionally invalid state event
      const inventoryId = await ctx.db.insert('event_inventory', {
        eventId,
        soldCount: 0,
        heldCount: 0,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- linking inventoryId on intentionally invalid state event
      await ctx.db.patch('events', eventId, {inventoryId});
    });

    const asCommunityAdmin = t.withIdentity({subject: userId});
    const result = await asCommunityAdmin.query(
      api.events.public.listByOrganizer,
      {
        organizerId,
      },
    );
    assert(result);
    expect(result.organizerName).toBe('Draft Organizer');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Draft Organizer Event');
  });
});

describe('events.get organizer payment readiness', () => {
  it('returns organizerPaymentReady true when organizer is charge-ready', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Onboarded Org',
        stripeConnectedAccountId: 'acct_123',
        stripeOnboardingStatus: 'restricted',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: false,
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Organizer Event',
      date: '2030-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const event = await asAdmin.query(api.events.public.get, {id: eventId});

    expect(event).not.toBeNull();
    expect(event?.organizerPaymentReady).toBe(true);
    expect(event?.isPlatformOrganizer).toBe(false);
  });

  it('returns organizerPaymentReady false when organizer has no stripe account', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Not Onboarded Org',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Not Ready Event',
      date: '2030-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const event = await asAdmin.query(api.events.public.get, {id: eventId});

    expect(event).not.toBeNull();
    expect(event?.organizerPaymentReady).toBe(false);
    expect(event?.isPlatformOrganizer).toBe(false);
    expect(event?.organizer?._id).toBe(organizerId);
  });

  it('returns organizerPaymentReady true when organizer is platform organizer', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Platform Org',
        isPlatformOrganizer: true,
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Platform Event',
      date: '2030-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const event = await asAdmin.query(api.events.public.get, {id: eventId});

    expect(event).not.toBeNull();
    expect(event?.organizerPaymentReady).toBe(true);
    expect(event?.isPlatformOrganizer).toBe(true);
  });

  it('returns organizerPaymentReady false for events with organizer that has no stripe and is not platform', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Minimal Org',
        slug: 'minimal-org',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Minimal Organizer Event',
      date: '2030-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const event = await asAdmin.query(api.events.public.get, {id: eventId});

    expect(event).not.toBeNull();
    expect(event?.organizerPaymentReady).toBe(false);
    expect(event?.isPlatformOrganizer).toBe(false);
  });

  it('seeds a sandbox fixture event that remains purchasable without relaxing payment gates', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const asAdmin = t.withIdentity({subject: adminId});

    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';

    try {
      const firstSeed = await t.mutation(
        api.testing.orders.seedSandboxPurchaseFixture,
        {
          stripeConnectedAccountId: 'acct_fixture_contract_test',
        },
      );
      expect(firstSeed.organizerCreated).toBe(true);
      expect(firstSeed.eventCreated).toBe(true);

      const secondSeed = await t.mutation(
        api.testing.orders.seedSandboxPurchaseFixture,
        {
          stripeConnectedAccountId: 'acct_fixture_contract_test',
        },
      );
      expect(secondSeed.organizerCreated).toBe(false);
      expect(secondSeed.eventCreated).toBe(false);
      expect(secondSeed.organizerId).toBe(firstSeed.organizerId);
      expect(secondSeed.eventId).toBe(firstSeed.eventId);

      const event = await asAdmin.query(api.events.public.get, {
        id: secondSeed.eventId,
      });

      expect(event).not.toBeNull();
      expect(event?.title).toBe('Guest Checkout Test Event');
      expect(event?.status).toBe('published');
      expect(event?.organizerPaymentReady).toBe(true);
      expect(event?.isPlatformOrganizer).toBe(false);

      const rawEvent = await t.run(async (ctx) =>
        ctx.db.get(secondSeed.eventId),
      );
      expect(rawEvent?.date).toContain('T');
      expect(rawEvent?.inventoryId).toBeDefined();

      const buyerId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Sandbox Buyer',
        email: 'sandbox-buyer@example.com',
      });
      const asBuyer = t.withIdentity({subject: buyerId});
      const order = await asBuyer.mutation(api.orders.core.open, {
        eventId: secondSeed.eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
      });

      expect(order.state).toBe('open');
      const inventory = rawEvent?.inventoryId
        ? await t.run(async (ctx) => ctx.db.get(rawEvent.inventoryId!))
        : null;
      expect(inventory?.heldCount).toBe(1);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });
});

describe('Event listing pagination', () => {
  it('list returns more than 500 published public events without truncation', async () => {
    const t = convexTest();

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 520 events; calling seedEvent per row would be prohibitively slow
      const organizerId = await ctx.db.insert('organizers', {
        name: 'Large Public Catalog',
        slug: 'large-public-catalog',
        isPublicDirectory: true,
      });

      for (let index = 0; index < 520; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 520 events; calling seedEvent per row would be prohibitively slow
        await ctx.db.insert('events', {
          title: `Published Event ${index + 1}`,
          date: isoDateDaysFrom('2030-01-01', index),
          price: 1500,
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
      }
    });

    const results = await t.query(api.events.public.list, {});
    expect(results).toHaveLength(520);
    expect(results[0]?.title).toBe('Published Event 520');
    expect(results.at(-1)?.title).toBe('Published Event 1');
  });

  it('upcoming returns more than 500 future published public events without truncation', async () => {
    const t = convexTest();

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 540 events; calling seedEvent per row would be prohibitively slow
      const organizerId = await ctx.db.insert('organizers', {
        name: 'Large Upcoming Catalog',
        slug: 'large-upcoming-catalog',
        isPublicDirectory: true,
      });

      for (let index = 0; index < 530; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert; see above
        await ctx.db.insert('events', {
          title: `Upcoming Event ${index + 1}`,
          date: isoDateDaysFrom('2031-01-01', index),
          price: 2000,
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
      }

      for (let index = 0; index < 10; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert; see above
        await ctx.db.insert('events', {
          title: `Past Event ${index + 1}`,
          date: isoDateDaysFrom('2020-01-01', index),
          price: 1000,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
      }
    });

    const results = await t.query(api.events.public.upcoming, {});
    expect(results).toHaveLength(530);
    expect(results[0]?.title).toBe('Upcoming Event 1');
    expect(results.at(-1)?.title).toBe('Upcoming Event 530');
    expect(results.every((event) => event.date >= '2031-01-01')).toBe(true);
  });

  it('upcoming excludes UTC-same-day events that already passed in Los Angeles', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T20:00:00.000Z'));
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Upcoming Boundary Crew',
          isPublicDirectory: true,
        },
      );

      await t.mutation(api.testing.events.seedEvent, {
        title: 'Boundary Past Event',
        date: '2026-06-01T01:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      await t.mutation(api.testing.events.seedEvent, {
        title: 'Boundary Upcoming Event',
        date: '2026-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });

      const results = await t.query(api.events.public.upcoming, {});
      expect(results.map((event) => event.title)).toContain(
        'Boundary Upcoming Event',
      );
      expect(results.map((event) => event.title)).not.toContain(
        'Boundary Past Event',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listPublicUpcomingInternal', () => {
  it('returns only publicly visible upcoming published events', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });

    // Public event (sold out via canonical inventory) — needs soldCount override so patch inventory
    const publicEventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Party',
      date: '2030-06-15T00:00:00.000Z',
      price: 2000,
      slidingScaleEnabled: true,
      slidingScaleMin: 0,
      slidingScaleMax: 2000,
      supporterDefaultPrice: 3500,
      totalTickets: 5,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    // Override inventory soldCount to simulate sold-out state
    await t.run(async (ctx) => {
      const event = await ctx.db.get('events', publicEventId as Id<'events'>);
      if (event?.inventoryId) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- overriding inventory soldCount/heldCount to test sold-out derivation; seedEvent does not expose per-inventory counts
        await ctx.db.patch(event.inventoryId, {soldCount: 4, heldCount: 1});
      }
    });

    // Public viewable event (should be returned)
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Viewable Gala',
      date: '2030-06-15T00:00:00.000Z',
      price: 3000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public_viewable',
      organizerId: orgId,
    });

    // Private event (should NOT be returned)
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Rave',
      date: '2030-06-15T00:00:00.000Z',
      price: 1500,
      totalTickets: 200,
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    // Past public event (should NOT be returned) — past dates need raw insert since seedEvent
    // may validate date in future; use eslint-disable for this intentionally past date
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- creating a past event to verify it is excluded; seedEvent does not support past dates
      await ctx.db.insert('events', {
        title: 'Past Event',
        date: '2020-01-01',
        price: 1000,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
    });

    // Draft public event (should NOT be returned)
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Draft Event',
      date: '2030-06-15T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    // Call the query (no auth needed — RLS allows public reads)
    const results = await t.query(
      internal.events.public.listPublicUpcomingInternal,
      {},
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.title)).toContain('Public Party');
    expect(results.map((r) => r.title)).toContain('Viewable Gala');
    expect(results.map((r) => r.title)).not.toContain('Private Rave');
    expect(results.map((r) => r.title)).not.toContain('Past Event');
    expect(results.map((r) => r.title)).not.toContain('Draft Event');
    // Verify canonical sold-out state is derived from event_inventory.
    const publicParty = results.find((r) => r.title === 'Public Party')!;
    expect(publicParty.soldCount).toBe(4);
    expect(publicParty).toMatchObject({isSoldOut: true});
    expect(publicParty).toMatchObject({
      price: 2000,
      slidingScaleEnabled: true,
      slidingScaleMin: 0,
      slidingScaleMax: 2000,
      supporterDefaultPrice: 3500,
    });
    // Verify posterUrl is null (not undefined) for events without posters
    expect(publicParty.posterUrl).toBe(null);
  });

  it('excludes UTC-same-day public cards that already passed in Los Angeles', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T20:00:00.000Z'));
      const t = convexTest();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Landing Boundary Crew',
          isPublicDirectory: true,
        },
      );

      await t.mutation(api.testing.events.seedEvent, {
        title: 'Landing Past Event',
        date: '2026-06-01T01:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      await t.mutation(api.testing.events.seedEvent, {
        title: 'Landing Upcoming Event',
        date: '2026-06-01T20:00:00.000Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });

      const results = await t.query(
        internal.events.public.listPublicUpcomingInternal,
        {},
      );
      expect(results.map((event) => event.title)).toContain(
        'Landing Upcoming Event',
      );
      expect(results.map((event) => event.title)).not.toContain(
        'Landing Past Event',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when a public event is missing its canonical inventory link', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    // Event without inventory is intentionally invalid state — seedEvent always creates inventory
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- creating event without inventory link is intentionally invalid; tests fail-closed guard
      await ctx.db.insert('events', {
        title: 'Broken Public Event',
        date: '2030-06-15',
        price: 2000,
        totalTickets: 5,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
    });

    await expect(
      t.query(internal.events.public.listPublicUpcomingInternal, {}),
    ).rejects.toThrow('missing inventoryId');
  });

  it('excludes published public events from draft communities', async () => {
    const t = convexTest();
    const now = Date.now();
    const futureDate = new Date(now + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // Draft community with a published public event — intentionally invalid state
    const draftOrgId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is intentionally invalid; seedEvent rejects this combination
      return ctx.db.insert('organizers', {
        name: 'Draft Org',
        slug: 'draft-org',
        status: 'draft',
        isPublicDirectory: true,
      });
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org; see above
      const hiddenEventId = await ctx.db.insert('events', {
        title: 'Hidden Event',
        price: 1000,
        totalTickets: 50,
        date: futureDate,
        status: 'published',
        visibility: 'public',
        organizerId: draftOrgId,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- inventory for intentionally invalid state event
      const hiddenInventoryId = await ctx.db.insert('event_inventory', {
        eventId: hiddenEventId,
        soldCount: 0,
        heldCount: 0,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- linking inventoryId on intentionally invalid state event
      await ctx.db.patch(hiddenEventId, {inventoryId: hiddenInventoryId});
    });

    // Published community with a published public event
    const pubOrgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Published Org',
      slug: 'pub-org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Visible Event',
      price: 2000,
      totalTickets: 100,
      date: `${futureDate}T00:00:00.000Z`,
      status: 'published',
      visibility: 'public',
      organizerId: pubOrgId,
    });

    const results = await t.query(
      internal.events.public.listPublicUpcomingInternal,
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Visible Event');
  });

  it('excludes public events from communities with isPublicDirectory: false', async () => {
    const t = convexTest();
    const now = Date.now();
    const futureDate = new Date(now + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // Private community (explicitly opted out of public directory)
    const privateOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Private Org',
        slug: 'private-org',
        isPublicDirectory: false,
      },
    );
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Community Event',
      price: 1000,
      totalTickets: 50,
      date: `${futureDate}T00:00:00.000Z`,
      status: 'published',
      visibility: 'public',
      organizerId: privateOrgId,
    });

    // Public community
    const publicOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Public Org',
        slug: 'public-org',
        isPublicDirectory: true,
      },
    );
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Community Event',
      price: 2000,
      totalTickets: 100,
      date: `${futureDate}T00:00:00.000Z`,
      status: 'published',
      visibility: 'public',
      organizerId: publicOrgId,
    });

    const results = await t.query(
      internal.events.public.listPublicUpcomingInternal,
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Public Community Event');
  });

  it('keeps scanning until it finds 12 public upcoming events when earlier pages are private', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Mixed Visibility Org',
        slug: 'mixed-visibility-org',
      },
    );

    // Bulk insert private events — too many to use seedEvent per row
    await t.run(async (ctx) => {
      for (let index = 0; index < 72; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 72 private events; calling seedEvent per row would be prohibitively slow
        await ctx.db.insert('events', {
          title: `Private Upcoming ${index + 1}`,
          date: isoDateDaysFrom('2032-01-01', index),
          price: 1000,
          totalTickets: 100,
          status: 'published',
          visibility: 'private',
          organizerId,
        });
      }
    });

    // Public events with inventory — use seedEvent
    for (let index = 0; index < 12; index += 1) {
      await t.mutation(api.testing.events.seedEvent, {
        title: `Public Upcoming ${index + 1}`,
        date: isoDateDaysFrom('2032-04-01', index) + 'T00:00:00.000Z',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId,
        soldCount: index,
      });
    }

    const results = await t.query(
      internal.events.public.listPublicUpcomingInternal,
      {},
    );

    expect(results).toHaveLength(12);
    expect(results.map((event) => event.title)).toEqual([
      'Public Upcoming 1',
      'Public Upcoming 2',
      'Public Upcoming 3',
      'Public Upcoming 4',
      'Public Upcoming 5',
      'Public Upcoming 6',
      'Public Upcoming 7',
      'Public Upcoming 8',
      'Public Upcoming 9',
      'Public Upcoming 10',
      'Public Upcoming 11',
      'Public Upcoming 12',
    ]);
  });
});

describe('events.update — auto-cancel marketing email on cancellation', () => {
  it('cancels a scheduled announcement when event is cancelled', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org',
      slug: 'org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-12-01T00:00:00.000Z',
      price: 0,
      totalTickets: 10,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    const recordId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation creates eventMarketingEmails records directly; only internal scheduling creates them
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() + 60_000,
        status: 'scheduled',
      }),
    );

    await t
      .withIdentity({subject: adminId})
      .mutation(api.events.management.update, {
        id: eventId,
        status: 'cancelled',
      });

    const record = await t.run(async (ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(record?.status).toBe('cancelled');
  });

  it('releases more than 200 open orders via scheduled continuation', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest();
      const adminId = await createRootAdmin(t, 'Admin');
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Org',
          slug: 'org-batched',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'High Volume Cleanup',
        date: '2026-12-01T00:00:00.000Z',
        price: 2500,
        totalTickets: 500,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      // Patch heldCount on inventory to simulate 201 held reservations
      await t.run(async (ctx) => {
        const event = await ctx.db.get('events', eventId as Id<'events'>);
        if (event?.inventoryId) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- setting heldCount directly to simulate held reservations; no production mutation manages heldCount
          await ctx.db.patch(event.inventoryId, {heldCount: 201});
        }
      });

      await t.run(async (ctx) => {
        for (let index = 0; index < 201; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 201 users + orders; calling createUserDirectly per user would be prohibitively slow
          const userId = await ctx.db.insert('users', {
            name: `Open Order User ${index}`,
            email: `open-order-${index}@example.com`,
          });
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of ticket_orders; no production mutation creates orders in bulk
          await ctx.db.insert('ticket_orders', {
            userId,
            eventId,
            kind: 'primary',
            quantity: 1,
            tier: 'regular',
            amountCents: 2500,
            currency: 'USD',
            state: 'open',
            expiresAt: Date.now() + 60_000,
            trustSource: 'open_access',
          });
        }
      });

      await t
        .withIdentity({subject: adminId})
        .mutation(api.events.management.update, {
          id: eventId,
          status: 'cancelled',
        });

      await finishAllScheduledFunctions(t);

      const releasedOrders = await t.run(async (ctx) =>
        ctx.db
          .query('ticket_orders')
          .withIndex('by_event_and_state', (q) =>
            q.eq('eventId', eventId).eq('state', 'released'),
          )
          .collect(),
      );
      const remainingOpenOrders = await t.run(async (ctx) =>
        ctx.db
          .query('ticket_orders')
          .withIndex('by_event_and_state', (q) =>
            q.eq('eventId', eventId).eq('state', 'open'),
          )
          .collect(),
      );

      expect(releasedOrders).toHaveLength(201);
      expect(remainingOpenOrders).toHaveLength(0);
      expect(
        releasedOrders.every((order) => order.releaseReason === 'cancelled'),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('events publish announcement scheduling', () => {
  it('schedules an announcement when creating a published event with announcement mode "now"', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Org',
        slug: 'org',
      },
    );

    const before = Date.now();
    const eventId = await t
      .withIdentity({subject: adminId})
      .mutation(api.events.management.create, {
        title: 'Launch Night',
        date: '2026-12-01T20:00:00.000Z',
        price: 0,
        totalTickets: 50,
        status: 'published',
        visibility: 'private',
        organizerId,
        announcement: {
          mode: 'now',
        },
      });
    const after = Date.now();

    const announcement = await t.run(async (ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );

    expect(announcement?.status).toBe('scheduled');
    expect(announcement?.scheduledFor).toBeGreaterThanOrEqual(before + 61_000);
    expect(announcement?.scheduledFor).toBeLessThanOrEqual(after + 61_000);
  });

  it('schedules an announcement when updating a draft event to published', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Org',
        slug: 'org',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Draft Event',
      date: '2026-12-01T20:00:00.000Z',
      price: 0,
      totalTickets: 50,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });

    const scheduledFor = Date.now() + 5 * 60_000;

    await t
      .withIdentity({subject: adminId})
      .mutation(api.events.management.update, {
        id: eventId,
        status: 'published',
        announcement: {
          mode: 'scheduled',
          scheduledFor,
        },
      });

    const announcement = await t.run(async (ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );

    expect(announcement?.status).toBe('scheduled');
    expect(announcement?.scheduledFor).toBe(scheduledFor);
  });

  it('does not schedule marketing email when community is draft', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Published Then Draft',
      slug: 'ptd-org',
      status: 'published',
      stripeConnectedAccountId: 'acct_ptd',
      stripeOnboardingStatus: 'complete',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      vettingQuestions: [
        {id: 'q1', question: 'Why?', type: 'text', required: true},
      ],
    });

    // Create a draft event under a published community
    const asAdmin = t.withIdentity({subject: adminId});
    const eventId = await asAdmin.mutation(api.events.management.create, {
      title: 'Pre-Draft Event',
      date: '2030-12-15T20:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      visibility: 'private',
      organizerId: orgId,
    });

    // Transition community to draft (cascades, but our event is already draft)
    await asAdmin.mutation(api.communities.profile.update, {
      id: orgId,
      status: 'draft',
    });

    // Try to publish the event — validator blocks it, so no email scheduled
    await expect(
      asAdmin.mutation(api.events.management.update, {
        id: eventId,
        status: 'published',
        announcement: {mode: 'now'},
      }),
    ).rejects.toThrow(
      'Cannot publish an event while the community is in draft mode',
    );

    // Verify no marketing email was created
    const emails = await t.run(async (ctx) =>
      ctx.db.query('eventMarketingEmails').collect(),
    );
    expect(emails).toHaveLength(0);
  });
});

describe('event publish — community draft guard', () => {
  it('rejects creating a published event under a draft community', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    // seedOrganizer with status: 'draft' is valid — draft orgs can be seeded
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Draft Org',
      slug: 'draft-org',
      status: 'draft',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Should Fail',
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 50,
        status: 'published',
        visibility: 'private',
        organizerId: orgId,
      }),
    ).rejects.toThrow(
      'Cannot publish an event while the community is in draft mode',
    );
  });

  it('allows creating a draft event under a draft community', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Draft Org',
      slug: 'draft-org',
      status: 'draft',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expect(
      asAdmin.mutation(api.events.management.create, {
        title: 'Draft OK',
        date: '2030-12-15T20:00:00.000Z',
        price: 1000,
        totalTickets: 50,
        status: 'draft',
        visibility: 'private',
        organizerId: orgId,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects publishing an existing event when community is draft', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Draft Org',
      slug: 'draft-org',
      status: 'draft',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Draft Event',
      price: 1000,
      totalTickets: 50,
      date: '2030-12-15T20:00:00.000Z',
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expect(
      asAdmin.mutation(api.events.management.update, {
        id: eventId,
        status: 'published',
      }),
    ).rejects.toThrow(
      'Cannot publish an event while the community is in draft mode',
    );
  });
});
