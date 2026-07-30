import {describe, expect, it} from 'vitest';
import {convexTest} from '../../setup.testing';
import {api} from '../../_generated/api';
import {
  ACTIVE_ASSIGNMENT_CAP_EXCEEDED,
  assertActiveAssignmentCapacity,
  assertGuestAdmissionCapacity,
  GUEST_ADMISSION_CAP_EXCEEDED,
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
