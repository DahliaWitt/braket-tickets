import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {
  addMember,
  authz,
  authzUserId,
  grantCommunityAdminMembership,
  grantCommunityScannerRole,
  organizerScope,
  revokeCommunityAdminRole,
  revokeCommunityScannerRole,
} from './authz';

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

describe('convex/lib/authz community role composites', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  describe('grantCommunityAdminMembership', () => {
    it('adds both when neither role nor member edge exists', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      const result = await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: true, memberAdded: true});

      const [hasAdmin, hasMember] = await t.run(async (ctx) => [
        await authz.hasRole(
          ctx,
          authzUserId(userId),
          'community_admin',
          organizerScope(organizerId),
        ),
        await authz.hasRole(
          ctx,
          authzUserId(userId),
          'member',
          organizerScope(organizerId),
        ),
      ]);
      expect(hasAdmin).toBe(true);
      expect(hasMember).toBe(true);
    });

    it('adds only the role when member already exists', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) => addMember(ctx, userId, organizerId));

      const result = await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: true, memberAdded: false});
    });

    it('adds only the member edge when role already exists', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) =>
        authz.assignRole(
          ctx,
          authzUserId(userId),
          'community_admin',
          organizerScope(organizerId),
        ),
      );

      const result = await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: false, memberAdded: true});
    });

    it('is a no-op when both role and member exist', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run(async (ctx) => {
        await authz.assignRole(
          ctx,
          authzUserId(userId),
          'community_admin',
          organizerScope(organizerId),
        );
        await addMember(ctx, userId, organizerId);
      });

      const result = await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: false, memberAdded: false});
    });
  });

  describe('revokeCommunityAdminRole', () => {
    it('removes the role when present and returns true', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );

      const result = await t.run((ctx) =>
        revokeCommunityAdminRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleRemoved: true});

      const hasAdmin = await t.run((ctx) =>
        authz.hasRole(
          ctx,
          authzUserId(userId),
          'community_admin',
          organizerScope(organizerId),
        ),
      );
      expect(hasAdmin).toBe(false);
    });

    it('returns false when the role is absent', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      const result = await t.run((ctx) =>
        revokeCommunityAdminRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleRemoved: false});
    });

    it('leaves the member edge intact after role revoke', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) =>
        grantCommunityAdminMembership(ctx, userId, organizerId, {actorId}),
      );
      await t.run((ctx) =>
        revokeCommunityAdminRole(ctx, userId, organizerId, {actorId}),
      );

      const hasMember = await t.run((ctx) =>
        authz.hasRole(
          ctx,
          authzUserId(userId),
          'member',
          organizerScope(organizerId),
        ),
      );
      expect(hasMember).toBe(true);
    });
  });

  describe('grantCommunityScannerRole', () => {
    it('adds the scanner role when absent', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      const result = await t.run((ctx) =>
        grantCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: true});

      const hasScanner = await t.run((ctx) =>
        authz.hasRole(
          ctx,
          authzUserId(userId),
          'community_scanner',
          organizerScope(organizerId),
        ),
      );
      expect(hasScanner).toBe(true);
    });

    it('is idempotent when the scanner role already exists', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) =>
        grantCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      const result = await t.run((ctx) =>
        grantCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleAdded: false});
    });
  });

  describe('revokeCommunityScannerRole', () => {
    it('removes the scanner role when present', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      await t.run((ctx) =>
        grantCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      const result = await t.run((ctx) =>
        revokeCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleRemoved: true});

      const hasScanner = await t.run((ctx) =>
        authz.hasRole(
          ctx,
          authzUserId(userId),
          'community_scanner',
          organizerScope(organizerId),
        ),
      );
      expect(hasScanner).toBe(false);
    });

    it('returns false when the scanner role is absent', async () => {
      const t = convexTest();
      const actorId = await createUser(t, 'Actor');
      const userId = await createUser(t, 'Target');
      const organizerId = await createOrganizer(t, 'Org');

      const result = await t.run((ctx) =>
        revokeCommunityScannerRole(ctx, userId, organizerId, {actorId}),
      );
      expect(result).toEqual({roleRemoved: false});
    });
  });
});
