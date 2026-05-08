import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {
  addMember,
  addTrustLink,
  authz,
  authzUserId,
  listOrganizerMembers,
  listDirectTrustedOrganizers,
  listDirectTrustingOrganizers,
  removeMember,
  removeTrustLink,
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
