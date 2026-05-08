import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

describe('Events Performance', () => {
  it('management queries handle multiple orders correctly', async () => {
    const t = convexTest();

    // Setup Admin
    const adminId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Admin',
        email: 'admin-perf@test-perf.com',
        isRootAdmin: true,
      },
    )) as Id<'users'>;

    // Setup Event
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });
    const eventId = (await t.mutation(api.testing.events.seedEvent, {
      title: 'Perf Event',
      date: '2024-01-01T00:00:00.000Z',
      price: 100,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    })) as Id<'events'>;

    // Setup users, orders, and tickets.
    const numUsers = 5;

    for (let i = 0; i < numUsers; i++) {
      const uid = (await t.mutation(api.testing.users.createUserDirectly, {
        name: `User ${i}`,
        email: `user${i}@example.com`,
      })) as Id<'users'>;

      const orderId = await t.mutation(api.testing.orders.seedPayment, {
        userId: uid,
        eventId,
        amount: 100,
        status: 'completed',
        tier: 'regular',
        quantity: 1,
        trustSource: 'open_access',
      });

      await t.mutation(api.testing.tickets.seedTicket, {
        userId: uid,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
      });
    }

    // Run Internal Query as Admin
    // We can use t.withIdentity to set the context user
    const admin = t.withIdentity({subject: adminId});

    const summary = await admin.query(
      internal.events.management.getManagementSummaryInternal,
      {eventId, requestUserId: adminId},
    );
    const purchasesData = await admin.action(
      api.events.management.getManagementPurchases,
      {eventId},
    );

    expect(purchasesData.purchases.length).toBe(numUsers);
    // Purchases are sorted by createdAt desc.
    expect(purchasesData.purchases[0].userName).toBeDefined();
    expect(summary.soldCount).toBe(numUsers);

    const user0Purchase = purchasesData.purchases.find(
      (p) => p.userName === 'User 0',
    );
    expect(user0Purchase).toBeDefined();
    expect(user0Purchase?.userEmail).toBe('user0@example.com');
  });
});
