import {makeFunctionReference} from 'convex/server';
import {describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import {convexTest} from '../setup.testing';

const enableFeature = makeFunctionReference<
  'mutation',
  Record<string, never>,
  null
>('testing/guest_list:enableFeature');

async function setup() {
  const t = convexTest();
  await t.mutation(enableFeature, {});
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Capacity cleanup',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Capacity cleanup event',
    date: '2035-07-10T20:00:00.000Z',
    endDate: '2035-07-11T06:00:00.000Z',
    price: 1000,
    organizerId,
    visibility: 'public',
  });
  const managerId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Capacity cleanup manager',
    email: 'capacity-cleanup-manager@example.com',
    isRootAdmin: true,
  });
  return {
    t,
    organizerId,
    eventId,
    managerId,
    manager: t.withIdentity({subject: managerId}),
  };
}

describe('guest-list over-cap cleanup', () => {
  it('removes a guest from legacy over-cap data and initializes exact boundary stats', async () => {
    const {t, eventId, manager} = await setup();
    const guestId = await t.run(async (ctx) => {
      let target;
      for (let index = 0; index < 5_001; index += 1) {
        target = await ctx.db.insert('guests', {
          eventId,
          name: `Legacy guest ${index}`,
          type: 'guest',
        });
      }
      if (!target) throw new Error('Failed to seed legacy guests');
      return target;
    });

    await expect(
      manager.mutation(api.events.guests.remove, {id: guestId}),
    ).resolves.toBeNull();
    await expect(
      t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).resolves.toMatchObject({totalGuestAdmissionCount: 5_000});
  }, 20_000);

  it('revokes from legacy active-assignment overflow and initializes boundary stats', async () => {
    const {t, organizerId, eventId, managerId, manager} = await setup();
    const assignmentId = await t.run(async (ctx) => {
      let target;
      for (let index = 0; index < 501; index += 1) {
        target = await ctx.db.insert('guestListAssignments', {
          eventId,
          organizerId,
          role: 'staff',
          displayName: `Legacy delegate ${index}`,
          email: `legacy-delegate-${index}@example.com`,
          emailKey: `legacy-delegate-${index}@example.com`,
          eventDate: '2035-07-10T20:00:00.000Z',
          grantedSlots: 2,
          usedSlots: 0,
          status: 'active',
          inviteState: 'pending',
          createdBy: managerId,
          createdAt: index,
          invitedAt: index,
          idempotencyKey: `legacy-delegate-${index}`,
        });
      }
      if (!target) throw new Error('Failed to seed legacy assignments');
      return target;
    });

    await expect(
      manager.mutation(api.guest_list.assignments.revoke, {assignmentId}),
    ).resolves.toMatchObject({status: 'revoked'});
    await expect(
      t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).resolves.toMatchObject({activeAssignmentCount: 500});
  }, 20_000);
});
