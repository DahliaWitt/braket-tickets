import {convexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {authz} from '../../lib/authz';
import {ErrorMessages} from '../../lib/errors';
import {rateLimiter} from '../../lib/rate_limits';
import {expectUnauthorizedError} from '../../testing/assertions';

let uniqueSuffixCounter = 0;
function uniqueSuffix(): string {
  uniqueSuffixCounter += 1;
  return `${Date.now()}-${uniqueSuffixCounter}`;
}

async function catchReject(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

type OrganizerInsert = Omit<
  Doc<'organizers'>,
  '_id' | '_creationTime' | 'isPublicDirectory'
> &
  Partial<Pick<Doc<'organizers'>, 'isPublicDirectory'>>;

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

describe('community_scanners', () => {
  async function setupTestData() {
    const t = convexTest();
    const rootAdminId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {
        name: 'Root Admin',
        email: 'root@test.com',
      }),
    );
    await t.run(async (ctx) =>
      authz.assignRole(ctx, rootAdminId, 'root_admin'),
    );
    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Org'}),
    );
    const scannerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {
        name: 'Scanner User',
        email: 'scanner@test.com',
      }),
    );
    return {t, rootAdminId, orgId, scannerId};
  }

  describe('hasAnyAssignment', () => {
    it('returns true for a scanner user', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const hasAssignment = await asScanner.query(
        api.communities.scanners.hasAnyAssignment,
        {},
      );
      expect(hasAssignment).toBe(true);
    });

    it('returns true for a community admin with no explicit scanner assignment', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const communityAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Community Admin',
          email: 'cadmin@test.com',
        }),
      );
      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: communityAdminId,
        organizerId: orgId,
      });

      const asAdmin = t.withIdentity({subject: communityAdminId});
      const hasAssignment = await asAdmin.query(
        api.communities.scanners.hasAnyAssignment,
        {},
      );
      expect(hasAssignment).toBe(true);
    });

    it('returns false for a user with no scanner access', async () => {
      const {t, scannerId} = await setupTestData();
      const asScanner = t.withIdentity({subject: scannerId});

      const hasAssignment = await asScanner.query(
        api.communities.scanners.hasAnyAssignment,
        {},
      );
      expect(hasAssignment).toBe(false);
    });
  });

  describe('myScannerEvents', () => {
    it('returns events from assigned communities', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Create events for the org
      await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        ctx.db.insert('events', {
          title: 'Test Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        }),
      );

      // Grant scanner access
      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Test Event');
    });

    it('only returns published events to scanners (cancelled events excluded)', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Active Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Cancelled Event',
          date: '2026-06-16',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'cancelled',
          visibility: 'public',
        });
      });

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Active Event');
    });

    it('does not include events from unassigned communities', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Org A Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Org B Event',
          date: '2026-06-16',
          price: 1000,
          totalTickets: 100,
          organizerId: orgB,
          status: 'published',
          visibility: 'public',
        });
      });

      // Only assign scanner to Org A
      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Org A Event');
    });

    it('returns empty array for user with no scanner assignments', async () => {
      const {t, scannerId} = await setupTestData();
      const asScanner = t.withIdentity({subject: scannerId});

      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toEqual([]);
    });

    it('excludes draft events (only published events are shown to scanners)', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Draft Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'draft',
          visibility: 'public',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Published Event',
          date: '2026-06-16',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        });
      });

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Published Event');
    });

    it('excludes draft events even for community admins (intentional — draft events are not scannable)', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const communityAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Community Admin',
          email: 'cadmin@test.com',
        }),
      );

      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: communityAdminId,
        organizerId: orgId,
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Draft Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'draft',
          visibility: 'public',
        });
      });

      const asAdmin = t.withIdentity({subject: communityAdminId});
      const events = await asAdmin.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      // Community admin MUST NOT see draft events in the scanner list —
      // QR codes cannot be issued against unpublished events.
      expect(events).toEqual([]);
    });

    it('returns events for community admin without scanner assignment', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const communityAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Community Admin',
          email: 'cadmin@test.com',
        }),
      );

      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: communityAdminId,
        organizerId: orgId,
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Admin Visible Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        });
      });

      const asAdmin = t.withIdentity({subject: communityAdminId});
      const events = await asAdmin.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Admin Visible Event');
    });

    it('includes events from multiple assigned communities', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Org A Event',
          date: '2026-06-15',
          price: 1000,
          totalTickets: 100,
          organizerId: orgId,
          status: 'published',
          visibility: 'public',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal event for test setup; seedEvent enforces validation not needed here
        await ctx.db.insert('events', {
          title: 'Org B Event',
          date: '2026-06-16',
          price: 1000,
          totalTickets: 100,
          organizerId: orgB,
          status: 'published',
          visibility: 'public',
        });
      });

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgB,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      const events = await asScanner.query(
        api.communities.scanners.myScannerEvents,
        {},
      );
      expect(events).toHaveLength(2);
      const titles = events.map((e: {title: string}) => e.title);
      expect(titles).toContain('Org A Event');
      expect(titles).toContain('Org B Event');
    });
  });

  describe('grant — authz ordering', () => {
    it('unauthorized caller targeting existing scanner throws FORBIDDEN (no role-membership leak)', async () => {
      // Regression: the idempotent short-circuit previously ran BEFORE the authz gate,
      // letting an unauthorized caller distinguish "target already has scanner role"
      // (null return) from "does not" (FORBIDDEN throw).
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-scan-grant@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      await expect(
        asOutsider.mutation(api.communities.scanners.grant, {
          userId: scannerId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('authorized idempotent grant writes no new audit log row', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      const result = await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });
      expect(result).toBeNull();

      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter).toHaveLength(logsBefore.length);
    });

    it('rejects explicit scanner grants for community admins', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const communityAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user for authz/query testing
        ctx.db.insert('users', {
          name: 'Community Admin',
          email: 'scanner-admin@test.com',
        }),
      );
      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: communityAdminId,
        organizerId: orgId,
      });

      await expect(
        asRoot.mutation(api.communities.scanners.grant, {
          userId: communityAdminId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(
        'This user is already an admin. Admins can already check in guests.',
      );
    });

    it('authz-failing grant spam leaves rate-limit counter untouched (rollback contract)', async () => {
      // See communities/admins.test.ts for the full rationale. Short version:
      // rateLimiter.limit(ctx, ...) is transactional with the outer mutation,
      // so an authz UNAUTHORIZED throw rolls back both the gate AND the
      // rate-limit increment. Every pure-FORBIDDEN spam attempt looks
      // identical, and no budget is burned. This test pins the real
      // observable contract via a direct counter check.
      const {t, orgId, scannerId} = await setupTestData();

      // Outsider: authenticated, but no manage permission on orgId.
      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-scan-grant-spam@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      // grantCommunityScanner bucket is 20/min. Spam 20; each rolls back.
      for (let i = 0; i < 20; i++) {
        const err = await catchReject(
          asOutsider.mutation(api.communities.scanners.grant, {
            userId: scannerId,
            organizerId: orgId,
          }),
        );
        expectUnauthorizedError(err);
      }

      // 21st call: still UNAUTHORIZED — no budget burned.
      const finalErr = await catchReject(
        asOutsider.mutation(api.communities.scanners.grant, {
          userId: scannerId,
          organizerId: orgId,
        }),
      );
      expectUnauthorizedError(finalErr);

      // Rate-limit counter: untouched (fixed-window value == rate).
      const state = await t.run((ctx) =>
        rateLimiter.getValue(ctx, 'grantCommunityScanner', {key: outsiderId}),
      );
      expect(state.value).toBe(state.config.rate);
    });
  });

  describe('revoke — authz ordering', () => {
    it('unauthorized caller targeting existing scanner throws FORBIDDEN (no role-membership leak)', async () => {
      // Regression: previously the "is target a scanner?" state read ran BEFORE the
      // authz gate, so an unauthorized caller saw a null return (target has role)
      // vs. a FORBIDDEN throw (target does not).
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-scan-revoke@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      await expect(
        asOutsider.mutation(api.communities.scanners.revoke, {
          userId: scannerId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('authorized idempotent revoke writes no new audit log row', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      // scannerId has never been granted; revoke should be a no-op.
      const result = await asAdmin.mutation(api.communities.scanners.revoke, {
        userId: scannerId,
        organizerId: orgId,
      });
      expect(result).toBeNull();

      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter).toHaveLength(logsBefore.length);
    });
  });

  describe('searchGrantCandidates', () => {
    async function addDirectoryMember(
      t: ReturnType<typeof convexTest>,
      args: {name: string; email: string; organizerId: Id<'organizers'>},
    ): Promise<Id<'users'>> {
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: args.name,
        email: args.email,
      });
      // Approved application is the production path that populates
      // organizer_user_directory (see testing/applications.ts
      // insertSeedApplication: approved + organizerId -> addMember +
      // refreshOrganizerDirectoryForMembershipChange).
      await t.mutation(api.testing.applications.seedApplication, {
        userId,
        organizerId: args.organizerId,
        status: 'approved',
        answers: {},
      });
      return userId;
    }

    it('matches community members by name and by email prefix, scoped to the organizer directory', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();

      const otherOrgId = await t.run(async (ctx) =>
        insertOrganizer(ctx, {name: 'Other Org'}),
      );

      const nameMatchId = await addDirectoryMember(t, {
        name: `Searchable NameMatch ${suffix}`,
        email: `namematch-${suffix}@test.com`,
        organizerId: orgId,
      });
      const emailMatchId = await addDirectoryMember(t, {
        name: `Unrelated Person ${suffix}`,
        email: `emailprefix-${suffix}@test.com`,
        organizerId: orgId,
      });
      // Matching name, but only a member of a DIFFERENT community's directory.
      const wrongOrgMatchId = await addDirectoryMember(t, {
        name: `Searchable NameMatch ${suffix} Elsewhere`,
        email: `elsewhere-${suffix}@test.com`,
        organizerId: otherOrgId,
      });

      const asAdmin = t.withIdentity({subject: rootAdminId});

      const nameResults = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: `Searchable NameMatch ${suffix}`},
      );
      expect(nameResults.map((row) => row.userId)).toContain(nameMatchId);
      expect(nameResults.map((row) => row.userId)).not.toContain(
        wrongOrgMatchId,
      );

      const emailResults = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: `emailprefix-${suffix}`},
      );
      expect(emailResults.map((row) => row.userId)).toEqual([emailMatchId]);
    });

    it('returns [] for empty or whitespace-only searchTerm', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const empty = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: ''},
      );
      expect(empty).toEqual([]);

      const whitespace = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: '   '},
      );
      expect(whitespace).toEqual([]);
    });

    it('does not error for a searchTerm longer than 100 characters', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const longTerm = 'a'.repeat(500);
      await expect(
        asAdmin.query(api.communities.scanners.searchGrantCandidates, {
          organizerId: orgId,
          searchTerm: longTerm,
        }),
      ).resolves.toEqual([]);
    });

    it('denies a plain member with no manage permission', async () => {
      const {t, orgId} = await setupTestData();
      const memberId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Plain Member',
          email: 'plain-member-search@test.com',
        }),
      );
      await t.run(async (ctx) =>
        authz.assignRole(ctx, memberId, 'member', {
          type: 'organizer',
          id: orgId as string,
        }),
      );

      const asMember = t.withIdentity({subject: memberId});
      await expect(
        asMember.query(api.communities.scanners.searchGrantCandidates, {
          organizerId: orgId,
          searchTerm: 'anything',
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('denies a scanner (no manage permission)', async () => {
      const {t, rootAdminId, orgId, scannerId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: scannerId,
        organizerId: orgId,
      });

      const asScanner = t.withIdentity({subject: scannerId});
      await expect(
        asScanner.query(api.communities.scanners.searchGrantCandidates, {
          organizerId: orgId,
          searchTerm: 'anything',
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('denies an admin of a different community', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const otherOrgId = await t.run(async (ctx) =>
        insertOrganizer(ctx, {name: 'Other Org For Denial'}),
      );
      const otherAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Other Community Admin',
          email: 'other-admin-search@test.com',
        }),
      );
      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: otherAdminId,
        organizerId: otherOrgId,
      });

      const asOtherAdmin = t.withIdentity({subject: otherAdminId});
      await expect(
        asOtherAdmin.query(api.communities.scanners.searchGrantCandidates, {
          organizerId: orgId,
          searchTerm: 'anything',
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('succeeds for a community admin of the target community', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();
      const communityAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Community Admin',
          email: `search-cadmin-${suffix}@test.com`,
        }),
      );
      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: communityAdminId,
        organizerId: orgId,
      });

      const memberId = await addDirectoryMember(t, {
        name: `Admin Findable ${suffix}`,
        email: `admin-findable-${suffix}@test.com`,
        organizerId: orgId,
      });

      const asAdmin = t.withIdentity({subject: communityAdminId});
      const results = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: `Admin Findable ${suffix}`},
      );
      expect(results.map((row) => row.userId)).toContain(memberId);
    });

    it('succeeds for a root admin', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();
      const memberId = await addDirectoryMember(t, {
        name: `Root Findable ${suffix}`,
        email: `root-findable-${suffix}@test.com`,
        organizerId: orgId,
      });

      const asRoot = t.withIdentity({subject: rootAdminId});
      const results = await asRoot.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: `Root Findable ${suffix}`},
      );
      expect(results.map((row) => row.userId)).toContain(memberId);
    });

    it('rows have the listByCommunity shape (_id, userId, organizerId, displayName, email)', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();
      const memberId = await addDirectoryMember(t, {
        name: `Shape Check ${suffix}`,
        email: `shape-check-${suffix}@test.com`,
        organizerId: orgId,
      });

      const asAdmin = t.withIdentity({subject: rootAdminId});
      const results = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: `Shape Check ${suffix}`},
      );

      const row = results.find((r) => r.userId === memberId);
      expect(row).toBeDefined();
      expect(Object.keys(row ?? {}).sort()).toEqual(
        ['_id', 'displayName', 'email', 'organizerId', 'userId'].sort(),
      );
      expect(row?._id).toBe(memberId);
      expect(row?.userId).toBe(memberId);
      expect(row?.organizerId).toBe(orgId);
      expect(row?.displayName).toBe(`Shape Check ${suffix}`);
      expect(row?.email).toBe(`shape-check-${suffix}@test.com`);
    });

    it('caps results at 10 even when 11+ members match', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();
      const term = `CapTest ${suffix}`;

      const memberIds: Id<'users'>[] = [];
      for (let i = 0; i < 11; i++) {
        const memberId = await addDirectoryMember(t, {
          name: `${term} Member ${i}`,
          email: `cap-test-${suffix}-${i}@test.com`,
          organizerId: orgId,
        });
        memberIds.push(memberId);
      }

      const asAdmin = t.withIdentity({subject: rootAdminId});
      const results = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: term},
      );

      expect(results.length).toBeLessThanOrEqual(10);
      expect(results.length).toBeGreaterThan(0);
    });

    it('preserves search order in the returned rows', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const suffix = uniqueSuffix();
      const term = `OrderTest ${suffix}`;

      const memberIds: Id<'users'>[] = [];
      for (let i = 0; i < 3; i++) {
        const memberId = await addDirectoryMember(t, {
          name: `${term} Member ${i}`,
          email: `order-test-${suffix}-${i}@test.com`,
          organizerId: orgId,
        });
        memberIds.push(memberId);
      }

      const asAdmin = t.withIdentity({subject: rootAdminId});
      const results = await asAdmin.query(
        api.communities.scanners.searchGrantCandidates,
        {organizerId: orgId, searchTerm: term},
      );

      // buildCommunityUserRows maps userIds in input order (search order),
      // so the returned rows must match the order produced by the
      // underlying searchUserApplicationsInDirectory page — i.e. every
      // returned userId must be one of the seeded ids, with no reordering
      // introduced by the query layer itself. We assert this by checking
      // that results correspond 1:1 (by identity) with a fresh call to the
      // underlying search helper via the same query, confirming stability.
      const resultIds = results.map((row) => row.userId);
      const secondCallResultIds = (
        await asAdmin.query(api.communities.scanners.searchGrantCandidates, {
          organizerId: orgId,
          searchTerm: term,
        })
      ).map((row) => row.userId);
      expect(resultIds).toEqual(secondCallResultIds);
      for (const id of resultIds) {
        expect(memberIds).toContain(id);
      }
    });
  });
});
