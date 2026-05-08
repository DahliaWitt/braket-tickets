import {convexTest} from '../setup.testing';
import {describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {
  MANAGEMENT_DATASET_LIMITS,
  MANAGEMENT_DATA_TOO_LARGE_CODE,
} from '../lib/management_limits';

async function setupManagementFixture(
  t: ReturnType<typeof convexTest>,
): Promise<{
  adminId: Id<'users'>;
  eventId: Id<'events'>;
}> {
  const adminId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: 'admin-mgmt@test-limits.com',
    isRootAdmin: true,
  });
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Management Org',
    slug: 'management-org',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Large Event',
    date: '2030-06-01T00:00:00.000Z',
    price: 2_000,
    totalTickets: 20_000,
    status: 'published',
    visibility: 'public',
    organizerId,
  });
  return {adminId: adminId as Id<'users'>, eventId: eventId as Id<'events'>};
}

async function insertMany(
  t: ReturnType<typeof convexTest>,
  total: number,
  insertBatch: (offset: number, count: number) => Promise<void>,
): Promise<void> {
  const batchSize = 250;

  for (let offset = 0; offset < total; offset += batchSize) {
    const count = Math.min(batchSize, total - offset);
    await insertBatch(offset, count);
  }
}

async function expectOversizeError(
  call: () => Promise<unknown>,
  limit: number,
): Promise<void> {
  await expect(call()).rejects.toThrow(
    new RegExp(`${MANAGEMENT_DATA_TOO_LARGE_CODE}.*${limit}`),
  );
}

describe('per-surface management query oversized datasets', () => {
  it('summary: throws an explicit limit error when ticket metrics would be truncated', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupManagementFixture(t);
    const ticketOwnerId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk owner user for limit test; createUserDirectly would be redundant overhead
      ctx.db.insert('users', {name: 'Bulk Ticket Owner'}),
    );
    const totalTickets = MANAGEMENT_DATASET_LIMITS.tickets + 1;

    await insertMany(t, totalTickets, async (_offset, count) => {
      await t.run(async (ctx) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert to exceed dataset limit; using seedTicket per row would be prohibitively slow
          await ctx.db.insert('tickets', {
            eventId,
            userId: ticketOwnerId,
            status: 'valid',
            tier: 'regular',
          });
        }
      });
    });

    await expectOversizeError(
      () =>
        t.query(internal.events.management.getManagementSummaryInternal, {
          eventId,
          requestUserId: adminId,
        }),
      MANAGEMENT_DATASET_LIMITS.tickets,
    );
  });

  it('guests.listByEvent: throws an explicit limit error when guest metrics would be truncated', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupManagementFixture(t);
    const totalGuests = MANAGEMENT_DATASET_LIMITS.guests + 1;

    await insertMany(t, totalGuests, async (offset, count) => {
      await t.run(async (ctx) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert to exceed dataset limit; no production composite exists for guests
          await ctx.db.insert('guests', {
            eventId,
            name: `Guest ${offset + index}`,
            type: 'guest',
          });
        }
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expectOversizeError(
      () => asAdmin.query(api.events.guests.listByEvent, {eventId}),
      MANAGEMENT_DATASET_LIMITS.guests,
    );
  });

  it('purchases: throws an explicit limit error when order purchases would be truncated', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupManagementFixture(t);
    const buyerId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk buyer user for limit test; createUserDirectly would be redundant overhead
      ctx.db.insert('users', {name: 'Bulk Buyer'}),
    );
    const orderLimit = MANAGEMENT_DATASET_LIMITS.orders;
    const totalOrders = orderLimit + 1;

    await insertMany(t, totalOrders, async (_offset, count) => {
      await t.run(async (ctx) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert to exceed order purchase limit; production checkout would be prohibitively slow here
          await ctx.db.insert('ticket_orders', {
            userId: buyerId,
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
        }
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expectOversizeError(
      () => asAdmin.action(api.events.management.getManagementPurchases, {eventId}),
      orderLimit,
    );
  });

  it('resale: throws an explicit limit error when resale listing metrics would be truncated', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupManagementFixture(t);
    const sellerId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk seller user for limit test; createUserDirectly would be redundant overhead
      ctx.db.insert('users', {name: 'Bulk Seller'}),
    );
    const ticketId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- single ticket for resale listing seed; seedTicket would update inventory count which is irrelevant to this limit test
      ctx.db.insert('tickets', {
        eventId,
        userId: sellerId,
        status: 'valid',
        tier: 'regular',
      }),
    );
    const totalListings = MANAGEMENT_DATASET_LIMITS.resaleListings + 1;

    await insertMany(t, totalListings, async (_offset, count) => {
      await t.run(async (ctx) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert to exceed dataset limit; no production composite for resale_listings
          await ctx.db.insert('resale_listings', {
            eventId,
            ticketId,
            sellerId,
            status: 'listed',
          });
        }
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expectOversizeError(
      () => asAdmin.action(api.events.management.getManagementResale, {eventId}),
      MANAGEMENT_DATASET_LIMITS.resaleListings,
    );
  });

  it('resale: throws an explicit limit error when resale notification metrics would be truncated', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupManagementFixture(t);
    const userId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- watcher user for limit test; createUserDirectly would be redundant overhead
      ctx.db.insert('users', {
        name: 'Resale Watcher',
        email: 'watcher@example.com',
      }),
    );
    const totalNotifications =
      MANAGEMENT_DATASET_LIMITS.resaleNotifications + 1;

    await insertMany(t, totalNotifications, async (_offset, count) => {
      await t.run(async (ctx) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert to exceed dataset limit; no production composite for resale_notifications
          await ctx.db.insert('resale_notifications', {
            eventId,
            userId,
            email: 'watcher@example.com',
          });
        }
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await expectOversizeError(
      () => asAdmin.action(api.events.management.getManagementResale, {eventId}),
      MANAGEMENT_DATASET_LIMITS.resaleNotifications,
    );
  });
});
