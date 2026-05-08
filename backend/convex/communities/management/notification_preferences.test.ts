import {convexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../../_generated/api';
import {addMember, authz} from '../../lib/authz';

async function setupTestData() {
  const t = convexTest();
  const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Community',
  });
  const adminUserId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin User',
    email: 'admin@test.com',
  });
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, adminUserId, 'community_admin', {
      type: 'organizer',
      id: orgId,
    });
    await addMember(ctx, adminUserId, orgId);
  });
  const asAdmin = t.withIdentity({subject: adminUserId});
  return {t, adminUserId, orgId, asAdmin};
}

describe('adminNotificationPreferences.getMyNotificationPreference', () => {
  it('returns null when no preference exists', async () => {
    const {asAdmin, orgId} = await setupTestData();
    const pref = await asAdmin.query(
      api.communities.management.notification_preferences.getMyNotificationPreference,
      {organizerId: orgId},
    );
    expect(pref).toBeNull();
  });

  it('returns existing preference', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
      userId: adminUserId,
      organizerId: orgId,
      mode: 'all',
      digestHour: 9,
    });
    const pref = await asAdmin.query(
      api.communities.management.notification_preferences.getMyNotificationPreference,
      {organizerId: orgId},
    );
    expect(pref?.mode).toBe('all');
    expect(pref?.digestHour).toBe(9);
  });

  it('throws if user is not a community admin', async () => {
    const t = convexTest();
    const nonAdminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Non Admin',
      email: 'nonadmin@test.com',
    });
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Community',
    });
    const asNonAdmin = t.withIdentity({subject: nonAdminId});
    await expect(
      asNonAdmin.query(
        api.communities.management.notification_preferences.getMyNotificationPreference,
        {organizerId: orgId},
      ),
    ).rejects.toThrow();
  });
});

describe('adminNotificationPreferences.setMyNotificationPreference', () => {
  it('creates a row when setting mode=all', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'all'},
    );
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_user_and_community', (q) =>
          q.eq('userId', adminUserId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(row?.mode).toBe('all');
    expect(row?.digestHour).toBe(9); // default
  });

  it('creates a row when setting mode=digest with custom hour', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'digest', digestHour: 14},
    );
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_user_and_community', (q) =>
          q.eq('userId', adminUserId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(row?.mode).toBe('digest');
    expect(row?.digestHour).toBe(14);
  });

  it('defaults digestHour to 9 when not provided for digest mode', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'digest'},
    );
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_user_and_community', (q) =>
          q.eq('userId', adminUserId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(row?.digestHour).toBe(9);
  });

  it('deletes the row when setting mode=off', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'all'},
    );
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'off'},
    );
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_user_and_community', (q) =>
          q.eq('userId', adminUserId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(row).toBeNull();
  });

  it('is a no-op when setting mode=off with no existing row', async () => {
    const {asAdmin, orgId} = await setupTestData();
    await expect(
      asAdmin.mutation(
        api.communities.management.notification_preferences.setMyNotificationPreference,
        {organizerId: orgId, mode: 'off'},
      ),
    ).resolves.toBeNull();
  });

  it('patches existing row on re-set (no duplicate)', async () => {
    const {t, adminUserId, orgId, asAdmin} = await setupTestData();
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'all'},
    );
    await asAdmin.mutation(
      api.communities.management.notification_preferences.setMyNotificationPreference,
      {organizerId: orgId, mode: 'digest', digestHour: 18},
    );
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_user_and_community', (q) =>
          q.eq('userId', adminUserId).eq('organizerId', orgId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].mode).toBe('digest');
    expect(rows[0].digestHour).toBe(18);
  });

  it('throws on invalid digestHour (out of range)', async () => {
    const {asAdmin, orgId} = await setupTestData();
    await expect(
      asAdmin.mutation(
        api.communities.management.notification_preferences.setMyNotificationPreference,
        {organizerId: orgId, mode: 'digest', digestHour: 24},
      ),
    ).rejects.toThrow();
    await expect(
      asAdmin.mutation(
        api.communities.management.notification_preferences.setMyNotificationPreference,
        {organizerId: orgId, mode: 'digest', digestHour: -1},
      ),
    ).rejects.toThrow();
  });

  it('throws if user is not a community admin', async () => {
    const t = convexTest();
    const nonAdminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Non Admin',
      email: 'nonadmin@test.com',
    });
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Community',
    });
    const asNonAdmin = t.withIdentity({subject: nonAdminId});
    await expect(
      asNonAdmin.mutation(
        api.communities.management.notification_preferences.setMyNotificationPreference,
        {organizerId: orgId, mode: 'all'},
      ),
    ).rejects.toThrow();
  });
});
