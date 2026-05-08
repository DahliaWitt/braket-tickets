import {createAutoDrainConvexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {addMember, authz} from '../../lib/authz';

// Auto-drain scheduled workpool / setTimeout callbacks between tests — see
// `createAutoDrainConvexTest` for rationale.
const convexTest = createAutoDrainConvexTest();

describe('admin_invites', () => {
  // Helper: create a root admin user and return their ID
  async function setupRootAdmin(t: ReturnType<typeof convexTest>) {
    return t.mutation(api.testing.users.createUserDirectly, {
      name: 'Root Admin',
      email: 'root@test.com',
      isRootAdmin: true,
    });
  }

  // Helper: create a regular user with the given email
  async function setupRegularUser(
    t: ReturnType<typeof convexTest>,
    email: string,
  ) {
    return t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email,
    });
  }

  describe('createWithCommunity', () => {
    it('creates organizer, invite, and returns invite URL', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'invitee@test.com',
          communityName: 'Test Community',
        },
      );

      expect(result.inviteId).toBeTruthy();
      expect(result.organizerId).toBeTruthy();
      expect(result.inviteUrl).toBeTruthy();
      // URL should point to the admin-invite redemption path
      expect(result.inviteUrl).toContain('/admin-invite/');

      // Verify organizer was created with correct name
      const org = await t.run(async (ctx) =>
        ctx.db.get('organizers', result.organizerId),
      );
      expect(org?.name).toBe('Test Community');
    });

    it('creates a pending invite with correct fields', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'invitee@test.com',
          communityName: 'My Community',
        },
      );

      const invite = await t.run(async (ctx) =>
        ctx.db.get('admin_invites', result.inviteId),
      );

      expect(invite).not.toBeNull();
      expect(invite?.email).toBe('invitee@test.com');
      expect(invite?.communityName).toBe('My Community');
      expect(invite?.status).toBe('pending');
      expect(invite?.invitedBy).toBe(rootAdminId);
      expect(invite?.organizerId).toBe(result.organizerId);
      expect(invite?.token).toBeUndefined();
      expect(invite?.tokenDigest).toBeTruthy();
      expect(result.inviteUrl).toContain('/admin-invite/');
      // Expires in ~7 days
      expect(invite?.expiresAt).toBeGreaterThan(
        Date.now() + 6 * 24 * 60 * 60 * 1000,
      );
    });

    it('normalizes email to lowercase', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'INVITEE@TEST.COM',
          communityName: 'Email Case Community',
        },
      );

      const invite = await t.run(async (ctx) =>
        ctx.db.get('admin_invites', result.inviteId),
      );
      expect(invite?.email).toBe('invitee@test.com');
    });

    it('rejects non-root-admin callers', async () => {
      const t = convexTest();
      const regularUserId = await setupRegularUser(t, 'user@test.com');
      const asUser = t.withIdentity({subject: regularUserId});

      await expect(
        asUser.mutation(api.root_admin.invites.createWithCommunity, {
          email: 'invitee@test.com',
          communityName: 'Some Community',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty community name', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await expect(
        asAdmin.mutation(api.root_admin.invites.createWithCommunity, {
          email: 'invitee@test.com',
          communityName: '   ',
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid email (no @)', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await expect(
        asAdmin.mutation(api.root_admin.invites.createWithCommunity, {
          email: 'notanemail',
          communityName: 'Some Community',
        }),
      ).rejects.toThrow();
    });

    it('rejects unauthenticated callers', async () => {
      const t = convexTest();

      await expect(
        t.mutation(api.root_admin.invites.createWithCommunity, {
          email: 'invitee@test.com',
          communityName: 'Some Community',
        }),
      ).rejects.toThrow();
    });
  });

  describe('redeem', () => {
    // Helper: seed a pending invite and return the invite + organizer IDs
    async function seedPendingInvite(
      t: ReturnType<typeof convexTest>,
      {
        email,
        expiresAt,
        status = 'pending',
      }: {
        email: string;
        expiresAt?: number;
        status?: 'pending' | 'redeemed' | 'cancelled';
      },
    ) {
      const invitedByUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Invited By User',
          email: 'root2@test.com',
        },
      );
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Seed Org',
        },
      );
      await t.run(async (ctx) => {
        await authz.assignRole(
          ctx,
          invitedByUserId as string,
          'community_admin',
          {
            type: 'organizer',
            id: organizerId as string,
          },
        );
        await addMember(ctx, invitedByUserId, organizerId);
      });
      const token = 'abc123def456abc123def456abc12300'; // 32-char hex
      const inviteId = await t.mutation(api.testing.admin.seedAdminInvite, {
        email,
        organizerId,
        communityName: 'Seed Org',
        token,
        invitedBy: invitedByUserId,
        status,
        expiresAt: expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      return {inviteId, organizerId, token, invitedByUserId};
    }

    it('grants community_admin and marks invite redeemed', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'invitee@test.com',
          name: 'Invitee',
        },
      );
      const {organizerId, token} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      const result = await asRedeemer.mutation(
        api.communities.management.invites.redeem,
        {token},
      );

      expect(result.organizerId).toBe(organizerId);

      // Verify the invite is redeemed by attempting a second redemption,
      // which must reject. (Direct DB assertions via t.run() are unreliable
      // here because workpool-scheduled actions from createWithCommunity
      // tests above can poison convex-test's global component context.)
      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });

    it('rejects a pending invite when the inviter no longer manages the community at redemption time', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'invitee@test.com',
          name: 'Invitee',
        },
      );
      const {token, organizerId, invitedByUserId} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
      });

      await t.run(async (ctx) => {
        await authz.revokeRole(
          ctx,
          invitedByUserId as string,
          'community_admin',
          {type: 'organizer', id: organizerId as string},
          invitedByUserId as string,
        );
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {
          token,
        }),
      ).rejects.toThrow('This invitation has been cancelled');
    });

    it('keeps the community admin member relation after redeem', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'invitee@test.com',
          name: 'Invitee',
        },
      );
      const {token, organizerId} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await asRedeemer.mutation(api.communities.management.invites.redeem, {
        token,
      });

      const admins = await asRedeemer.query(
        api.communities.admins.listByCommunity,
        {
          organizerId,
        },
      );
      expect(admins.map((admin) => admin.userId)).toContain(redeemerId);
    });

    it('redeem grants membership without synthesizing an application', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'invitee@test.com',
          name: 'Invitee',
        },
      );
      const {token, organizerId} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await asRedeemer.mutation(api.communities.management.invites.redeem, {
        token,
      });

      const [applications, preference] = await t.run(async (ctx) =>
        Promise.all([
          ctx.db
            .query('applications')
            .withIndex('by_user_status', (q) => q.eq('userId', redeemerId))
            .collect(),
          ctx.db
            .query('marketingEmailPreferences')
            .withIndex('by_user_and_organizer', (q) =>
              q.eq('userId', redeemerId).eq('organizerId', organizerId),
            )
            .first(),
        ]),
      );

      expect(
        applications.filter((app) => app.organizerId === organizerId),
      ).toEqual([]);
      expect(preference).not.toBeNull();
      expect(preference?.optedIn).toBe(true);
    });

    it('rejects invalid token', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Test Redeemer',
          email: 'u@test.com',
        },
      );
      const asRedeemer = t.withIdentity({subject: redeemerId});

      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {
          token: 'nonexistenttoken1234567890abcdef',
        }),
      ).rejects.toThrow();
    });

    it('rejects already redeemed invite', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Invitee',
          email: 'invitee@test.com',
        },
      );
      const {token} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
        status: 'redeemed',
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });

    it('rejects expired invite', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Invitee',
          email: 'invitee@test.com',
        },
      );
      const {token} = await seedPendingInvite(t, {
        email: 'invitee@test.com',
        expiresAt: Date.now() - 1000, // already expired
      });

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });

    it('rejects email mismatch', async () => {
      const t = convexTest();
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Different User',
          email: 'different@test.com',
        },
      );
      const {token} = await seedPendingInvite(t, {email: 'invitee@test.com'});

      const asRedeemer = t.withIdentity({subject: redeemerId});
      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });

    it('rejects unauthenticated callers', async () => {
      const t = convexTest();
      const {token} = await seedPendingInvite(t, {email: 'invitee@test.com'});

      await expect(
        t.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });

    it('rejects cancelled invite', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const {inviteUrl, inviteId} = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {email: 'cancelled@test.com', communityName: 'Cancelled Test'},
      );
      const token = inviteUrl.split('/admin-invite/')[1];
      if (!token)
        throw new Error(`Could not extract token from inviteUrl: ${inviteUrl}`);

      // Cancel the invite
      await asAdmin.mutation(api.root_admin.invites.cancel, {inviteId});

      // Try to redeem as the intended recipient
      const redeemerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'cancelled@test.com',
          name: 'Cancelled',
        },
      );
      const asRedeemer = t.withIdentity({subject: redeemerId});

      await expect(
        asRedeemer.mutation(api.communities.management.invites.redeem, {token}),
      ).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    it('marks a pending invite as cancelled', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'cancel-me@test.com',
          communityName: 'Cancel Community',
        },
      );

      await asAdmin.mutation(api.root_admin.invites.cancel, {
        inviteId: result.inviteId,
      });

      const invite = await t.run(async (ctx) =>
        ctx.db.get('admin_invites', result.inviteId),
      );
      expect(invite?.status).toBe('cancelled');
    });

    it('is idempotent for already-cancelled invites', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'cancel2@test.com',
          communityName: 'Cancel2 Community',
        },
      );

      await asAdmin.mutation(api.root_admin.invites.cancel, {
        inviteId: result.inviteId,
      });
      // Second cancel should not throw
      await expect(
        asAdmin.mutation(api.root_admin.invites.cancel, {
          inviteId: result.inviteId,
        }),
      ).resolves.toBeNull();
    });

    it('rejects non-root-admin callers', async () => {
      const t = convexTest();
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.root_admin.invites.createWithCommunity,
        {
          email: 'cancel3@test.com',
          communityName: 'Cancel3 Community',
        },
      );

      const regularUserId = await setupRegularUser(t, 'regular@test.com');
      const asUser = t.withIdentity({subject: regularUserId});

      await expect(
        asUser.mutation(api.root_admin.invites.cancel, {
          inviteId: result.inviteId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('inviteToExisting', () => {
    async function setupOrganizer(t: ReturnType<typeof convexTest>) {
      return t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Community',
      });
    }

    async function setupCommunityAdmin(
      t: ReturnType<typeof convexTest>,
      organizerId: Id<'organizers'>,
    ) {
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Community Admin',
        email: 'commadmin@test.com',
      });
      await t.run(async (ctx) => {
        await authz.assignRole(ctx, userId, 'community_admin', {
          type: 'organizer',
          id: organizerId as string,
        });
        await addMember(ctx, userId, organizerId);
      });
      return userId;
    }

    it('creates invite for existing community by community admin (happy path)', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);
      const communityAdminId = await setupCommunityAdmin(t, organizerId);
      const asAdmin = t.withIdentity({subject: communityAdminId});

      const result = await asAdmin.mutation(
        api.communities.management.invites.inviteToExisting,
        {
          email: 'newadmin@test.com',
          organizerId,
        },
      );

      expect(result.inviteId).toBeTruthy();
      expect(result.inviteUrl).toContain('/admin-invite/');

      const invite = await t.run(async (ctx) =>
        ctx.db.get('admin_invites', result.inviteId),
      );
      expect(invite?.email).toBe('newadmin@test.com');
      expect(invite?.organizerId).toBe(organizerId);
      expect(invite?.status).toBe('pending');
      expect(invite?.invitedBy).toBe(communityAdminId);
    });

    it('creates invite by root admin', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const result = await asAdmin.mutation(
        api.communities.management.invites.inviteToExisting,
        {
          email: 'another@test.com',
          organizerId,
        },
      );

      expect(result.inviteId).toBeTruthy();
      expect(result.inviteUrl).toContain('/admin-invite/');
    });

    it('rejects unauthenticated caller', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);

      await expect(
        t.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'someone@test.com',
          organizerId,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-admin caller', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);
      const regularUserId = await setupRegularUser(t, 'regular@test.com');
      const asUser = t.withIdentity({subject: regularUserId});

      await expect(
        asUser.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'someone@test.com',
          organizerId,
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid email', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);
      const communityAdminId = await setupCommunityAdmin(t, organizerId);
      const asAdmin = t.withIdentity({subject: communityAdminId});

      await expect(
        asAdmin.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'notanemail',
          organizerId,
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate pending invite for same email+community', async () => {
      const t = convexTest();
      const organizerId = await setupOrganizer(t);
      const communityAdminId = await setupCommunityAdmin(t, organizerId);
      const asAdmin = t.withIdentity({subject: communityAdminId});

      // First invite succeeds
      await asAdmin.mutation(
        api.communities.management.invites.inviteToExisting,
        {
          email: 'dup@test.com',
          organizerId,
        },
      );

      // Second invite for the same email+community should fail
      await expect(
        asAdmin.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'dup@test.com',
          organizerId,
        }),
      ).rejects.toThrow();
    });

    it('rejects community admin inviting to a different community (confused deputy)', async () => {
      const t = convexTest();
      const orgA = await setupOrganizer(t);
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seedOrganizer would conflict with "Test Community" slug; unique raw insert needed for second org in same test
      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        ctx.db.insert('organizers', {
          name: 'Other Community',
          isPublicDirectory: true,
        }),
      );
      // Admin for orgA only
      const adminId = await setupCommunityAdmin(t, orgA);
      const asAdmin = t.withIdentity({subject: adminId});

      // Should reject — adminId has no authority over orgB
      await expect(
        asAdmin.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'victim@test.com',
          organizerId: orgB,
        }),
      ).rejects.toThrow();
    });

    it('rejects if organizer does not exist', async () => {
      const t = convexTest();
      // Create a valid organizer just to get a valid ID shape, then delete it
      // Use root admin since community admin check would also fail for unknown org
      const realOrganizerId = await setupOrganizer(t);
      const rootAdminId = await setupRootAdmin(t);
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- deleting the organizer to simulate a non-existent org ID; no public delete mutation exists for organizers
      await t.run(async (ctx) => ctx.db.delete(realOrganizerId));

      await expect(
        asAdmin.mutation(api.communities.management.invites.inviteToExisting, {
          email: 'ghost@test.com',
          organizerId: realOrganizerId,
        }),
      ).rejects.toThrow();
    });
  });
});
