import {describe, expect, it} from 'vitest';
import {convexTest} from '../../setup.testing';
import {api} from '../../_generated/api';
import {
  ACTIVE_ASSIGNMENT_CAP_EXCEEDED,
  assertActiveAssignmentCapacity,
  assertGuestAdmissionCapacity,
  GUEST_ADMISSION_CAP_EXCEEDED,
  getOrCreateGuestListEventStatsFromRoster,
  loadAuthoritativeGuestListEventCounters,
  MAX_ASSIGNMENTS_PER_EVENT_STATS,
  MAX_GUESTS_PER_EVENT_STATS,
} from './event_stats';

describe('guest-list event capacity', () => {
  it('accepts exact admission and active-assignment boundaries, then rejects overflow with stable codes', () => {
    expect(() =>
      assertGuestAdmissionCapacity(
        {totalGuestAdmissionCount: MAX_GUESTS_PER_EVENT_STATS - 1},
        1,
      ),
    ).not.toThrow();
    expect(() =>
      assertGuestAdmissionCapacity(
        {totalGuestAdmissionCount: MAX_GUESTS_PER_EVENT_STATS},
        1,
      ),
    ).toThrow(GUEST_ADMISSION_CAP_EXCEEDED);

    expect(() =>
      assertActiveAssignmentCapacity({
        activeAssignmentCount: MAX_ASSIGNMENTS_PER_EVENT_STATS - 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertActiveAssignmentCapacity({
        activeAssignmentCount: MAX_ASSIGNMENTS_PER_EVENT_STATS,
      }),
    ).toThrow(ACTIVE_ASSIGNMENT_CAP_EXCEEDED);
  });

  it('counts only active assignments when revoked history exceeds the active cap', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Capacity history'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Capacity history event',
      date: '2035-07-10T20:00:00.000Z',
      price: 1000,
      organizerId,
      visibility: 'public',
    });
    const managerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Capacity manager',
      email: 'capacity-manager@example.com',
      isRootAdmin: true,
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert('guestListAssignments', {
          eventId,
          organizerId,
          role: 'staff',
          displayName: `Revoked delegate ${index}`,
          email: `revoked-${index}@example.com`,
          emailKey: `revoked-${index}@example.com`,
          eventDate: '2035-07-10T20:00:00.000Z',
          grantedSlots: 2,
          usedSlots: 0,
          status: 'revoked',
          inviteState: 'pending',
          createdBy: managerId,
          createdAt: index,
          invitedAt: index,
          revokedAt: index,
          revokedBy: managerId,
          idempotencyKey: `revoked-${index}`,
        });
      }
      for (let index = 0; index < MAX_ASSIGNMENTS_PER_EVENT_STATS; index += 1) {
        await ctx.db.insert('guestListAssignments', {
          eventId,
          organizerId,
          role: 'artist',
          displayName: `Active delegate ${index}`,
          email: `active-${index}@example.com`,
          emailKey: `active-${index}@example.com`,
          eventDate: '2035-07-10T20:00:00.000Z',
          grantedSlots: 2,
          usedSlots: 1,
          status: 'active',
          inviteState: 'pending',
          createdBy: managerId,
          createdAt: 1_000 + index,
          invitedAt: 1_000 + index,
          idempotencyKey: `active-${index}`,
        });
      }
    });

    await expect(
      t.run((ctx) => loadAuthoritativeGuestListEventCounters(ctx, eventId)),
    ).resolves.toMatchObject({
      activeAssignmentCount: MAX_ASSIGNMENTS_PER_EVENT_STATS,
      activeGrantedSlots: MAX_ASSIGNMENTS_PER_EVENT_STATS * 2,
    });

    await t.run((ctx) =>
      ctx.db.insert('guestListAssignments', {
        eventId,
        organizerId,
        role: 'staff',
        displayName: 'Overflow delegate',
        email: 'overflow@example.com',
        emailKey: 'overflow@example.com',
        eventDate: '2035-07-10T20:00:00.000Z',
        grantedSlots: 2,
        usedSlots: 0,
        status: 'active',
        inviteState: 'pending',
        createdBy: managerId,
        createdAt: 2_000,
        invitedAt: 2_000,
        idempotencyKey: 'active-overflow',
      }),
    );
    await expect(
      t.run((ctx) => loadAuthoritativeGuestListEventCounters(ctx, eventId)),
    ).resolves.toBeNull();
  });
});

describe('roster-seeded stats initialization', () => {
  async function seedEvent(t: ReturnType<typeof convexTest>) {
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Roster seed'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Roster seed event',
      date: '2035-07-10T20:00:00.000Z',
      price: 1000,
      organizerId,
      visibility: 'public',
    });
    return eventId;
  }

  it('derives counters from the supplied roster without re-reading guests', async () => {
    const t = convexTest();
    const eventId = await seedEvent(t);
    // A stale roster snapshot would produce visibly different counters than a
    // re-read, so counters matching the SUPPLIED roster (not the database)
    // proves the guests table was not read again.
    await t.run(async (ctx) => {
      await ctx.db.insert('guests', {
        eventId,
        name: 'DB-only guest',
        type: 'guest',
      });
    });
    const created = await t.run((ctx) =>
      getOrCreateGuestListEventStatsFromRoster(ctx, eventId, {
        guests: [{sourceKind: 'self_service'}, {sourceKind: undefined}],
        complete: true,
      }),
    );
    expect(created).toMatchObject({
      eventId,
      selfServiceGuestCount: 1,
      totalGuestAdmissionCount: 2,
      activeAssignmentCount: 0,
    });
  });

  it('returns an existing row untouched regardless of the supplied roster', async () => {
    const t = convexTest();
    const eventId = await seedEvent(t);
    await t.run((ctx) =>
      ctx.db.insert('guestListEventStats', {
        eventId,
        selfServiceGuestCount: 3,
        activeGrantedSlots: 4,
        activeArtistGuestCount: 1,
        activeStaffGuestCount: 2,
        activeAssignmentCount: 2,
        totalGuestAdmissionCount: 9,
      }),
    );
    const existing = await t.run((ctx) =>
      getOrCreateGuestListEventStatsFromRoster(ctx, eventId, {
        guests: [],
        complete: true,
      }),
    );
    expect(existing).toMatchObject({totalGuestAdmissionCount: 9});
  });

  it('falls back to the authoritative read when the roster is incomplete', async () => {
    const t = convexTest();
    const eventId = await seedEvent(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('guests', {
        eventId,
        name: 'Authoritative guest',
        type: 'guest',
      });
    });
    const created = await t.run((ctx) =>
      getOrCreateGuestListEventStatsFromRoster(ctx, eventId, {
        guests: [],
        complete: false,
      }),
    );
    expect(created).toMatchObject({totalGuestAdmissionCount: 1});
  });
});
