import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, it, expect, vi} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'users'>> {
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@test.com`,
    isRootAdmin: true,
  });
  return userId;
}

describe('Applications', () => {
  it('submits and retrieves my application', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant',
      email: 'applicant@test.com',
    });

    const asUser = t.withIdentity({subject: userId});

    // Submit
    await asUser.mutation(api.communities.applications.submit, {
      answers: {whyJoin: 'Test reason'},
    });

    // Get
    const app = await asUser.query(
      api.communities.applications.getMyApplication,
      {},
    );
    expect(app).toBeDefined();
    expect(app?.status).toBe('pending');
    expect(app?.answers.whyJoin).toBe('Test reason');
  });

  it('admin can list applications', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant',
      email: 'applicant-list@test.com',
    });

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Org',
      },
    );

    const asUser = t.withIdentity({subject: userId});
    await asUser.mutation(api.communities.applications.submit, {
      answers: {'seed-default': 'a'},
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const apps = await asAdmin.query(api.communities.applications.list, {});

    expect(apps).toHaveLength(1);
    expect(apps[0].user?.name).toBe('Applicant');
    expect(apps[0].organizer?.name).toBe('Org');
  });
});

describe('Events', () => {
  it('admin can delete event without tickets', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        slug: 'test-org',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dead Event',
      date: '2024-01-01T00:00:00.000Z',
      price: 0,
      totalTickets: 10,
      status: 'draft',
      visibility: 'public',
      organizerId,
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.events.management.remove, {id: eventId});

    const event = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(event).toBeNull();
  });

  it('admin deletes events with more than 200 released orders via scheduled continuation', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest();
      const adminId = await createRootAdmin(t, 'Admin');

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-batched-delete',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Busy Event',
        date: '2026-01-01T00:00:00.000Z',
        price: 2500,
        totalTickets: 500,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- event_inventory requires patch to link inventoryId; no production mutation exposes this internal link */
      const {inventoryId} = await t.run(async (ctx) => {
        const inventoryId = await ctx.db.insert('event_inventory', {
          eventId,
          soldCount: 0,
          heldCount: 0,
        });
        await ctx.db.patch('events', eventId, {inventoryId});
        return {inventoryId};
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- bulk seeding 201 released orders/financial-events; no production batch-insert mutation exists */
      await t.run(async (ctx) => {
        for (let index = 0; index < 201; index += 1) {
          const userId = await ctx.db.insert('users', {
            name: `Released Order User ${index}`,
            email: `released-order-${index}@example.com`,
          });
          const orderId = await ctx.db.insert('ticket_orders', {
            userId,
            eventId,
            kind: 'primary',
            quantity: 1,
            tier: 'regular',
            amountCents: 2500,
            currency: 'USD',
            state: 'released',
            expiresAt: Date.now() + 60_000,
            releasedAt: Date.now(),
            releaseReason: 'cancelled',
            trustSource: 'open_access',
            stripePaymentIntentId: `pi_batched_${index}`,
            stripeChargeId: `ch_batched_${index}`,
          });

          await ctx.db.insert('order_financial_events', {
            orderId,
            eventId,
            currency: 'USD',
            kind: 'payment_captured',
            amountCents: 2500,
            stripePaymentIntentId: `pi_batched_${index}`,
            stripeChargeId: `ch_batched_${index}`,
            occurredAt: Date.now(),
          });
        }
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const admin = t.withIdentity({subject: adminId});
      await admin.mutation(api.events.management.remove, {id: eventId});

      await finishAllScheduledFunctions(t);

      const [event, inventory, remainingOrders, remainingFinancialEvents] =
        await Promise.all([
          t.run(async (ctx) => await ctx.db.get(eventId)),
          t.run(async (ctx) => await ctx.db.get(inventoryId)),
          t.run(async (ctx) =>
            ctx.db
              .query('ticket_orders')
              .withIndex('by_event_and_state', (q) =>
                q.eq('eventId', eventId).eq('state', 'released'),
              )
              .collect(),
          ),
          t.run(async (ctx) =>
            ctx.db
              .query('order_financial_events')
              .withIndex('by_event', (q) => q.eq('eventId', eventId))
              .collect(),
          ),
        ]);

      expect(event).toBeNull();
      expect(inventory).toBeNull();
      expect(remainingOrders).toHaveLength(0);
      expect(remainingFinancialEvents).toHaveLength(0);

      const auditLog = await t.run(async (ctx) =>
        ctx.db
          .query('adminAuditLogs')
          .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
          .first(),
      );
      expect(auditLog?.action).toBe('event.delete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cancel the event when delete is blocked by completed orders', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        slug: 'test-org-delete-blocked',
      },
    );
    const eventId = (await t.mutation(api.testing.events.seedEvent, {
      title: 'Blocked Delete Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 2500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    })) as Id<'events'>;
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- event_inventory/ticket_orders/eventMarketingEmails require direct inserts; no production mutations expose this internal state setup */
    const {marketingEmailId} = await t.run(async (ctx) => {
      const inventoryId = await ctx.db.insert('event_inventory', {
        eventId,
        soldCount: 1,
        heldCount: 0,
      });
      await ctx.db.patch('events', eventId, {inventoryId});

      const userId = await ctx.db.insert('users', {
        name: 'Completed Order User',
        email: 'completed-order-user@example.com',
      });
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
        completedAt: Date.now(),
        trustSource: 'open_access',
      });

      const marketingEmailId = await ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() + 60_000,
        status: 'scheduled',
      });

      return {marketingEmailId};
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const admin = t.withIdentity({subject: adminId});
    await expect(
      admin.mutation(api.events.management.remove, {id: eventId}),
    ).rejects.toThrow('Cannot delete event with completed orders');

    const [event, marketingEmail] = await Promise.all([
      t.run(async (ctx) => await ctx.db.get('events', eventId)),
      t.run(
        async (ctx) =>
          await ctx.db.get('eventMarketingEmails', marketingEmailId),
      ),
    ]);

    expect(event?.status).toBe('published');
    expect(marketingEmail?.status).toBe('scheduled');
  });

  it('admin deletes an event when a released order has more than 200 financial events', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest();
      const adminId = await createRootAdmin(t, 'Admin');

      const organizerId2 = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-batched-financial-events',
        },
      );
      const eventId2 = await t.mutation(api.testing.events.seedEvent, {
        title: 'Deep Cleanup Event',
        date: '2026-01-01T00:00:00.000Z',
        price: 2500,
        totalTickets: 500,
        status: 'published',
        visibility: 'public',
        organizerId: organizerId2,
      });
      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- event_inventory/ticket_orders/order_financial_events require direct inserts; no production mutations expose this internal state setup */
      const {inventoryId, orderId} = await t.run(async (ctx) => {
        const inventoryId = await ctx.db.insert('event_inventory', {
          eventId: eventId2,
          soldCount: 0,
          heldCount: 0,
        });
        await ctx.db.patch('events', eventId2, {inventoryId});

        const userId = await ctx.db.insert('users', {
          name: 'Released Order User',
          email: 'released-order-financial-events@example.com',
        });
        const orderId = await ctx.db.insert('ticket_orders', {
          userId,
          eventId: eventId2,
          kind: 'primary',
          quantity: 1,
          tier: 'regular',
          amountCents: 2500,
          currency: 'USD',
          state: 'released',
          expiresAt: Date.now() + 60_000,
          releasedAt: Date.now(),
          releaseReason: 'cancelled',
          trustSource: 'open_access',
          stripePaymentIntentId: 'pi_deep_cleanup',
          stripeChargeId: 'ch_deep_cleanup',
        });

        for (let index = 0; index < 201; index += 1) {
          await ctx.db.insert('order_financial_events', {
            orderId,
            eventId: eventId2,
            currency: 'USD',
            kind: 'payment_captured',
            amountCents: 2500,
            stripePaymentIntentId: `pi_deep_cleanup_${index}`,
            stripeChargeId: `ch_deep_cleanup_${index}`,
            occurredAt: Date.now() + index,
          });
        }

        return {inventoryId, orderId};
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const admin = t.withIdentity({subject: adminId});
      await admin.mutation(api.events.management.remove, {id: eventId2});

      await finishAllScheduledFunctions(t);

      const [event, inventory, order, financialEvents] = await Promise.all([
        t.run(async (ctx) => await ctx.db.get(eventId2)),
        t.run(async (ctx) => await ctx.db.get(inventoryId)),
        t.run(async (ctx) => await ctx.db.get('ticket_orders', orderId)),
        t.run(async (ctx) =>
          ctx.db
            .query('order_financial_events')
            .withIndex('by_order', (q) => q.eq('orderId', orderId))
            .collect(),
        ),
      ]);

      expect(event).toBeNull();
      expect(inventory).toBeNull();
      expect(order).toBeNull();
      expect(financialEvents).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prevents deleting event with tickets', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        slug: 'test-org-with-tickets',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Event with tickets',
      date: '2024-01-01T00:00:00.000Z',
      price: 100,
      totalTickets: 10,
      status: 'published',
      visibility: 'public',
      organizerId,
    });
    await t.mutation(api.testing.tickets.seedTicket, {
      eventId,
      userId: adminId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const admin = t.withIdentity({subject: adminId});
    await expect(
      admin.mutation(api.events.management.remove, {id: eventId}),
    ).rejects.toThrow('Cannot delete event with existing tickets');
  });

  it('admin can create event with organizer', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
      },
    );

    const admin = t.withIdentity({subject: adminId});
    const eventId = await admin.mutation(api.events.management.create, {
      title: 'Organized Event',
      date: '2024-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'private',
      organizerId,
    });

    expect(eventId).toBeDefined();

    const event = await admin.query(api.events.public.get, {id: eventId});
    expect(event).toBeDefined();
    expect(event?.title).toBe('Organized Event');
    expect(event?.organizerId).toBe(organizerId);
  });

  it('admin can update event organizer', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId1 = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community 1',
      },
    );

    const organizerId2 = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community 2',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Event',
      date: '2024-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: organizerId1,
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.events.management.update, {
      id: eventId,
      organizerId: organizerId2,
    });

    const event = await admin.query(api.events.public.get, {id: eventId});
    expect(event?.organizerId).toBe(organizerId2);
  });

  it('admin can update event title', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin');

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Event',
      date: '2024-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.events.management.update, {
      id: eventId,
      title: 'Updated Event Title',
    });

    const event = await admin.query(api.events.public.get, {id: eventId});
    expect(event?.title).toBe('Updated Event Title');
  });
});
