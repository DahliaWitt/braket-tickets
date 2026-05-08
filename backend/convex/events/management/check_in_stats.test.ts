import {convexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

describe('checkInStats on getManagementSummaryInternal', () => {
  async function setupAdminAndEvent(t: ReturnType<typeof convexTest>) {
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-checkin@test-checkin.com',
      isRootAdmin: true,
    });

    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Check-in Test Event',
      date: '2026-06-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    return {adminId, eventId};
  }

  it('returns zeroed stats when no tickets exist', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupAdminAndEvent(t);

    const admin = t.withIdentity({subject: adminId});
    const data = await admin.query(internal.events.management.getManagementSummaryInternal, {
      eventId: eventId as Id<'events'>,
      requestUserId: adminId as Id<'users'>,
    });

    expect(data.checkInStats.checkedIn).toBe(0);
    expect(data.checkInStats.checkInRate).toBe(0);
    expect(data.checkInStats.buckets).toEqual([]);
  });

  it('counts only used tickets with checkedInAt', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupAdminAndEvent(t);

    const now = Date.now();

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk ticket inserts with checkedInAt; seedTicket does not expose checkedInAt/checkedInBy
      const uid1 = await ctx.db.insert('users', {name: 'User 1'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      const uid2 = await ctx.db.insert('users', {name: 'User 2'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      const uid3 = await ctx.db.insert('users', {name: 'User 3'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      const uid4 = await ctx.db.insert('users', {name: 'User 4'});

      // valid ticket — active, not checked in
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- ticket with checkedInAt; seedTicket does not expose this field
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid1,
        status: 'valid',
        tier: 'regular',
      });

      // another valid ticket — active, not checked in
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid2,
        status: 'valid',
        tier: 'regular',
      });

      // used ticket with checkedInAt — should be counted
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- ticket with checkedInAt; seedTicket does not expose this field
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid3,
        status: 'used',
        tier: 'regular',
        checkedInAt: now,
      });

      // refunded ticket — excluded from activeTickets entirely
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid4,
        status: 'refunded',
        tier: 'regular',
      });

      // Sync inventory soldCount so canonicalSoldCount = activeTickets.length (3).
      // Raw ticket inserts bypass the production path that increments soldCount.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- syncing inventory soldCount after raw ticket inserts; raw path does not call inventory helpers
      const event = await ctx.db.get(eventId as Id<'events'>);
      if (event?.inventoryId) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        await ctx.db.patch(event.inventoryId, {soldCount: 3});
      }
    });

    const admin = t.withIdentity({subject: adminId});
    const data = await admin.query(internal.events.management.getManagementSummaryInternal, {
      eventId: eventId as Id<'events'>,
      requestUserId: adminId as Id<'users'>,
    });

    // activeTickets = 3 (2 valid + 1 used), checkedIn = 1
    expect(data.checkInStats.checkedIn).toBe(1);
    expect(data.checkInStats.checkInRate).toBeCloseTo(1 / 3, 10);
  });

  it('buckets check-ins into 15-minute intervals', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupAdminAndEvent(t);

    // Pick a fixed anchor aligned to a bucket boundary so arithmetic is clean
    const bucketAnchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

    // Two check-ins in the same bucket
    const ts1 = bucketAnchor + 1_000;
    const ts2 = bucketAnchor + 2_000;
    // One check-in in the next bucket
    const ts3 = bucketAnchor + FIFTEEN_MIN_MS + 3_000;

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk ticket inserts with checkedInAt; seedTicket does not expose checkedInAt/checkedInBy
      const uid1 = await ctx.db.insert('users', {name: 'User A'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      const uid2 = await ctx.db.insert('users', {name: 'User B'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      const uid3 = await ctx.db.insert('users', {name: 'User C'});

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- ticket with specific checkedInAt timestamp for bucket math; seedTicket does not expose this field
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid1,
        status: 'used',
        tier: 'regular',
        checkedInAt: ts1,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid2,
        status: 'used',
        tier: 'regular',
        checkedInAt: ts2,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid3,
        status: 'used',
        tier: 'regular',
        checkedInAt: ts3,
      });

      // Sync inventory soldCount so canonicalSoldCount = activeTickets.length (3).
      // Raw ticket inserts bypass the production path that increments soldCount.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- syncing inventory soldCount after raw ticket inserts; raw path does not call inventory helpers
      const event = await ctx.db.get(eventId as Id<'events'>);
      if (event?.inventoryId) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        await ctx.db.patch(event.inventoryId, {soldCount: 3});
      }
    });

    const admin = t.withIdentity({subject: adminId});
    const data = await admin.query(internal.events.management.getManagementSummaryInternal, {
      eventId: eventId as Id<'events'>,
      requestUserId: adminId as Id<'users'>,
    });

    const expectedBucket1 = Math.floor(ts1 / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    const expectedBucket2 = Math.floor(ts3 / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

    expect(data.checkInStats.checkedIn).toBe(3);
    expect(data.checkInStats.checkInRate).toBe(1);
    expect(data.checkInStats.buckets).toHaveLength(2);
    expect(data.checkInStats.buckets[0]).toEqual({time: expectedBucket1, count: 2});
    expect(data.checkInStats.buckets[1]).toEqual({time: expectedBucket2, count: 1});
  });

  it('uses inventory soldCount as denominator when inventoryId is set', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupAdminAndEvent(t);

    const now = Date.now();

    await t.run(async (ctx) => {
      // Override the inventory soldCount to simulate 12 tickets ever sold (11 refunded)
      const event = await ctx.db.get(eventId as Id<'events'>);
      if (event?.inventoryId) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- overriding inventory soldCount to test checkInRate denominator math; seedEvent does not expose per-inventory counts
        await ctx.db.patch(event.inventoryId, {soldCount: 12});
      }

      // Insert only 1 active ticket (as if 11 were refunded)
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- ticket with checkedInAt; seedTicket does not expose this field
      const uid = await ctx.db.insert('users', {name: 'User A'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        eventId: eventId as Id<'events'>,
        userId: uid,
        status: 'used',
        tier: 'regular',
        checkedInAt: now,
      });
    });

    const admin = t.withIdentity({subject: adminId});
    const data = await admin.query(internal.events.management.getManagementSummaryInternal, {
      eventId: eventId as Id<'events'>,
      requestUserId: adminId as Id<'users'>,
    });

    // soldCount must match inventory (12), not activeTickets.length (1)
    expect(data.soldCount).toBe(12);
    expect(data.checkInStats.checkedIn).toBe(1);
    // checkInRate denominator is inventory.soldCount = 12, not 1
    expect(data.checkInStats.checkInRate).toBeCloseTo(1 / 12, 10);
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();
    const {eventId} = await setupAdminAndEvent(t);

    const nonAdminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-checkin@test-checkin.com',
    });

    const nonAdmin = t.withIdentity({subject: nonAdminId});

    await expect(
      nonAdmin.query(internal.events.management.getManagementSummaryInternal, {
        eventId: eventId as Id<'events'>,
        requestUserId: nonAdminId as Id<'users'>,
      }),
    ).rejects.toThrow();
  });
});
