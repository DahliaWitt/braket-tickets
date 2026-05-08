import {describe, expect, it} from 'vitest';
import type {Id} from '../_generated/dataModel';
import {api} from '../_generated/api';
import {convexTest} from '../setup.testing';
import {addMember, addTrustLink, authz, authzUserId} from '../lib/authz';
import {MAX_TRUST_LINKS} from '../lib/trust_links';

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
