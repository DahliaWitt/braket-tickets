import {makeFunctionReference} from 'convex/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

const enableFeature = makeFunctionReference<
  'mutation',
  Record<string, never>,
  null
>('testing/guest_list:enableFeature');

afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers();
  const t = convexTest();
  await t.mutation(enableFeature, {});
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Capacity writers',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Capacity writers event',
    date: '2035-07-10T20:00:00.000Z',
    endDate: '2035-07-11T06:00:00.000Z',
    price: 1000,
    organizerId,
    visibility: 'public',
  });
  const managerId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Capacity manager',
    email: 'capacity-writers-manager@example.com',
    isRootAdmin: true,
  });
  const delegateId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Capacity delegate',
    email: 'capacity-writers-delegate@example.com',
    authEmailVerified: true,
  });
  return {
    t,
    eventId,
    manager: t.withIdentity({subject: managerId}),
    delegate: t.withIdentity({subject: delegateId}),
    delegateId,
  };
}

async function setStats(
  t: ReturnType<typeof convexTest>,
  eventId: Id<'events'>,
  counts: {activeAssignmentCount: number; totalGuestAdmissionCount: number},
): Promise<void> {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('guestListEventStats')
      .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
      .unique();
    const fields = {
      eventId,
      selfServiceGuestCount: 0,
      activeGrantedSlots: counts.activeAssignmentCount * 2,
      activeArtistGuestCount: 0,
      activeStaffGuestCount: 0,
      ...counts,
    };
    if (existing) {
      await ctx.db.patch('guestListEventStats', existing._id, fields);
    } else {
      await ctx.db.insert('guestListEventStats', fields);
    }
  });
}

describe('guest-list production writer capacity', () => {
  it('allows the 500th active assignment and rejects the 501st', async () => {
    const {t, eventId, manager} = await setup();
    await setStats(t, eventId, {
      activeAssignmentCount: 499,
      totalGuestAdmissionCount: 0,
    });

    await expect(
      manager.mutation(api.guest_list.assignments.create, {
        eventId,
        role: 'staff',
        displayName: 'Boundary staff',
        email: 'boundary-staff@example.com',
        idempotencyKey: 'assignment-cap-boundary',
      }),
    ).resolves.toMatchObject({status: 'active'});
    await expect(
      manager.mutation(api.guest_list.assignments.create, {
        eventId,
        role: 'artist',
        displayName: 'Overflow artist',
        email: 'overflow-artist@example.com',
        idempotencyKey: 'assignment-cap-overflow',
      }),
    ).rejects.toThrow('ACTIVE_ASSIGNMENT_CAP_EXCEEDED');

    await expect(
      t.run((ctx) =>
        ctx.db
          .query('guestListAssignments')
          .withIndex('by_eventId_and_status', (q) =>
            q.eq('eventId', eventId).eq('status', 'active'),
          )
          .collect(),
      ),
    ).resolves.toHaveLength(1);
  });

  it('rolls back a staff batch that would cross the active-assignment cap', async () => {
    const {t, eventId, manager} = await setup();
    await setStats(t, eventId, {
      activeAssignmentCount: 499,
      totalGuestAdmissionCount: 0,
    });

    await expect(
      manager.mutation(api.guest_list.assignments.bulkCreateStaff, {
        eventId,
        batchKey: 'assignment-cap-bulk',
        rows: [
          {name: 'Boundary crew', email: 'boundary-crew@example.com'},
          {name: 'Overflow crew', email: 'overflow-crew@example.com'},
        ],
      }),
    ).rejects.toThrow('ACTIVE_ASSIGNMENT_CAP_EXCEEDED');

    const state = await t.run(async (ctx) => ({
      assignments: await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) =>
          q.eq('eventId', eventId).eq('status', 'active'),
        )
        .collect(),
      batch: await ctx.db
        .query('importBatches')
        .withIndex('by_event_batch_key_target', (q) =>
          q
            .eq('eventId', eventId)
            .eq('batchKey', 'assignment-cap-bulk')
            .eq('target', 'assignmentStaff'),
        )
        .unique(),
      stats: await ctx.db
        .query('guestListEventStats')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .unique(),
    }));
    expect(state.assignments).toHaveLength(0);
    expect(state.batch).toBeNull();
    expect(state.stats).toMatchObject({activeAssignmentCount: 499});
  });

  it('allows the final assignment admission and rejects guest overflow atomically', async () => {
    const {t, eventId, manager} = await setup();
    await setStats(t, eventId, {
      activeAssignmentCount: 0,
      totalGuestAdmissionCount: 4_999,
    });

    await expect(
      manager.mutation(api.guest_list.assignments.create, {
        eventId,
        role: 'artist',
        displayName: 'Boundary artist',
        email: 'boundary-artist@example.com',
        idempotencyKey: 'admission-cap-boundary',
      }),
    ).resolves.toMatchObject({status: 'active'});
    await expect(
      manager.mutation(api.guest_list.assignments.create, {
        eventId,
        role: 'staff',
        displayName: 'Overflow staff',
        email: 'overflow-staff@example.com',
        idempotencyKey: 'admission-cap-overflow',
      }),
    ).rejects.toThrow('GUEST_ADMISSION_CAP_EXCEEDED');

    const rows = await t.run(async (ctx) => ({
      assignments: await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) =>
          q.eq('eventId', eventId).eq('status', 'active'),
        )
        .collect(),
      guests: await ctx.db
        .query('guests')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    }));
    expect(rows.assignments).toHaveLength(1);
    expect(rows.guests).toHaveLength(1);
  });

  it('allows the final self-service guest and leaves usage unchanged on overflow', async () => {
    const {t, eventId, manager, delegate, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Capacity delegate',
        email: 'capacity-writers-delegate@example.com',
        userId: delegateId,
        grantedSlots: 2,
        idempotencyKey: 'delegate-cap-assignment',
      },
    );
    await setStats(t, eventId, {
      activeAssignmentCount: 1,
      totalGuestAdmissionCount: 4_999,
    });
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };

    await expect(
      delegate.mutation(api.guest_list.delegate.addGuest, {
        access,
        name: 'Boundary guest',
        email: 'delegate-boundary@example.com',
        idempotencyKey: 'delegate-cap-boundary',
      }),
    ).resolves.toMatchObject({usedSlots: 1});
    await expect(
      t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).resolves.toMatchObject({totalGuestAdmissionCount: 5_000});
    await expect(
      delegate.mutation(api.guest_list.delegate.addGuest, {
        access,
        name: 'Overflow guest',
        email: 'delegate-overflow@example.com',
        idempotencyKey: 'delegate-cap-overflow',
      }),
    ).rejects.toThrow('GUEST_ADMISSION_CAP_EXCEEDED');

    await expect(
      t.run((ctx) =>
        ctx.db.get('guestListAssignments', assignment.assignmentId),
      ),
    ).resolves.toMatchObject({usedSlots: 1});
  });
});
