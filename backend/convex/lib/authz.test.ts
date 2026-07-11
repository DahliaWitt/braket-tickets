import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {
  AUTHZ_RELATION_QUERY_CAP,
  addMember,
  addTrustLink,
  authz,
  authzUserId,
  countOrganizerMembers,
  listOrganizerMembers,
  listDirectTrustedOrganizers,
  listDirectTrustingOrganizers,
  removeMember,
  removeTrustLink,
} from './authz';

let userCounter = 0;

/**
 * Seed `count` member-role assignments on an organizer using synthetic user id
 * strings. Avoids creating `count` real user documents when a test only needs to
 * exercise the member-cap threshold.
 */
async function seedMembers(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
  count: number,
): Promise<void> {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await authz.assignRole(
        ctx,
        `cap-user-${organizerId}-${index}`,
        'member',
        {type: 'organizer', id: organizerId as string},
      );
    }
  });
}

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

describe('convex/lib/authz', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('adds and checks organizer membership via member role', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const organizerId = await createOrganizer(t, 'Organizer');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, organizerId);
    });

    const hasMemberRole = await t.run(async (ctx) =>
      authz.hasRole(ctx, authzUserId(userId), 'member', {
        type: 'organizer',
        id: organizerId as string,
      }),
    );
    expect(hasMemberRole).toBe(true);
  });

  it('removes organizer membership via member role', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const organizerId = await createOrganizer(t, 'Organizer');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, organizerId);
      await removeMember(ctx, userId, organizerId);
    });

    const hasMemberRole = await t.run(async (ctx) =>
      authz.hasRole(ctx, authzUserId(userId), 'member', {
        type: 'organizer',
        id: organizerId as string,
      }),
    );
    expect(hasMemberRole).toBe(false);
  });

  it('adds and removes trust links', async () => {
    const t = convexTest();
    const trustingOrgId = await createOrganizer(t, 'Trusting');
    const trustedOrgId = await createOrganizer(t, 'Trusted');

    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrgId, trustedOrgId);
    });

    const trustedOrganizers = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, trustingOrgId),
    );
    expect(trustedOrganizers.map((relation) => relation.objectId)).toEqual([
      trustedOrgId,
    ]);

    await t.run(async (ctx) => {
      await removeTrustLink(ctx, trustingOrgId, trustedOrgId);
    });

    const trustedOrganizersAfterRemoval = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, trustingOrgId),
    );
    expect(trustedOrganizersAfterRemoval).toEqual([]);
  });

  it('lists trusting organizers for a trusted organizer', async () => {
    const t = convexTest();
    const trustingOrgA = await createOrganizer(t, 'Trusting A');
    const trustingOrgB = await createOrganizer(t, 'Trusting B');
    const trustedOrgId = await createOrganizer(t, 'Trusted');

    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrgA, trustedOrgId);
      await addTrustLink(ctx, trustingOrgB, trustedOrgId);
    });

    const trustingOrganizers = await t.run(async (ctx) =>
      listDirectTrustingOrganizers(ctx, trustedOrgId),
    );

    expect(
      new Set(trustingOrganizers.map((relation) => relation.subjectId)),
    ).toEqual(new Set([trustingOrgA, trustingOrgB]));
  });

  it('lists organizer members as user ID strings', async () => {
    const t = convexTest();
    const firstUserId = await createUser(t, 'First');
    const secondUserId = await createUser(t, 'Second');
    const organizerId = await createOrganizer(t, 'Organizer');

    await t.run(async (ctx) => {
      await addMember(ctx, firstUserId, organizerId);
      await addMember(ctx, secondUserId, organizerId);
    });

    const memberIds = await t.run(async (ctx) =>
      listOrganizerMembers(ctx, organizerId),
    );
    expect(new Set(memberIds)).toEqual(
      new Set([firstUserId as string, secondUserId as string]),
    );
  });

  it('counts organizer members exactly below the cap', async () => {
    const t = convexTest();
    const organizerId = await createOrganizer(t, 'Small Org');
    await seedMembers(t, organizerId, 3);

    const count = await t.run(async (ctx) =>
      countOrganizerMembers(ctx, organizerId),
    );
    expect(count).toBe(3);
  });

  it('clamps the member count to the cap without throwing when at the cap', async () => {
    const t = convexTest();
    const organizerId = await createOrganizer(t, 'Large Org');
    await seedMembers(t, organizerId, AUTHZ_RELATION_QUERY_CAP);

    // listOrganizerMembers refuses to enumerate an at-cap organizer...
    await expect(
      t.run(async (ctx) => listOrganizerMembers(ctx, organizerId)),
    ).rejects.toThrow(/results are truncated/);

    // ...but countOrganizerMembers returns a clamped count instead of throwing.
    const count = await t.run(async (ctx) =>
      countOrganizerMembers(ctx, organizerId),
    );
    expect(count).toBe(AUTHZ_RELATION_QUERY_CAP);
  });

  it('keeps membership idempotent across repeated addMember calls', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const organizerId = await createOrganizer(t, 'Organizer');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, organizerId);
      await addMember(ctx, userId, organizerId);
    });

    const memberIds = await t.run(async (ctx) =>
      listOrganizerMembers(ctx, organizerId),
    );

    expect(memberIds.filter((id) => id === authzUserId(userId))).toHaveLength(
      1,
    );
  });

  it('records actor attribution for membership role writes', async () => {
    const t = convexTest();
    const actorId = await createUser(t, 'Actor');
    const userId = await createUser(t, 'Member');
    const organizerId = await createOrganizer(t, 'Organizer');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, organizerId, {actorId});
      await removeMember(ctx, userId, organizerId, {actorId});
    });

    const auditLog = await t.run(async (ctx) =>
      authz.getAuditLog(ctx, {
        userId: authzUserId(userId),
      }),
    );
    const auditEntries = Array.isArray(auditLog) ? auditLog : auditLog.page;

    const assignedEntries = auditEntries.filter(
      (entry) => entry.action === 'role_assigned',
    );
    const revokedEntries = auditEntries.filter(
      (entry) => entry.action === 'role_revoked',
    );

    expect(assignedEntries).toHaveLength(1);
    expect(assignedEntries[0].actorId).toBe(actorId);
    expect(assignedEntries[0].details).toMatchObject({
      role: 'member',
      scope: {type: 'organizer', id: organizerId as string},
    });

    expect(revokedEntries).toHaveLength(1);
    expect(revokedEntries[0].actorId).toBe(actorId);
    expect(revokedEntries[0].details).toMatchObject({
      role: 'member',
      scope: {type: 'organizer', id: organizerId as string},
    });
  });
});
