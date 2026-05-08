import {describe, expect, it} from 'vitest';
import {createAutoDrainConvexTest} from '../../setup.testing';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {addMember} from '../authz';

const convexTest = createAutoDrainConvexTest();

async function setupSoldOutEventWithSubscriber(options: {
  subscriptionEmail: string;
  userEmail: string | null;
  visibility?: 'public' | 'public_viewable' | 'private';
}) {
  const t = convexTest();

  const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Resale Community',
  });

  const sellerId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Seller',
    email: 'seller@example.com',
  });

  const subscriberId: Id<'users'> =
    options.userEmail === null
      ? // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production seed path for a user without an email; canonical user lookup must return null for this branch
        await t.run(async (ctx) => ctx.db.insert('users', {name: 'Subscriber'}))
      : await t.mutation(api.testing.users.createUserDirectly, {
          name: 'Subscriber',
          email: options.userEmail,
        });

  // Sold-out event (totalTickets=1, soldCount=1 → remaining=0 so
  // notifySubscribersForListedTicket proceeds past the inventory gate).
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Sold Out Event',
    date: '2099-01-01T00:00:00.000Z',
    price: 1000,
    organizerId: orgId,
    totalTickets: 1,
    visibility: options.visibility ?? 'public',
    soldCount: 1,
    resaleEnabled: true,
  });

  // Use production seed helpers to get a real ticket + order pair, then
  // directly insert the resale_listing and resale_notifications rows (no
  // production mutation creates these minimal shapes without driving the
  // full purchase/list flow, which is out of scope for this test).
  const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
    userId: sellerId,
    eventId,
    status: 'valid',
    tier: 'regular',
    trustSource: 'open_access',
  });

  await t.mutation(api.testing.resale.seedResaleListing, {
    ticketId,
    eventId,
    sellerId,
    status: 'listed',
  });

  const subscriptionId = await t.run(async (ctx) =>
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for resale_notifications with a stored email distinct from the canonical user email
    ctx.db.insert('resale_notifications', {
      userId: subscriberId,
      eventId,
      email: options.subscriptionEmail,
    }),
  );

  return {t, eventId, sellerId, subscriberId, subscriptionId};
}

describe('notifySubscribersForListedTicketState', () => {
  it('uses the canonical users.email when it differs from stored subscription email', async () => {
    const {t, eventId, sellerId, subscriptionId} =
      await setupSoldOutEventWithSubscriber({
        subscriptionEmail: 'stale-email@example.com',
        userEmail: 'fresh-email@example.com',
      });

    const count = await t.mutation(
      internal.resale.listings.notifySubscribersForListedTicket,
      {eventId, sellerId},
    );
    expect(count).toBe(1);

    const subscription = await t.run(async (ctx) =>
      ctx.db.get('resale_notifications', subscriptionId),
    );
    expect(subscription).not.toBeNull();
    expect(subscription?.email).toBe('fresh-email@example.com');
    expect(subscription?.notifiedAt).toEqual(expect.any(Number));
  });

  it('falls back to the stored subscription email when users.email is unavailable', async () => {
    const {t, eventId, sellerId, subscriptionId} =
      await setupSoldOutEventWithSubscriber({
        subscriptionEmail: 'stored-email@example.com',
        userEmail: null,
      });

    const count = await t.mutation(
      internal.resale.listings.notifySubscribersForListedTicket,
      {eventId, sellerId},
    );
    expect(count).toBe(1);

    const subscription = await t.run(async (ctx) =>
      ctx.db.get('resale_notifications', subscriptionId),
    );
    expect(subscription).not.toBeNull();
    // Stored subscription email is preserved (no canonical email to promote).
    expect(subscription?.email).toBe('stored-email@example.com');
    expect(subscription?.notifiedAt).toEqual(expect.any(Number));
  });

  it('removes and skips subscribers who no longer have purchase access', async () => {
    const {t, eventId, sellerId, subscriptionId} =
      await setupSoldOutEventWithSubscriber({
        subscriptionEmail: 'private-subscriber@example.com',
        userEmail: 'private-subscriber@example.com',
        visibility: 'private',
      });

    const count = await t.mutation(
      internal.resale.listings.notifySubscribersForListedTicket,
      {eventId, sellerId},
    );
    expect(count).toBe(0);

    const subscription = await t.run(async (ctx) =>
      ctx.db.get('resale_notifications', subscriptionId),
    );
    expect(subscription).toBeNull();
  });
});

describe('subscribeToResaleNotifications', () => {
  it('rejects subscribers who cannot purchase the event', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Private Resale Community',
    });
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Private Outsider',
      email: 'private-outsider@example.com',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Resale Event',
      date: '2099-01-01T00:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      totalTickets: 1,
      visibility: 'private',
      soldCount: 1,
      resaleEnabled: true,
    });

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.resale.listings.subscribeToResaleNotifications, {
        eventId,
      }),
    ).rejects.toThrow('Not authorized to subscribe to this event');
  });

  it('allows subscribers with shared purchase access', async () => {
    const t = convexTest();
    const eventOrgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Shared Resale Event Community',
    });
    const trustedOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Resale Community',
      },
    );
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Shared Resale Subscriber',
      email: 'shared-resale-subscriber@example.com',
    });
    await t.mutation(api.testing.trust_links.seedTrustLink, {
      trustingOrganizerId: eventOrgId,
      trustedOrganizerId: trustedOrgId,
      createdBy: userId,
    });
    await t.run(async (ctx) => addMember(ctx, userId, trustedOrgId));

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Shared Private Resale Event',
      date: '2099-01-01T00:00:00.000Z',
      price: 1000,
      organizerId: eventOrgId,
      totalTickets: 1,
      visibility: 'private',
      soldCount: 1,
      resaleEnabled: true,
    });

    const asUser = t.withIdentity({subject: userId});
    const subscriptionId = await asUser.mutation(
      api.resale.listings.subscribeToResaleNotifications,
      {eventId},
    );

    const subscription = await t.run(async (ctx) =>
      ctx.db.get('resale_notifications', subscriptionId),
    );
    expect(subscription?.userId).toBe(userId);
    expect(subscription?.eventId).toBe(eventId);
  });
});
