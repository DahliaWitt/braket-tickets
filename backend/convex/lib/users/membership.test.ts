import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {convexTest} from '../../setup.testing';
import {
  addMember,
  grantCommunityAdminMembership,
  isCommunityAdmin,
  isCommunityMember,
} from '../authz';
import {removeMemberWithAdminCascade} from './membership';

let userCounter = 0;

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'users'>> {
  userCounter += 1;
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${userCounter}@test.example`,
  });
}

async function createOrganizer(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'organizers'>> {
  return t.mutation(api.testing.communities.seedOrganizer, {name});
}

describe('removeMemberWithAdminCascade', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('removes member role for a non-admin user', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const userId = await createUser(t, 'Target');
    const organizerId = await createOrganizer(t, 'Org');

    await t.run((ctx) => addMember(ctx, userId, organizerId));

    const result = await t.run((ctx) =>
      removeMemberWithAdminCascade(ctx, {userId, organizerId, actorId}),
    );

    expect(result).toEqual({adminRevoked: false});

    const hasMember = await t.run((ctx) =>
      isCommunityMember(ctx, userId, organizerId),
    );
    expect(hasMember).toBe(false);
  });

  it('revokes admin role when revoking admin member', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const targetId = await createUser(t, 'Target');
    // Grant actor admin so they can revoke others
    const organizerId = await createOrganizer(t, 'Org');

    // Grant actor community admin first (needed so there is at least one admin after target is removed)
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, actorId, organizerId, {actorId}),
    );
    // Grant target community admin
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, targetId, organizerId, {actorId}),
    );

    // Verify target has both roles
    const [hasAdmin, hasMember] = await t.run(async (ctx) => [
      await isCommunityAdmin(ctx, targetId, organizerId),
      await isCommunityMember(ctx, targetId, organizerId),
    ]);
    expect(hasAdmin).toBe(true);
    expect(hasMember).toBe(true);

    const result = await t.run((ctx) =>
      removeMemberWithAdminCascade(ctx, {
        userId: targetId,
        organizerId,
        actorId,
      }),
    );

    expect(result).toEqual({adminRevoked: true});

    const [adminAfter, memberAfter] = await t.run(async (ctx) => [
      await isCommunityAdmin(ctx, targetId, organizerId),
      await isCommunityMember(ctx, targetId, organizerId),
    ]);
    expect(adminAfter).toBe(false);
    expect(memberAfter).toBe(false);
  });

  it('blocks revocation when target is the last admin', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'OnlyAdmin');
    const organizerId = await createOrganizer(t, 'Org');

    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, userId, organizerId, {
        actorId: userId,
      }),
    );

    // convex-test re-throws ConvexError with .data serialized as a JSON string.
    // The error message itself contains the JSON payload, so matching on the
    // code string in the message is the most robust approach.
    await expect(
      t.run((ctx) =>
        removeMemberWithAdminCascade(ctx, {
          userId,
          organizerId,
          actorId: userId,
        }),
      ),
    ).rejects.toThrow('LAST_ADMIN');

    // Both roles should still be present after the failed revocation
    const [hasAdmin, hasMember] = await t.run(async (ctx) => [
      await isCommunityAdmin(ctx, userId, organizerId),
      await isCommunityMember(ctx, userId, organizerId),
    ]);
    expect(hasAdmin).toBe(true);
    expect(hasMember).toBe(true);
  });

  it('allows revocation when another admin exists', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const firstUserId = await createUser(t, 'FirstAdmin');
    const organizerId = await createOrganizer(t, 'Org');

    // Grant both users admin
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, actorId, organizerId, {actorId}),
    );
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, firstUserId, organizerId, {actorId}),
    );

    // Revoke first user — should succeed because actorId is still an admin
    const result = await t.run((ctx) =>
      removeMemberWithAdminCascade(ctx, {
        userId: firstUserId,
        organizerId,
        actorId,
      }),
    );

    expect(result).toEqual({adminRevoked: true});

    // First user lost both roles
    const [firstAdmin, firstMember] = await t.run(async (ctx) => [
      await isCommunityAdmin(ctx, firstUserId, organizerId),
      await isCommunityMember(ctx, firstUserId, organizerId),
    ]);
    expect(firstAdmin).toBe(false);
    expect(firstMember).toBe(false);

    // Actor still has both roles
    const [actorAdmin, actorMember] = await t.run(async (ctx) => [
      await isCommunityAdmin(ctx, actorId, organizerId),
      await isCommunityMember(ctx, actorId, organizerId),
    ]);
    expect(actorAdmin).toBe(true);
    expect(actorMember).toBe(true);
  });

  it('is idempotent for non-member', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const userId = await createUser(t, 'NonMember');
    const organizerId = await createOrganizer(t, 'Org');

    // userId has no member role — should not throw
    const result = await t.run((ctx) =>
      removeMemberWithAdminCascade(ctx, {userId, organizerId, actorId}),
    );

    expect(result).toEqual({adminRevoked: false});
  });

  it('deletes admin notification preferences on cascade', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const targetId = await createUser(t, 'Target');
    const organizerId = await createOrganizer(t, 'Org');

    // Grant actor admin so the cascade does not hit LAST_ADMIN
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, actorId, organizerId, {actorId}),
    );
    // Grant target admin
    await t.run((ctx) =>
      grantCommunityAdminMembership(ctx, targetId, organizerId, {actorId}),
    );

    // Insert admin notification preferences for the target user
    const prefId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup: no production mutation for admin prefs
      return ctx.db.insert('adminNotificationPreferences', {
        userId: targetId,
        organizerId,
        mode: 'all',
        digestHour: 9,
      });
    });

    // Verify the preferences row exists
    const prefBefore = await t.run(async (ctx) =>
      ctx.db.get('adminNotificationPreferences', prefId),
    );
    expect(prefBefore).not.toBeNull();

    // Cascade-remove the target
    await t.run((ctx) =>
      removeMemberWithAdminCascade(ctx, {
        userId: targetId,
        organizerId,
        actorId,
      }),
    );

    // Verify the preferences row is deleted
    const prefAfter = await t.run(async (ctx) =>
      ctx.db.get('adminNotificationPreferences', prefId),
    );
    expect(prefAfter).toBeNull();
  });
});
