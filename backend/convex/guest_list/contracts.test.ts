import {makeFunctionReference} from 'convex/server';
import {describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {rateLimiter} from '../lib/rate_limits';
import {convexTest} from '../setup.testing';

const getSettings = makeFunctionReference<
  'query',
  {organizerId: Id<'organizers'>},
  {artistSlots: number; staffSlots: number}
>('communities/management/guest_list_settings:get');

const updateSettings = makeFunctionReference<
  'mutation',
  {
    organizerId: Id<'organizers'>;
    artistSlots: number;
    staffSlots: number;
  },
  {artistSlots: number; staffSlots: number}
>('communities/management/guest_list_settings:update');

async function setupManager() {
  const t = convexTest();
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Self-service guest list contracts',
  });
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Guest list manager',
    email: 'guest-list-manager@example.com',
    isRootAdmin: true,
  });
  return {
    t,
    organizerId,
    userId,
    manager: t.withIdentity({subject: userId}),
  };
}

describe('self-service guest-list contracts', () => {
  it('returns effective 2/2 defaults before settings are saved', async () => {
    const {manager, organizerId} = await setupManager();

    await expect(manager.query(getSettings, {organizerId})).resolves.toEqual({
      artistSlots: 2,
      staffSlots: 2,
    });
  });

  it('persists explicit non-negative community defaults', async () => {
    const {t, manager, organizerId, userId} = await setupManager();

    await expect(
      manager.mutation(updateSettings, {
        organizerId,
        artistSlots: 4,
        staffSlots: 1,
      }),
    ).resolves.toEqual({artistSlots: 4, staffSlots: 1});

    await expect(manager.query(getSettings, {organizerId})).resolves.toEqual({
      artistSlots: 4,
      staffSlots: 1,
    });

    const audit = await t.run((ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .unique(),
    );
    expect(audit).toMatchObject({
      action: 'organizer.update',
      adminId: userId,
      organizerId,
    });
  });

  it('rate-limits settings through the standard community update bucket', async () => {
    const {t, manager, organizerId} = await setupManager();

    for (let index = 0; index < 10; index += 1) {
      await manager.mutation(updateSettings, {
        organizerId,
        artistSlots: index,
        staffSlots: index,
      });
    }

    await expect(
      manager.mutation(updateSettings, {
        organizerId,
        artistSlots: 99,
        staffSlots: 99,
      }),
    ).rejects.toThrow();
    await expect(manager.query(getSettings, {organizerId})).resolves.toEqual({
      artistSlots: 9,
      staffSlots: 9,
    });
    const auditCount = await t.run(async (ctx) => {
      const audits = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .collect();
      return audits.filter((audit) => audit.action === 'organizer.update')
        .length;
    });
    expect(auditCount).toBe(10);
  });

  it('rejects unauthorized settings changes before writes, audit, or rate-limit consumption', async () => {
    const {t, organizerId} = await setupManager();
    const outsiderId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Guest list outsider',
      email: 'guest-list-outsider@example.com',
    });
    const outsider = t.withIdentity({subject: outsiderId});

    await expect(
      outsider.mutation(updateSettings, {
        organizerId,
        artistSlots: 8,
        staffSlots: 8,
      }),
    ).rejects.toThrow();

    const result = await t.run(async (ctx) => ({
      organizer: await ctx.db.get('organizers', organizerId),
      audit: await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .first(),
      rate: await rateLimiter.getValue(ctx, 'updateOrganizer', {
        key: outsiderId,
      }),
    }));
    expect(result.organizer?.defaultArtistGuestSlots).toBeUndefined();
    expect(result.organizer?.defaultStaffGuestSlots).toBeUndefined();
    expect(result.audit).toBeNull();
    expect(result.rate.value).toBe(10);
  });
});
