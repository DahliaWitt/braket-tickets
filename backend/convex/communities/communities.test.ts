import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {
  addMember,
  addTrustLink,
  authz,
  listDirectTrustedOrganizers,
} from '../lib/authz';
import {MAX_COMMUNITY_DESCRIPTION_LENGTH} from '../lib/validation';

type OrganizerInsert = Omit<
  Doc<'organizers'>,
  '_id' | '_creationTime' | 'isPublicDirectory'
> &
  Partial<Pick<Doc<'organizers'>, 'isPublicDirectory'>>;

async function createRootAdmin(
  ctx: MutationCtx,
  name = 'Admin',
  email?: string,
): Promise<Id<'users'>> {
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
  const userId = await ctx.db.insert('users', {
    name,
    ...(email ? {email} : {}),
  });
  await authz.assignRole(ctx, userId, 'root_admin');
  return userId;
}

async function assignCommunityAdmin(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await authz.assignRole(ctx, userId, 'community_admin', {
    type: 'organizer',
    id: organizerId,
  });
  await addMember(ctx, userId, organizerId);
}

async function seedTrustLink(
  ctx: MutationCtx,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
): Promise<void> {
  await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
}

async function insertOrganizer(
  ctx: MutationCtx,
  organizer: OrganizerInsert,
): Promise<Id<'organizers'>> {
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- helper preserves historical test fixture semantics while supplying the required schema field
  return await ctx.db.insert('organizers', {
    isPublicDirectory: false,
    ...organizer,
  });
}

describe('Communities', () => {
  it('admin can create an organizer', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'Test Community',
      email: 'test@example.com',
      contactInfo: 'Contact info here',
    });

    expect(organizerId).toBeDefined();

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).toBeDefined();
    expect(organizer?.name).toBe('Test Community');
    expect(organizer?.email).toBe('test@example.com');
    expect(organizer?.contactInfo).toBe('Contact info here');
    expect(organizer?.status).toBe('draft');
  });

  it('admin can create a community with description and directory visibility', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'Visible Community',
      description: 'A public community for testing',
      isPublicDirectory: true,
    });

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer?.description).toBe('A public community for testing');
    expect(organizer?.isPublicDirectory).toBe(true);
    expect(organizer?.status).toBe('draft');
  });

  it('rejects creating a published community without vetting questions', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const admin = t.withIdentity({subject: adminId});
    await expect(
      admin.mutation(api.communities.profile.create, {
        name: 'Published Community',
        status: 'published',
        vettingQuestions: [],
      }),
    ).rejects.toThrow(
      'Published communities must have at least one vetting question',
    );
  });

  it('creates a draft community when status is omitted', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'Implicit Draft',
      vettingQuestions: [
        {id: 'q1', question: 'Why join?', type: 'text', required: true},
      ],
    });

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer?.status).toBe('draft');
  });

  it('create rejects description exceeding max length', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const admin = t.withIdentity({subject: adminId});
    // MAX_COMMUNITY_DESCRIPTION_LENGTH is 2000
    await expect(
      admin.mutation(api.communities.profile.create, {
        name: 'Test',
        description: 'x'.repeat(MAX_COMMUNITY_DESCRIPTION_LENGTH + 1),
      }),
    ).rejects.toThrow();
  });

  it('non-admin cannot create an organizer', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {name: 'User'});
    });

    const user = t.withIdentity({subject: userId});
    await expect(
      user.mutation(api.communities.profile.create, {
        name: 'Test Community',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('admin can list all organizers', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    // Create organizers directly
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      await insertOrganizer(ctx, {name: 'Community 1'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      await insertOrganizer(ctx, {
        name: 'Community 2',
        email: 'org2@example.com',
      });
    });

    const admin = t.withIdentity({subject: adminId});
    const organizers = await admin.query(api.communities.list.list, {});

    expect(organizers.length).toBeGreaterThanOrEqual(2);
    expect(
      organizers.some((o: Doc<'organizers'>) => o.name === 'Community 1'),
    ).toBe(true);
    expect(
      organizers.some((o: Doc<'organizers'>) => o.name === 'Community 2'),
    ).toBe(true);
  });

  it('authenticated user can read organizers', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {name: 'User'});
    });

    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {
        name: 'Public Community',
        status: 'published',
        isPublicDirectory: true,
      });
    });

    const user = t.withIdentity({subject: userId});
    const organizer = await user.query(api.communities.public.get, {
      id: organizerId,
    });

    expect(organizer).toBeDefined();
    expect(organizer?.name).toBe('Public Community');
  });

  it('authenticated non-admin cannot read published organizers outside the public directory', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User'}),
    );

    const organizerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {
        name: 'Private Published Community',
        status: 'published',
        isPublicDirectory: false,
      }),
    );

    const user = t.withIdentity({subject: userId});
    const organizer = await user.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).toBeNull();
  });

  it('authenticated non-admin list includes public-directory organizers and excludes draft organizers', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User'}),
    );

    await t.run(async (ctx) =>
      Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'Published Community',
          status: 'published',
          isPublicDirectory: true,
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'Private Published Community',
          status: 'published',
          isPublicDirectory: false,
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Draft Community', status: 'draft'}),
      ]),
    );

    const user = t.withIdentity({subject: userId});
    const organizers = await user.query(api.communities.list.list, {});
    expect(
      organizers.some((organizer) => organizer.name === 'Published Community'),
    ).toBe(true);
    expect(
      organizers.some(
        (organizer) => organizer.name === 'Private Published Community',
      ),
    ).toBe(false);
    expect(
      organizers.some((organizer) => organizer.name === 'Draft Community'),
    ).toBe(false);
  });

  it('BRA-399: list includes published non-public community when user has pending application', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant User',
      email: `bra399-pending-${Date.now()}@test.com`,
    })) as Id<'users'>;

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup
      insertOrganizer(ctx, {
        name: 'Private Published Org BRA399',
        status: 'published',
        isPublicDirectory: false,
      }),
    );

    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'pending',
      organizerId: orgId,
      answers: {},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.communities.list.list, {});
    expect(result.some((o) => o.name === 'Private Published Org BRA399')).toBe(
      true,
    );
  });

  it('BRA-399: list excludes community when user only has revoked application', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Revoked User',
      email: `bra399-revoked-${Date.now()}@test.com`,
    })) as Id<'users'>;

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup
      insertOrganizer(ctx, {
        name: 'Revoked Only Org BRA399',
        status: 'published',
        isPublicDirectory: false,
      }),
    );

    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'revoked',
      organizerId: orgId,
      answers: {},
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.communities.list.list, {});
    expect(result.some((o) => o.name === 'Revoked Only Org BRA399')).toBe(
      false,
    );
  });

  it('authenticated non-admin cannot read organizers with explicit draft status', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User'}),
    );

    const organizerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Draft Community', status: 'draft'}),
    );

    const user = t.withIdentity({subject: userId});
    const organizer = await user.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).toBeNull();
  });

  it('community admin can read organizers with explicit draft status', async () => {
    const t = convexTest();
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'Community Admin'}),
    );
    const organizerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Draft Community', status: 'draft'}),
    );

    await t.run(async (ctx) => {
      await assignCommunityAdmin(ctx, userId, organizerId);
    });

    const asCommunityAdmin = t.withIdentity({subject: userId});
    const organizer = await asCommunityAdmin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).not.toBeNull();
    expect(organizer?.name).toBe('Draft Community');
  });

  it('admin can update an organizer', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {name: 'Old Name'});
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      name: 'New Name',
      email: 'new@example.com',
    });

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer?.name).toBe('New Name');
    expect(organizer?.email).toBe('new@example.com');
  });

  it('admin can delete organizer without associated events', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {name: 'To Delete'});
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.remove, {id: organizerId});

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).toBeNull();
  });

  it('cascade deletes trust links where organizer is trusting', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const {orgA, orgB} = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const a = await insertOrganizer(ctx, {name: 'Org A'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const b = await insertOrganizer(ctx, {name: 'Org B'});
      await seedTrustLink(ctx, a, b);
      return {orgA: a, orgB: b};
    });

    const trustLinksBefore = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, orgA),
    );
    expect(trustLinksBefore.map((relation) => relation.objectId)).toEqual([
      orgB,
    ]);

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.remove, {id: orgA});

    // Trust link should be deleted
    const trustLinksAfter = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, orgA),
    );
    expect(trustLinksAfter).toHaveLength(0);

    // Org B should still exist
    const orgBDoc = await admin.query(api.communities.public.get, {id: orgB});
    expect(orgBDoc).not.toBeNull();
  });

  it('cascade deletes trust links where organizer is trusted', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const {orgA, orgB} = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const a = await insertOrganizer(ctx, {name: 'Org A'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const b = await insertOrganizer(ctx, {name: 'Org B'});
      await seedTrustLink(ctx, a, b);
      return {orgA: a, orgB: b};
    });

    const trustLinksBefore = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, orgA),
    );
    expect(trustLinksBefore.map((relation) => relation.objectId)).toEqual([
      orgB,
    ]);

    const admin = t.withIdentity({subject: adminId});
    // Delete org B (the trusted one) — link should still be cascade deleted
    await admin.mutation(api.communities.profile.remove, {id: orgB});

    const trustLinksAfter = await t.run(async (ctx) =>
      listDirectTrustedOrganizers(ctx, orgA),
    );
    expect(trustLinksAfter).toHaveLength(0);

    // Org A should still exist
    const orgADoc = await admin.query(api.communities.public.get, {id: orgA});
    expect(orgADoc).not.toBeNull();
  });

  it('creates audit log entries for cascade-deleted trust links', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const {orgA, orgB} = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const a = await insertOrganizer(ctx, {name: 'Org A'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const b = await insertOrganizer(ctx, {name: 'Org B'});
      await seedTrustLink(ctx, a, b);
      return {orgA: a, orgB: b};
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.remove, {id: orgA});

    // Check audit log
    const auditLogs = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .filter((q) => q.eq(q.field('action'), 'trust_link_cascade_deleted'))
        .collect();
    });

    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].organizerId).toBe(orgA);
    expect(auditLogs[0].adminId).toBe(adminId);
    expect(auditLogs[0].trustingOrganizerId).toBe(orgA);
    expect(auditLogs[0].trustedOrganizerId).toBe(orgB);
  });

  it('deletes organizer without trust links normally', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {name: 'No Links Org'});
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.remove, {id: organizerId});

    const organizer = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(organizer).toBeNull();
  });

  it('prevents deleting organizer with associated events', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });

    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const orgId = await insertOrganizer(ctx, {name: 'Community'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
      await ctx.db.insert('events', {
        title: 'Event',
        date: '2024-01-01',
        price: 100,
        totalTickets: 10,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      return orgId;
    });

    const admin = t.withIdentity({subject: adminId});
    await expect(
      admin.mutation(api.communities.profile.remove, {id: organizerId}),
    ).rejects.toThrow('Cannot delete community with associated events');
  });

  describe('update — extended behaviors', () => {
    // Helper: create root admin, an organizer, and a regular user
    async function setupUpdateData() {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin', 'root@test.com'),
      );
      const orgId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Test Org', email: 'org@test.com'}),
      );
      const regularUserId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Regular User',
          email: 'user@test.com',
        }),
      );
      return {t, rootAdminId, orgId, regularUserId};
    }

    it('community admin can update their own organizer', async () => {
      const {t, orgId, regularUserId} = await setupUpdateData();
      await t.run(async (ctx) => {
        await assignCommunityAdmin(ctx, regularUserId, orgId);
      });

      // Update as community admin
      const asCommAdmin = t.withIdentity({subject: regularUserId});
      await asCommAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: 'Updated Org Name',
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(organizer?.name).toBe('Updated Org Name');
    });

    it('community admin updating another organizer gets NOT_FOUND', async () => {
      const {t, orgId, regularUserId} = await setupUpdateData();

      // Create Org B
      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      // Grant community admin for Org A only
      await t.run(async (ctx) => {
        await assignCommunityAdmin(ctx, regularUserId, orgId);
      });

      // Try to update Org B as Org A's admin — should get NOT_FOUND, not FORBIDDEN
      const asCommAdmin = t.withIdentity({subject: regularUserId});
      await expect(
        asCommAdmin.mutation(api.communities.profile.update, {
          id: orgB,
          name: 'Hijacked Name',
        }),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('root admin can update any organizer', async () => {
      const {t, rootAdminId, orgId} = await setupUpdateData();
      const asRootAdmin = t.withIdentity({subject: rootAdminId});

      await asRootAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: 'Root Updated Name',
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(organizer?.name).toBe('Root Updated Name');
    });

    it('partial update with name omitted — only email updates, name stays unchanged', async () => {
      const {t, rootAdminId, orgId} = await setupUpdateData();
      const asRootAdmin = t.withIdentity({subject: rootAdminId});

      await asRootAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        email: 'new@email.com',
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(organizer?.name).toBe('Test Org');
      expect(organizer?.email).toBe('new@email.com');
    });

    it('non-existent organizer ID throws NOT_FOUND', async () => {
      const {t, rootAdminId, orgId} = await setupUpdateData();
      const asRootAdmin = t.withIdentity({subject: rootAdminId});

      // Delete the organizer so the ID becomes stale
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- cleanup of test data; no production delete mutation for this entity
      await t.run(async (ctx) => ctx.db.delete(orgId));

      await expect(
        asRootAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          name: 'Should Fail',
        }),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('inserts audit log with action organizer.update after successful update', async () => {
      const {t, rootAdminId, orgId} = await setupUpdateData();
      const asRootAdmin = t.withIdentity({subject: rootAdminId});

      await asRootAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: 'Audited Update',
      });

      const logs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('organizer.update');
      expect(logs[0].adminId).toBe(rootAdminId);
      expect(logs[0].organizerId).toBe(orgId);
    });
  });

  describe('setPlatformOrganizer', () => {
    it('root admin can set isPlatformOrganizer to true', async () => {
      const t = convexTest();
      const adminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin'),
      );
      const organizerId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Platform Org'}),
      );

      const asAdmin = t.withIdentity({subject: adminId});
      await asAdmin.mutation(api.communities.profile.setPlatformOrganizer, {
        organizerId,
        isPlatformOrganizer: true,
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      expect(organizer?.isPlatformOrganizer).toBe(true);
    });

    it('root admin can set isPlatformOrganizer to false', async () => {
      const t = convexTest();
      const adminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin'),
      );
      const organizerId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'Platform Org',
          isPlatformOrganizer: true,
        }),
      );

      const asAdmin = t.withIdentity({subject: adminId});
      await asAdmin.mutation(api.communities.profile.setPlatformOrganizer, {
        organizerId,
        isPlatformOrganizer: false,
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(organizerId));
      expect(organizer?.isPlatformOrganizer).toBe(false);
    });

    it('non-admin cannot set isPlatformOrganizer', async () => {
      const t = convexTest();
      const userId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Regular User'}),
      );
      const organizerId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Some Org'}),
      );

      const asUser = t.withIdentity({subject: userId});
      await expect(
        asUser.mutation(api.communities.profile.setPlatformOrganizer, {
          organizerId,
          isPlatformOrganizer: true,
        }),
      ).rejects.toThrow('Unauthorized');
    });

    it('creates audit log entry when setting isPlatformOrganizer', async () => {
      const t = convexTest();
      const adminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin'),
      );
      const organizerId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Platform Org'}),
      );

      const asAdmin = t.withIdentity({subject: adminId});
      await asAdmin.mutation(api.communities.profile.setPlatformOrganizer, {
        organizerId,
        isPlatformOrganizer: true,
      });

      const logs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('organizer.setPlatformOrganizer:true');
      expect(logs[0].adminId).toBe(adminId);
      expect(logs[0].organizerId).toBe(organizerId);
    });
  });

  describe('listPublicDirectory', () => {
    it('returns opted-in communities, including ones with public events', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Public Org',
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Private Org',
          isPublicDirectory: false,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const unlistedId = await insertOrganizer(ctx, {
          name: 'Unlisted Org',
          isPublicDirectory: true,
        });
        // Unlisted Org has a public published event → should appear
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Public Event',
          date: '2030-06-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId: unlistedId,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );

      expect(results.some((r) => r.name === 'Public Org')).toBe(true);
      expect(results.some((r) => r.name === 'Unlisted Org')).toBe(true);
      expect(results.some((r) => r.name === 'Private Org')).toBe(false);
    });

    it('does not return email, contactInfo, vettingQuestions, or stripe data', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Sensitive Org',
          isPublicDirectory: true,
          email: 'secret@example.com',
          contactInfo: 'sensitive contact',
          stripeConnectedAccountId: 'acct_secret',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeCurrentlyDue: [],
          vettingQuestions: [
            {
              id: 'q1',
              question: 'What is your role?',
              type: 'text',
              required: true,
            },
          ],
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(results).toHaveLength(1);

      const result = results[0] as Record<string, unknown>;
      expect(result['email']).toBeUndefined();
      expect(result['contactInfo']).toBeUndefined();
      expect(result['vettingQuestions']).toBeUndefined();
      expect(result['stripeConnectedAccountId']).toBeUndefined();
      expect(result['stripeOnboardingStatus']).toBeUndefined();
      expect(result['stripeChargesEnabled']).toBeUndefined();
      expect(result['stripePayoutsEnabled']).toBeUndefined();
      expect(result['stripeCurrentlyDue']).toBeUndefined();

      // Safe fields should be present
      expect(result['_id']).toBeDefined();
      expect(result['name']).toBe('Sensitive Org');
      expect(result['status']).toBe('published');
    });

    it('is callable without authentication', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Anon Visible',
          isPublicDirectory: true,
        });
      });

      // t.query (no withIdentity) calls query as unauthenticated
      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(results.some((r) => r.name === 'Anon Visible')).toBe(true);
      // Legacy-undefined status resolves to 'published' — see
      // `migrations/community_status_backfill.ts` and
      // `lib/community_status.ts#derivePublicationStatus`. Anything shown in
      // the public directory must not simultaneously report `draft`, or the
      // earlier drift re-emerges.
      expect(results.find((r) => r.name === 'Anon Visible')?.status).toBe(
        'published',
      );
    });

    it('returns empty array when no communities are public', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Private Only',
          isPublicDirectory: false,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      // convexTest() uses a fresh in-memory DB per test — assert length 0, not
      // a vacuous every() which passes trivially on an empty array.
      expect(results).toHaveLength(0);
    });

    it('returns community with public event when it is opted into the directory', async () => {
      const t = convexTest();

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const orgId = await insertOrganizer(ctx, {
          name: 'Event-Only Org',
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Public Discoverable Event',
          date: '2030-07-01T20:00:00.000Z',
          price: 1000,
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          organizerId: orgId,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Event-Only Org');
      // Legacy-undefined status → 'published'. See `community_status.ts`.
      expect(results[0].status).toBe('published');
    });

    it('derives published status for legacy communities with missing status field', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Legacy Published',
          isPublicDirectory: true,
          vettingQuestions: [
            {id: 'q1', question: 'Why join?', type: 'text', required: true},
          ],
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(results.find((r) => r.name === 'Legacy Published')?.status).toBe(
        'published',
      );
    });

    it('excludes community with only private or draft events', async () => {
      const t = convexTest();

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const orgId = await insertOrganizer(ctx, {
          name: 'Hidden Events Org',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Private Event',
          date: '2030-07-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'private',
          organizerId: orgId,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Draft Event',
          date: '2030-08-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'draft',
          visibility: 'public',
          organizerId: orgId,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );

      expect(results.some((r) => r.name === 'Hidden Events Org')).toBe(false);
    });

    it('excludes communities explicitly marked draft', async () => {
      const t = convexTest();

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const orgId = await insertOrganizer(ctx, {
          name: 'Draft Directory Org',
          isPublicDirectory: true,
          status: 'draft',
        });

        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Draft Org Public Event',
          date: '2030-07-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId: orgId,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(results.some((r) => r.name === 'Draft Directory Org')).toBe(false);
    });

    it('excludes community with isPublicDirectory: false even when they have public events', async () => {
      const t = convexTest();

      await t.run(async (ctx) => {
        // Community explicitly opted out of public directory
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const privateOrgId = await insertOrganizer(ctx, {
          name: 'Opted Out Org',
          isPublicDirectory: false,
          status: 'published',
        });
        // Has a public event, but should NOT appear
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Public Event from Private Org',
          date: '2030-07-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId: privateOrgId,
        });

        // Community opted in
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const publicOrgId = await insertOrganizer(ctx, {
          name: 'Public Org',
          isPublicDirectory: true,
          status: 'published',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Public Event',
          date: '2030-08-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId: publicOrgId,
        });
      });

      const results = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );

      expect(results.some((r) => r.name === 'Opted Out Org')).toBe(false);
      expect(results.some((r) => r.name === 'Public Org')).toBe(true);
    });
  });

  describe('listEventsDirectory', () => {
    it('includes draft communities with published events for root admins', async () => {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin'),
      );

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally creating a legacy draft organizer with a published event to reproduce admin directory visibility
        const organizerId = await insertOrganizer(ctx, {
          name: 'Draft Admin Community',
          status: 'draft',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally inserting a published event to verify root-admin directory visibility for legacy draft communities
        await ctx.db.insert('events', {
          title: 'Draft Community Public Event',
          date: '2030-09-01T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
      });

      const asAdmin = t.withIdentity({subject: rootAdminId});
      const results = await asAdmin.query(
        api.communities.directory.listEventsDirectory,
        {},
      );

      expect(
        results.some((community) => community.name === 'Draft Admin Community'),
      ).toBe(true);
    });

    it('excludes admin-only communities that do not have published events', async () => {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin'),
      );

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally creating draft organizer without published events to verify events-picker gating
        await insertOrganizer(ctx, {
          name: 'Draft Empty Community',
          status: 'draft',
        });
      });

      const asAdmin = t.withIdentity({subject: rootAdminId});
      const results = await asAdmin.query(
        api.communities.directory.listEventsDirectory,
        {},
      );

      expect(
        results.some((community) => community.name === 'Draft Empty Community'),
      ).toBe(false);
    });

    it('does not broaden managed community admins to draft communities', async () => {
      const t = convexTest();
      const communityAdminId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'community-admin@example.com',
          name: 'Community Admin',
        },
      );
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Granting Admin'),
      );
      const organizerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is intentionally invalid; seedEvent rejects this combination and the regression needs this exact state
        const organizerId = await insertOrganizer(ctx, {
          name: 'Managed Draft Community',
          status: 'draft',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org is intentionally invalid; mirrors existing backend access-control regression coverage
        await ctx.db.insert('events', {
          title: 'Managed Draft Event',
          date: '2030-09-15T20:00:00.000Z',
          price: 500,
          totalTickets: 50,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
        return organizerId;
      });
      await t.mutation(api.testing.communities.seedCommunityAdmin, {
        userId: communityAdminId,
        organizerId,
        grantedBy: rootAdminId,
      });

      const asCommunityAdmin = t.withIdentity({subject: communityAdminId});
      const results = await asCommunityAdmin.query(
        api.communities.directory.listEventsDirectory,
        {},
      );

      expect(results.some((community) => community._id === organizerId)).toBe(
        false,
      );
    });
  });

  describe('getBySlug', () => {
    it('returns community matching the slug', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Slug Community',
          slug: 'slug-community',
          description: 'Found by slug',
          isPublicDirectory: true,
        });
      });

      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'slug-community',
        },
      );

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Slug Community');
      expect(result!.slug).toBe('slug-community');
      expect(result!.description).toBe('Found by slug');
      // Legacy-undefined status → 'published'. See `community_status.ts`.
      expect(result!.status).toBe('published');
    });

    it('returns null for an unknown slug', async () => {
      const t = convexTest();
      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'does-not-exist',
        },
      );
      expect(result).toBeNull();
    });

    it('returns null for a non-directory community', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Private Community',
          slug: 'private-slug',
          description: 'Not in directory',
          isPublicDirectory: false,
        });
      });
      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'private-slug',
        },
      );
      expect(result).toBeNull();
    });

    it('returns an opted-in slug community without scanning its event history', async () => {
      const t = convexTest();

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const organizerId = await insertOrganizer(ctx, {
          name: 'Overflow Slug Community',
          slug: 'overflow-slug-community',
          isPublicDirectory: true,
          status: 'published',
        });

        await Promise.all(
          Array.from({length: 501}, (_, index) =>
            // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
            ctx.db.insert('events', {
              title: `Overflow Event ${index + 1}`,
              date: `2031-02-${String((index % 28) + 1).padStart(2, '0')}T20:00:00.000Z`,
              price: 900,
              totalTickets: 90,
              status: 'published',
              visibility: 'public_viewable',
              organizerId,
            }),
          ),
        );
      });

      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'overflow-slug-community',
        },
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Overflow Slug Community');
    });

    it('returns null for draft communities even when directory flag is true', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Draft Slug Community',
          slug: 'draft-slug',
          isPublicDirectory: true,
          status: 'draft',
        });
      });
      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'draft-slug',
        },
      );
      expect(result).toBeNull();
    });

    it('returns only public-safe fields', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Safe Slug Community',
          slug: 'safe-slug',
          email: 'hidden@example.com',
          contactInfo: 'Call us at 555-1234',
          vettingQuestions: [
            {id: 'q1', question: 'Why?', type: 'text', required: false},
          ],
          website: 'https://safe.example.com',
          isPublicDirectory: true,
        });
      });

      const result = await t.query(
        internal.communities.directory.getBySlugInternal,
        {
          slug: 'safe-slug',
        },
      );

      expect(result).not.toBeNull();
      expect(result!.slug).toBe('safe-slug');
      expect(result!.website).toBe('https://safe.example.com');
      expect('email' in result!).toBe(false);
      expect('contactInfo' in result!).toBe(false);
      expect('vettingQuestions' in result!).toBe(false);
    });
  });

  describe('getBySlugOrId', () => {
    it('allows authenticated users to read published non-directory communities with vetting questions', async () => {
      const t = convexTest();
      const viewerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user for query authorization test
        return await ctx.db.insert('users', {name: 'Vetting Link User'});
      });
      const organization = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        return await insertOrganizer(ctx, {
          name: 'Vetting Community',
          email: 'private-vetting@example.com',
          contactInfo: 'private moderator signal',
          stripeConnectedAccountId: 'acct_private_vetting',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeCurrentlyDue: [],
          status: 'published',
          slug: 'vetting-community',
          isPublicDirectory: false,
          vettingQuestions: [
            {
              id: 'q1',
              question: 'Why do you want to join?',
              type: 'text',
              required: true,
            },
          ],
        });
      });

      const asViewer = t.withIdentity({subject: viewerId});

      const bySlug = await asViewer.query(
        api.communities.public.getBySlugOrId,
        {
          slugOrId: 'vetting-community',
        },
      );
      expect(bySlug).not.toBeNull();
      expect(bySlug?.name).toBe('Vetting Community');
      expect(bySlug?._id).toBe(organization);
      expect(bySlug?.vettingQuestions).toHaveLength(1);
      expect(bySlug?.email).toBeUndefined();
      expect(bySlug?.contactInfo).toBeUndefined();
      const bySlugUnsafe = bySlug as unknown as Record<string, unknown>;
      expect(bySlugUnsafe['stripeConnectedAccountId']).toBeUndefined();
      expect(bySlugUnsafe['stripeOnboardingStatus']).toBeUndefined();
      expect(bySlugUnsafe['stripeChargesEnabled']).toBeUndefined();
      expect(bySlugUnsafe['stripePayoutsEnabled']).toBeUndefined();
      expect(bySlugUnsafe['stripeCurrentlyDue']).toBeUndefined();

      const byId = await asViewer.query(api.communities.public.getBySlugOrId, {
        slugOrId: organization,
      });
      expect(byId).not.toBeNull();
      expect(byId?.name).toBe('Vetting Community');
      expect(byId?._id).toBe(organization);
    });

    it('returns null for draft non-directory communities', async () => {
      const t = convexTest();
      const viewerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user for query authorization test
        return await ctx.db.insert('users', {name: 'Draft Viewer'});
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'Draft Vetting Community',
          status: 'draft',
          slug: 'draft-vetting-community',
          isPublicDirectory: false,
          vettingQuestions: [
            {
              id: 'q1',
              question: 'Why do you want to join?',
              type: 'text',
              required: true,
            },
          ],
        });
      });

      const asViewer = t.withIdentity({subject: viewerId});
      const result = await asViewer.query(
        api.communities.public.getBySlugOrId,
        {
          slugOrId: 'draft-vetting-community',
        },
      );

      expect(result).toBeNull();
    });

    it('preserves community-admin access to draft communities by slug', async () => {
      const t = convexTest();
      const adminId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user for query authorization test
        return await ctx.db.insert('users', {name: 'Draft Community Admin'});
      });
      const organizerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        return await insertOrganizer(ctx, {
          name: 'Admin Draft Community',
          email: 'admin-draft-private@example.com',
          contactInfo: 'admin-only contact',
          status: 'draft',
          slug: 'admin-draft-community',
          isPublicDirectory: false,
        });
      });
      await t.run(async (ctx) => {
        await assignCommunityAdmin(ctx, adminId, organizerId);
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.query(api.communities.public.getBySlugOrId, {
        slugOrId: 'admin-draft-community',
      });

      expect(result).not.toBeNull();
      expect(result?._id).toBe(organizerId);
      expect(result?.email).toBe('admin-draft-private@example.com');
      expect(result?.contactInfo).toBe('admin-only contact');
    });

    it('returns null for published communities without vetting questions', async () => {
      const t = convexTest();
      const viewerId = await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user for query authorization test
        return await ctx.db.insert('users', {name: 'No Vetting Viewer'});
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        await insertOrganizer(ctx, {
          name: 'No Vetting Community',
          status: 'published',
          slug: 'no-vetting-community',
          isPublicDirectory: false,
        });
      });

      const asViewer = t.withIdentity({subject: viewerId});
      const result = await asViewer.query(
        api.communities.public.getBySlugOrId,
        {
          slugOrId: 'no-vetting-community',
        },
      );

      expect(result).toBeNull();
    });
  });

  describe('update — directory and new fields', () => {
    async function setupDirectoryData() {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin', 'root@test.com'),
      );
      const orgId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'Dir Org',
          email: 'dir@test.com',
          stripeConnectedAccountId: 'acct_dir_org',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeCurrentlyDue: [],
        }),
      );
      return {t, rootAdminId, orgId};
    }

    it('update with description and website succeeds', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        description: 'A great community',
        website: 'https://example.com',
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(organizer?.description).toBe('A great community');
      expect(organizer?.website).toBe('https://example.com');
    });

    it('update with javascript: URL throws ConvexError', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          website: 'javascript:alert(1)',
        }),
      ).rejects.toThrow('Website must be a valid HTTP or HTTPS URL');
    });

    it('update with invalid URL throws ConvexError', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          website: 'not a url at all',
        }),
      ).rejects.toThrow('Website must be a valid HTTP or HTTPS URL');
    });

    it('update with oversized description throws ConvexError', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const oversized = 'x'.repeat(2001); // MAX_COMMUNITY_DESCRIPTION_LENGTH = 2000

      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          description: oversized,
        }),
      ).rejects.toThrow();
    });

    it('update with isPublicDirectory: true makes community appear in directory', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Initially not in directory
      const before = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(before.some((r) => r._id === orgId)).toBe(false);

      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        isPublicDirectory: true,
      });

      const after = await t.query(
        internal.communities.directory.listPublicDirectoryInternal,
        {},
      );
      expect(after.some((r) => r._id === orgId)).toBe(true);
    });

    it('update with logoStorageId: null clears a pre-existing value', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();

      // Seed a non-null logoStorageId via test storage.
      // Raw patch is intentional: no production path sets logoStorageId without
      // the upload confirmation flow, so we inject the precondition directly to
      // test that the mutation can clear a pre-existing value.
      const fakeStorageId = await t.run(async (ctx) => {
        const id = await ctx.storage.store(
          new Blob(['fake-logo'], {type: 'image/png'}),
        );
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seeding unconfirmed logoStorageId to test null-clear path; no production mutation accepts unconfirmed uploads
        await ctx.db.patch('organizers', orgId, {logoStorageId: id});
        return id;
      });

      // Verify it was set
      const before = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(before?.logoStorageId).toBe(fakeStorageId);

      // Now clear it via the mutation
      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        logoStorageId: null,
      });

      const after = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(after?.logoStorageId).toBeNull();
    });

    it('rejects publishing when there are no vetting questions', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          status: 'published',
          vettingQuestions: [],
        }),
      ).rejects.toThrow(
        'Published communities must have at least one vetting question',
      );
    });

    it('allows updating legacy community rows with missing status and no vetting questions', async () => {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin', 'root@test.com'),
      );
      const orgId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'Legacy Org',
          email: 'legacy@test.com',
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: 'Legacy Org Updated',
      });

      const organizer = await t.run(async (ctx) => ctx.db.get(orgId));
      expect(organizer?.name).toBe('Legacy Org Updated');
      expect(organizer?.status).toBeUndefined();
    });

    it('rejects publishing without payment setup', async () => {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        createRootAdmin(ctx, 'Root Admin', 'root@test.com'),
      );
      const orgId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {
          name: 'No Stripe Org',
          status: 'draft',
          vettingQuestions: [
            {
              id: 'q1',
              question: 'Why join?',
              type: 'text' as const,
              required: true,
            },
          ],
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          status: 'published',
          vettingQuestions: [
            {
              id: 'q1',
              question: 'Why join?',
              type: 'text' as const,
              required: true,
            },
          ],
        }),
      ).rejects.toThrow(
        'Publishing a community requires Stripe Connect or platform payment setup',
      );
    });

    it('rejects removing all vetting questions from a published community', async () => {
      const {t, rootAdminId, orgId} = await setupDirectoryData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        status: 'published',
        vettingQuestions: [
          {id: 'q1', question: 'Why join?', type: 'text', required: true},
        ],
      });

      await expect(
        asAdmin.mutation(api.communities.profile.update, {
          id: orgId,
          vettingQuestions: [],
        }),
      ).rejects.toThrow(
        'Published communities must have at least one vetting question',
      );
    });
  });

  it('rate limits after 10 updates per minute', async () => {
    const t = convexTest();
    const rootAdminId = await t.run(async (ctx) =>
      createRootAdmin(ctx, 'Rate Limit Admin', 'ratelimit@test.com'),
    );
    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Rate Limit Org'}),
    );

    const asAdmin = t.withIdentity({subject: rootAdminId});

    // First 10 updates should succeed (rate limit is 10 per minute)
    for (let i = 0; i < 10; i++) {
      await asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: `Update ${i}`,
      });
    }

    // 11th update should be rate limited
    await expect(
      asAdmin.mutation(api.communities.profile.update, {
        id: orgId,
        name: 'Should Fail',
      }),
    ).rejects.toThrow();
  });
});

describe('Community Slugs', () => {
  it('auto-generates slug from name on create', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'Underground Collective',
    });
    const org = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(org?.slug).toBe('underground-collective');
  });

  it('generates unique slugs for duplicate names', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    const id1 = await admin.mutation(api.communities.profile.create, {
      name: 'Duplicate',
    });
    const id2 = await admin.mutation(api.communities.profile.create, {
      name: 'Duplicate',
    });
    const org1 = await admin.query(api.communities.public.get, {id: id1});
    const org2 = await admin.query(api.communities.public.get, {id: id2});
    expect(org1?.slug).toBe('duplicate');
    expect(org2?.slug).not.toBe('duplicate');
    expect(org2?.slug).toMatch(/^duplicate-/);
  });

  it('allows manual slug override on create', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'Custom Slug Org',
      slug: 'my-manual-slug',
    });
    const org = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(org?.slug).toBe('my-manual-slug');
  });

  it('rejects route-unsafe manual slugs on create', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});

    await expect(
      admin.mutation(api.communities.profile.create, {
        name: 'Invalid Slug Org',
        slug: 'Bad Slug!!',
      }),
    ).rejects.toThrow(/Slug must use lowercase letters/);
  });

  it('rejects empty manual slugs on create', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});

    await expect(
      admin.mutation(api.communities.profile.create, {
        name: 'Empty Slug Org',
        slug: '',
      }),
    ).rejects.toThrow(/Slug must use lowercase letters/);
  });

  it('ensures unique slug when manual slug conflicts on create', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.create, {
      name: 'Existing',
      slug: 'taken',
    });
    const id2 = await admin.mutation(api.communities.profile.create, {
      name: 'New',
      slug: 'taken',
    });
    const org2 = await admin.query(api.communities.public.get, {id: id2});
    expect(org2?.slug).not.toBe('taken');
    expect(org2?.slug).toMatch(/^taken-/);
  });

  it('allows manual slug override on update', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'My Org',
    });
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      slug: 'custom-slug',
    });
    const org = await admin.query(api.communities.public.get, {
      id: organizerId,
    });
    expect(org?.slug).toBe('custom-slug');
  });

  it('rejects route-unsafe manual slugs on update', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    const organizerId = await admin.mutation(api.communities.profile.create, {
      name: 'My Org',
    });
    await expect(
      admin.mutation(api.communities.profile.update, {
        id: organizerId,
        slug: '$$$',
      }),
    ).rejects.toThrow(/Slug must use lowercase letters/);
  });

  it('rejects duplicate slug on update', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.create, {name: 'First'});
    const id2 = await admin.mutation(api.communities.profile.create, {
      name: 'Second',
    });
    await expect(
      admin.mutation(api.communities.profile.update, {id: id2, slug: 'first'}),
    ).rejects.toThrow(/slug.*taken/i);
  });
});

describe('communities.update vetting question orphan cleanup', () => {
  it('strips orphaned answer keys when vetting questions are removed', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {
        name: 'Test Community',
        vettingQuestions: [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
          {
            id: 'q2',
            question: 'Referral?',
            type: 'text' as const,
            required: false,
          },
          {id: 'q3', question: 'Age?', type: 'text' as const, required: false},
        ],
      });
    });
    const userId1 = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User1'}),
    );
    const appId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
      return await ctx.db.insert('applications', {
        userId: userId1,
        organizerId,
        status: 'pending',
        answers: {q1: 'I want to join', q2: 'A friend', q3: '25'},
      });
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      vettingQuestions: [
        {id: 'q1', question: 'Why join?', type: 'text', required: true},
      ],
    });

    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.answers).toEqual({q1: 'I want to join'});
  });

  it('does not modify applications when no questions are removed', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {
        name: 'Test Community',
        vettingQuestions: [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
        ],
      });
    });
    const userId1 = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User1'}),
    );
    const appId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
      return await ctx.db.insert('applications', {
        userId: userId1,
        organizerId,
        status: 'pending',
        answers: {q1: 'I want to join'},
      });
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why do you want to join?',
          type: 'text',
          required: true,
        },
      ],
    });

    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.answers).toEqual({q1: 'I want to join'});
  });

  it('logs cleanup in audit log when orphaned keys are removed', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {
        name: 'Test Community',
        vettingQuestions: [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
          {
            id: 'q2',
            question: 'Referral?',
            type: 'text' as const,
            required: false,
          },
        ],
      });
    });
    const userId1 = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User1'}),
    );
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
      await ctx.db.insert('applications', {
        userId: userId1,
        organizerId,
        status: 'pending',
        answers: {q1: 'Yes', q2: 'Bob'},
      });
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      vettingQuestions: [
        {id: 'q1', question: 'Why join?', type: 'text', required: true},
      ],
    });

    const auditLogs = await t.run(async (ctx) => {
      return await ctx.db.query('adminAuditLogs').collect();
    });
    const cleanupLog = auditLogs.find(
      (l) => l.action === 'organizer.cleanupOrphanedAnswers',
    );
    expect(cleanupLog).toBeDefined();
    expect(cleanupLog?.organizerId).toEqual(organizerId);
    expect(cleanupLog?.adminId).toEqual(adminId);

    // The normal organizer.update audit log must ALSO be written
    const updateLog = auditLogs.find((l) => l.action === 'organizer.update');
    expect(updateLog).toBeDefined();
  });

  it('does not run cleanup when vettingQuestions is not in update args', async () => {
    const t = convexTest();
    const adminId = await t.run(async (ctx) => {
      return await createRootAdmin(ctx);
    });
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      return await insertOrganizer(ctx, {
        name: 'Test Community',
        vettingQuestions: [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
        ],
      });
    });
    const userId1 = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {name: 'User1'}),
    );
    const appId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
      return await ctx.db.insert('applications', {
        userId: userId1,
        organizerId,
        status: 'approved',
        answers: {q1: 'Yes'},
      });
    });

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.communities.profile.update, {
      id: organizerId,
      name: 'Renamed Community',
    });

    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.answers).toEqual({q1: 'Yes'});

    const auditLogs = await t.run(async (ctx) => {
      return await ctx.db.query('adminAuditLogs').collect();
    });
    const cleanupLog = auditLogs.find(
      (l) => l.action === 'organizer.cleanupOrphanedAnswers',
    );
    expect(cleanupLog).toBeUndefined();
  });
});

describe('update — cascade events on draft transition', () => {
  async function setupCascadeData() {
    const t = convexTest();
    const rootAdminId = await t.run(async (ctx) =>
      createRootAdmin(ctx, 'Root Admin'),
    );
    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {
        name: 'Cascade Org',
        slug: 'cascade-org',
        status: 'published',
        stripeConnectedAccountId: 'acct_cascade',
        stripeOnboardingStatus: 'complete',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeCurrentlyDue: [],
        vettingQuestions: [
          {id: 'q1', question: 'Why?', type: 'text', required: true},
        ],
      }),
    );
    return {t, rootAdminId, orgId};
  }

  it('sets published events to draft when community goes to draft', async () => {
    const {t, rootAdminId, orgId} = await setupCascadeData();

    const [pubEvent1, pubEvent2, draftEvent] = await t.run(async (ctx) =>
      Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        ctx.db.insert('events', {
          title: 'Pub Event 1',
          price: 1000,
          totalTickets: 50,
          date: '2030-12-15',
          status: 'published',
          visibility: 'public',
          organizerId: orgId,
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        ctx.db.insert('events', {
          title: 'Pub Event 2',
          price: 2000,
          totalTickets: 100,
          date: '2030-12-20',
          status: 'published',
          visibility: 'public',
          organizerId: orgId,
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        ctx.db.insert('events', {
          title: 'Draft Event',
          price: 500,
          totalTickets: 25,
          date: '2030-12-25',
          status: 'draft',
          visibility: 'public',
          organizerId: orgId,
        }),
      ]),
    );

    const asAdmin = t.withIdentity({subject: rootAdminId});
    await asAdmin.mutation(api.communities.profile.update, {
      id: orgId,
      status: 'draft',
    });

    const [e1, e2, e3] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get('events', pubEvent1),
        ctx.db.get('events', pubEvent2),
        ctx.db.get('events', draftEvent),
      ]),
    );
    expect(e1?.status).toBe('draft');
    expect(e2?.status).toBe('draft');
    expect(e3?.status).toBe('draft');
  });

  it('does not cascade when community stays published', async () => {
    const {t, rootAdminId, orgId} = await setupCascadeData();

    const eventId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
      ctx.db.insert('events', {
        title: 'Stays Published',
        price: 1000,
        totalTickets: 50,
        date: '2030-12-15',
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      }),
    );

    const asAdmin = t.withIdentity({subject: rootAdminId});
    await asAdmin.mutation(api.communities.profile.update, {
      id: orgId,
      name: 'Renamed Org',
    });

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event?.status).toBe('published');
  });
});
