import {describe, expect, it} from 'vitest';
import type {Id} from '../_generated/dataModel';
import {api} from '../_generated/api';
import {convexTest} from '../setup.testing';
import {
  AUTHZ_RELATION_QUERY_CAP,
  addMember,
  addTrustLink,
  authz,
  authzUserId,
} from '../lib/authz';
import {MAX_TRUST_LINKS} from '../lib/trust_links';

/**
 * Seed `count` member-role assignments on an organizer using synthetic user id
 * strings, so a test can reach the member cap without creating that many real
 * user documents.
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
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@test.com`,
  }) as Promise<Id<'users'>>;
}

async function createOrganizer(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'organizers'>> {
  return t.mutation(api.testing.communities.seedOrganizer, {name}) as Promise<
    Id<'organizers'>
  >;
}

async function assignCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
    await addMember(ctx, userId, organizerId);
  });
}

describe('trust_links', () => {
  it('creates, lists, and removes outgoing trust links', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const trustedOrganizerId = await createOrganizer(t, 'Trusted Org');
    const adminId = await createUser(t, 'Community Admin');
    const trustedAdminId = await createUser(t, 'Trusted Community Admin');
    await assignCommunityAdmin(t, adminId, trustingOrganizerId);
    await assignCommunityAdmin(t, trustedAdminId, trustedOrganizerId);

    const asAdmin = t.withIdentity({subject: adminId});
    const asTrustedAdmin = t.withIdentity({subject: trustedAdminId});

    await asAdmin.mutation(api.communities.trust_links.create, {
      trustingOrganizerId,
      trustedOrganizerId,
    });

    const outgoing = await asAdmin.query(api.communities.trust_links.list, {
      organizerId: trustingOrganizerId,
    });
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]).toMatchObject({
      direction: 'outgoing',
      trustingOrganizerId,
      trustedOrganizerId,
      trustingOrganizerName: 'Trusting Org',
      trustedOrganizerName: 'Trusted Org',
      trustedMemberCount: 1,
    });

    const incoming = await asTrustedAdmin.query(
      api.communities.trust_links.list,
      {
        organizerId: trustedOrganizerId,
        direction: 'incoming',
      },
    );
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      direction: 'incoming',
      trustingOrganizerId,
      trustedOrganizerId,
      trustingOrganizerName: 'Trusting Org',
      trustedOrganizerName: 'Trusted Org',
    });

    await asAdmin.mutation(api.communities.trust_links.remove, {
      trustingOrganizerId,
      trustedOrganizerId,
    });

    const outgoingAfterRemoval = await asAdmin.query(
      api.communities.trust_links.list,
      {
        organizerId: trustingOrganizerId,
      },
    );
    expect(outgoingAfterRemoval).toEqual([]);
  });

  it('returns the whole outgoing page even when a trusted organizer is at the member cap', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const bigTrustedOrganizerId = await createOrganizer(t, 'Big Trusted Org');
    const smallTrustedOrganizerId = await createOrganizer(
      t,
      'Small Trusted Org',
    );
    const adminId = await createUser(t, 'Community Admin');
    await assignCommunityAdmin(t, adminId, trustingOrganizerId);

    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrganizerId, bigTrustedOrganizerId);
      await addTrustLink(ctx, trustingOrganizerId, smallTrustedOrganizerId);
    });

    // The big org sits at the enumeration cap; the small org has a handful.
    await seedMembers(t, bigTrustedOrganizerId, AUTHZ_RELATION_QUERY_CAP);
    await seedMembers(t, smallTrustedOrganizerId, 4);

    const asAdmin = t.withIdentity({subject: adminId});
    const outgoing = await asAdmin.query(api.communities.trust_links.list, {
      organizerId: trustingOrganizerId,
    });

    // The at-cap organizer must not fail the whole page: both links come back.
    expect(outgoing).toHaveLength(2);

    const bigRow = outgoing.find(
      (row) => row.trustedOrganizerId === bigTrustedOrganizerId,
    );
    const smallRow = outgoing.find(
      (row) => row.trustedOrganizerId === smallTrustedOrganizerId,
    );

    expect(bigRow?.trustedMemberCount).toBe(AUTHZ_RELATION_QUERY_CAP);
    expect(smallRow?.trustedMemberCount).toBe(4);
  });

  it('denies trust-link creation for non-admins', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const trustedOrganizerId = await createOrganizer(t, 'Trusted Org');
    const regularUserId = await createUser(t, 'Regular User');

    const asUser = t.withIdentity({subject: regularUserId});

    await expect(
      asUser.mutation(api.communities.trust_links.create, {
        trustingOrganizerId,
        trustedOrganizerId,
      }),
    ).rejects.toThrow();
  });

  it('reports direct trust for direct members', async () => {
    const t = convexTest();
    const organizerId = await createOrganizer(t, 'Organizer');
    const userId = await createUser(t, 'Member');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, organizerId);
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.trust_links.checkUserTrust,
      {
        organizerId,
      },
    );

    expect(result).toEqual({
      trusted: true,
      source: 'direct',
      via: null,
    });
  });

  it('reports shared trust when a trusted organizer membership exists', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const trustedOrganizerId = await createOrganizer(t, 'Trusted Org');
    const adminId = await createUser(t, 'Community Admin');
    const userId = await createUser(t, 'Trusted Member');
    await assignCommunityAdmin(t, adminId, trustingOrganizerId);

    await t.run(async (ctx) => {
      await addMember(ctx, userId, trustedOrganizerId);
      await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(
      api.communities.trust_links.checkUserTrust,
      {
        organizerId: trustingOrganizerId,
      },
    );

    expect(result).toEqual({
      trusted: true,
      source: 'shared',
      via: {
        _id: trustedOrganizerId,
        name: 'Trusted Org',
      },
    });
  });

  it('returns direct and shared approvals for the current user', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const trustedOrganizerId = await createOrganizer(t, 'Trusted Org');
    const userId = await createUser(t, 'Trusted Member');

    await t.run(async (ctx) => {
      await addMember(ctx, userId, trustedOrganizerId);
      await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
    });

    const asUser = t.withIdentity({subject: userId});
    const approvals = await asUser.query(
      api.communities.trust_links.getUserApprovals,
      {},
    );

    expect(approvals).toEqual([
      {
        organizerId: trustedOrganizerId,
        organizerName: 'Trusted Org',
        source: 'direct',
      },
      {
        organizerId: trustingOrganizerId,
        organizerName: 'Trusting Org',
        source: 'shared',
        viaOrganizerId: trustedOrganizerId,
        viaOrganizerName: 'Trusted Org',
      },
    ]);
  });

  it('returns organizerLogoUrl when an organizer has a logo', async () => {
    const t = convexTest();
    const organizerId = await createOrganizer(t, 'Logo Org');
    const userId = await createUser(t, 'Member');

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seeding logoStorageId to test URL resolution; no production mutation accepts unconfirmed uploads
    await t.run(async (ctx) => {
      const id = await ctx.storage.store(
        new Blob(['fake-logo'], {type: 'image/png'}),
      );
      await ctx.db.patch('organizers', organizerId, {logoStorageId: id});
      await addMember(ctx, userId, organizerId);
    });

    const asUser = t.withIdentity({subject: userId});
    const approvals = await asUser.query(
      api.communities.trust_links.getUserApprovals,
      {},
    );

    expect(approvals).toHaveLength(1);
    expect(approvals[0].organizerLogoUrl).toEqual(
      expect.stringContaining('http'),
    );
    expect(approvals[0]).toMatchObject({
      organizerId,
      organizerName: 'Logo Org',
      source: 'direct',
    });

    // Verify organizer without logo has no logoUrl
    const noLogoOrgId = await createOrganizer(t, 'No Logo Org');
    await t.run(async (ctx) => {
      await addMember(ctx, userId, noLogoOrgId);
    });

    const allApprovals = await asUser.query(
      api.communities.trust_links.getUserApprovals,
      {},
    );
    const noLogoApproval = allApprovals.find(
      (a) => a.organizerId === noLogoOrgId,
    );
    expect(noLogoApproval?.organizerLogoUrl).toBeUndefined();
  });
  it('rejects creating a trust link beyond the configured cap', async () => {
    const t = convexTest();
    const trustingOrganizerId = await createOrganizer(t, 'Trusting Org');
    const adminId = await createUser(t, 'Community Admin');
    await assignCommunityAdmin(t, adminId, trustingOrganizerId);

    const asAdmin = t.withIdentity({subject: adminId});
    const trustedOrganizerIds = await Promise.all(
      Array.from({length: MAX_TRUST_LINKS + 1}, (_, index) =>
        createOrganizer(t, `Trusted Org ${index}`),
      ),
    );

    for (const trustedOrganizerId of trustedOrganizerIds.slice(
      0,
      MAX_TRUST_LINKS,
    )) {
      await asAdmin.mutation(api.communities.trust_links.create, {
        trustingOrganizerId,
        trustedOrganizerId,
      });
    }

    await expect(
      asAdmin.mutation(api.communities.trust_links.create, {
        trustingOrganizerId,
        trustedOrganizerId: trustedOrganizerIds[MAX_TRUST_LINKS]!,
      }),
    ).rejects.toThrow(
      `Too many active trust links (${MAX_TRUST_LINKS + 1}). Max supported: ${MAX_TRUST_LINKS}.`,
    );
  });
});
