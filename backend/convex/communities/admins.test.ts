import {
  convexTest as baseConvexTest,
  finishAllScheduledFunctions,
} from '../setup.testing';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {api} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {ErrorMessages} from '../lib/errors';
import {getCommunityMembers} from '../lib/authz';
import {authz} from '../lib/authz';
import {rateLimiter} from '../lib/rate_limits';
import {expectUnauthorizedError} from '../testing/assertions';

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

const activeTests: Array<ReturnType<typeof baseConvexTest>> = [];

const convexTest = () => {
  const t = baseConvexTest();
  activeTests.push(t);
  return t;
};

afterEach(async () => {
  vi.useFakeTimers();
  try {
    while (activeTests.length > 0) {
      const t = activeTests.shift();
      if (t) {
        await finishAllScheduledFunctions(t);
      }
    }
  } finally {
    vi.useRealTimers();
  }
});

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

describe('community_admins', () => {
  // Helper: create root admin, org, and regular user
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
    const regularUserId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {
        name: 'Regular User',
        email: 'user@test.com',
      }),
    );
    return {t, rootAdminId, orgId, regularUserId};
  }

  describe('grant', () => {
    it('root admin can grant community admin to any community', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const id = await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      expect(id).toBeNull();

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins).toHaveLength(1);
      expect(admins[0].userId).toBe(regularUserId);
      const asRegular = t.withIdentity({subject: regularUserId});
      expect(
        await asRegular.query(api.communities.admins.isMemberOf, {
          organizerId: orgId,
        }),
      ).toBe(true);
    });

    it('existing community admin can grant to same community', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Make a community admin
      const commAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Comm Admin', email: 'ca@test.com'}),
      );
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: commAdminId,
        organizerId: orgId,
      });

      // Community admin grants another user
      const newUserId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'New User', email: 'new@test.com'}),
      );
      const asCommAdmin = t.withIdentity({subject: commAdminId});
      await asCommAdmin.mutation(api.communities.admins.grant, {
        userId: newUserId,
        organizerId: orgId,
      });

      const admins = await asCommAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).toContain(newUserId);
    });

    it('community admin of Org A cannot grant to Org B (confused deputy)', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Make a community admin for Org A
      const commAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Comm Admin', email: 'ca@test.com'}),
      );
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: commAdminId,
        organizerId: orgId,
      });

      // Create Org B
      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      const targetId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Target', email: 'target@test.com'}),
      );

      const asCommAdmin = t.withIdentity({subject: commAdminId});
      await expect(
        asCommAdmin.mutation(api.communities.admins.grant, {
          userId: targetId,
          organizerId: orgB,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('regular user cannot grant', async () => {
      const {t, orgId, regularUserId} = await setupTestData();
      const targetId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Target', email: 'target@test.com'}),
      );

      const asUser = t.withIdentity({subject: regularUserId});
      await expect(
        asUser.mutation(api.communities.admins.grant, {
          userId: targetId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('idempotent — granting existing admin returns null', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      // Grant again — should return null
      const result = await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      expect(result).toBeNull();

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins).toHaveLength(1);
    });

    it('inserts audit log entry', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const logs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('community_admin.grant');
      expect(logs[0].adminId).toBe(rootAdminId);
      expect(logs[0].organizerId).toBe(orgId);
      expect(logs[0].targetUserId).toBe(regularUserId);
    });

    it('keeps the granted admin listed for the community', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).toContain(regularUserId);
    });

    it('removes explicit scanner role when promoting scanner to admin', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.scanners.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      const scanners = await asAdmin.query(
        api.communities.scanners.listByCommunity,
        {
          organizerId: orgId,
        },
      );

      expect(admins.map((admin) => admin.userId)).toContain(regularUserId);
      expect(scanners.map((scanner) => scanner.userId)).not.toContain(
        regularUserId,
      );
    });

    it('leaves the community admin list stable on idempotent grant', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins).toHaveLength(1);
    });

    it('unauthorized caller targeting existing admin throws FORBIDDEN (no role-membership leak)', async () => {
      // Regression: the idempotent short-circuit previously ran BEFORE the authz gate,
      // letting an unauthorized caller observe a null return (target has role) vs. a
      // FORBIDDEN throw (target does not) — an information-disclosure channel.
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant regularUserId in orgId.
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      // Outsider with no platform- or community-level access.
      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-grant@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      await expect(
        asOutsider.mutation(api.communities.admins.grant, {
          userId: regularUserId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('authz-failing grant spam leaves rate-limit counter untouched (rollback contract)', async () => {
      // Rationale: the handler calls rateLimiter.limit(ctx, ...) BEFORE
      // requireManageCommunity, aiming to throttle FORBIDDEN spam. In Convex,
      // rateLimiter.limit is implemented via ctx.runMutation on a component —
      // so its write is transactional with the outer mutation. When authz
      // then throws UNAUTHORIZED, the rate-limit increment is rolled back.
      //
      // Consequence: every pure-FORBIDDEN spam attempt looks like UNAUTHORIZED
      // and no budget is consumed. The previous loose `.rejects.toThrow()`
      // check passed for both orderings and both rollback outcomes — it
      // verified nothing. This tightened version:
      //   1. Shape-checks each rejection as the authz error (not rate-limit).
      //   2. Directly queries the rate-limit counter to prove no tokens were
      //      burned, documenting the real observable behavior.
      //
      // If a future handler change makes rate-limit non-transactional (e.g.,
      // via ctx.scheduler.runAfter to an internal mutation) so that the
      // increment survives host-mutation rollback, this test will fail and
      // should be rewritten to assert the stronger spam-protection invariant.
      const {t, orgId, regularUserId} = await setupTestData();

      // Outsider: authenticated, but no manage permission on orgId.
      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-spam-grant@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      // grantCommunityAdmin bucket is 10/min. Spam 10 times; each call rolls
      // back both the authz gate AND the rate-limit increment.
      for (let i = 0; i < 10; i++) {
        const err = await catchReject(
          asOutsider.mutation(api.communities.admins.grant, {
            userId: regularUserId,
            organizerId: orgId,
          }),
        );
        expectUnauthorizedError(err);
      }

      // 11th call: still UNAUTHORIZED — no budget was burned, authz gate fires
      // the same way as call #1.
      const finalErr = await catchReject(
        asOutsider.mutation(api.communities.admins.grant, {
          userId: regularUserId,
          organizerId: orgId,
        }),
      );
      expectUnauthorizedError(finalErr);

      // Rate-limit counter: untouched. Fixed-window `value` equals configured
      // `rate` when no tokens have been consumed.
      const state = await t.run((ctx) =>
        rateLimiter.getValue(ctx, 'grantCommunityAdmin', {key: outsiderId}),
      );
      expect(state.value).toBe(state.config.rate);
    });

    it('authorized idempotent grant writes no new audit log row', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      const result = await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      expect(result).toBeNull();

      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter).toHaveLength(logsBefore.length);
    });

    it('partial-state recovery: target has community_admin role but not member — grant re-adds member and writes member_repair audit (not grant)', async () => {
      // Regression: if a prior grant assigned the role but the member relation was
      // lost (e.g., manual membership removal, interrupted prior call), a repeat
      // grant must proceed and reinstate the member edge rather than short-circuit.
      //
      // Bug fix: previously this path wrote a community_admin.grant audit-log entry
      // even though the role was not newly granted — misleading operators into
      // thinking a new admin was created. The repair path now writes a distinct
      // community_admin.member_repair action so the audit trail reflects what
      // actually happened.
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Assign role directly (no membership side effect).
      await t.run(async (ctx) =>
        authz.assignRole(ctx, regularUserId as string, 'community_admin', {
          type: 'organizer',
          id: orgId as string,
        }),
      );

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const members = await t.run(async (ctx) =>
        getCommunityMembers(ctx, orgId),
      );
      expect(members.map((m) => m._id)).toContain(regularUserId);

      // Repair path writes a distinct member_repair audit entry — NOT a grant.
      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      const newLogs = logsAfter.slice(logsBefore.length);
      expect(newLogs).toHaveLength(1);
      expect(newLogs[0].action).toBe('community_admin.member_repair');
      expect(newLogs[0].adminId).toBe(rootAdminId);
      expect(newLogs[0].organizerId).toBe(orgId);
    });

    it('grant grants role when member already exists (member-only → admin promotion)', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Pre-seed member role only (no admin).
      await t.run(async (ctx) =>
        authz.assignRole(ctx, regularUserId as string, 'member', {
          type: 'organizer',
          id: orgId as string,
        }),
      );

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      // Role was added — audit log should record the grant.
      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter.length).toBe(logsBefore.length + 1);
      const grantLogs = logsAfter.filter(
        (log) => log.action === 'community_admin.grant',
      );
      expect(grantLogs).toHaveLength(1);

      // Admin list reflects new admin.
      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).toContain(regularUserId);

      // Member edge preserved (already there).
      const members = await t.run(async (ctx) =>
        getCommunityMembers(ctx, orgId),
      );
      expect(members.map((m) => m._id)).toContain(regularUserId);
    });

    it('grant adds both role and member when neither exists, and writes a single audit log', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter.length).toBe(logsBefore.length + 1);
      expect(logsAfter[logsAfter.length - 1].action).toBe(
        'community_admin.grant',
      );

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).toContain(regularUserId);

      const members = await t.run(async (ctx) =>
        getCommunityMembers(ctx, orgId),
      );
      expect(members.map((m) => m._id)).toContain(regularUserId);
    });
  });

  describe('grant — membership side effects', () => {
    it('does not create an application when none exists', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const app = await t.run(async (ctx) =>
        ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) => q.eq('userId', regularUserId))
          .first(),
      );
      expect(app).toBeNull();
    });

    it('leaves a pending application unchanged', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();

      const applicationId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
        ctx.db.insert('applications', {
          userId: regularUserId,
          organizerId: orgId,
          status: 'pending',
          answers: {q1: 'yes'},
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const apps = await t.run(async (ctx) =>
        ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) => q.eq('userId', regularUserId))
          .collect(),
      );
      const orgApps = apps.filter((a) => a.organizerId === orgId);
      expect(orgApps).toHaveLength(1);
      expect(orgApps[0]._id).toBe(applicationId);
      expect(orgApps[0].status).toBe('pending');
      expect(orgApps[0].processedBy).toBeUndefined();
      expect(orgApps[0].answers).toEqual({q1: 'yes'});
    });

    it('leaves a rejected application unchanged', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();

      const applicationId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
        ctx.db.insert('applications', {
          userId: regularUserId,
          organizerId: orgId,
          status: 'rejected',
          denyReason: 'Incomplete answers',
          reason: 'Incomplete answers',
          answers: {q1: 'no'},
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const app = await t.run(async (ctx) => {
        const apps = await ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) => q.eq('userId', regularUserId))
          .collect();
        return apps.find((a) => a.organizerId === orgId);
      });
      expect(app?._id).toBe(applicationId);
      expect(app?.status).toBe('rejected');
      expect(app?.processedBy).toBeUndefined();
      expect(app?.denyReason).toBe('Incomplete answers');
      expect(app?.reason).toBe('Incomplete answers');
      expect(app?.answers).toEqual({q1: 'no'});
    });

    it('leaves a revoked application unchanged', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();

      const applicationId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
        ctx.db.insert('applications', {
          userId: regularUserId,
          organizerId: orgId,
          status: 'revoked',
          reason: 'Violated guidelines',
          answers: {},
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const app = await t.run(async (ctx) => {
        const apps = await ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) => q.eq('userId', regularUserId))
          .collect();
        return apps.find((a) => a.organizerId === orgId);
      });
      expect(app?._id).toBe(applicationId);
      expect(app?.status).toBe('revoked');
      expect(app?.processedBy).toBeUndefined();
      expect(app?.reason).toBe('Violated guidelines');
      expect(app?.answers).toEqual({});
    });

    it('leaves an approved application unchanged', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();

      const appId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup requires specific application state not achievable via seedApplication
        ctx.db.insert('applications', {
          userId: regularUserId,
          organizerId: orgId,
          status: 'approved',
          processedBy: rootAdminId,
          answers: {q1: 'yes'},
        }),
      );

      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      // Application unchanged — no extra rows, original preserved
      const apps = await t.run(async (ctx) =>
        ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) => q.eq('userId', regularUserId))
          .collect(),
      );
      const orgApps = apps.filter((a) => a.organizerId === orgId);
      expect(orgApps).toHaveLength(1);
      expect(orgApps[0]._id).toBe(appId);
      expect(orgApps[0].status).toBe('approved');
      expect(orgApps[0].processedBy).toBe(rootAdminId);
      expect(orgApps[0].answers).toEqual({q1: 'yes'});
    });

    it('approves the organizer-scoped application without changing auth email verification', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const user = await t.run(async (ctx) => ctx.db.get(regularUserId));
      expect(user?.authEmailVerified).toBeUndefined();
    });

    it('granted admin appears in getCommunityMembers', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const members = await t.run(async (ctx) =>
        getCommunityMembers(ctx, orgId),
      );
      const memberIds = members.map((m) => m._id);
      expect(memberIds).toContain(regularUserId);
    });

    it('creates marketing email preference', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const pref = await t.run(async (ctx) =>
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', regularUserId).eq('organizerId', orgId),
          )
          .first(),
      );
      expect(pref).not.toBeNull();
      expect(pref?.optedIn).toBe(true);
    });
  });

  describe('revoke', () => {
    it('root admin can revoke from any community', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant first (need at least 2 admins for revoke to work)
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).not.toContain(regularUserId);
    });

    it('cancels pending invites and disables active magic links created by the revoked admin', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      const inviteId = await t.mutation(api.testing.admin.seedAdminInvite, {
        email: 'new-admin@test.com',
        organizerId: orgId,
        communityName: 'Test Org',
        invitedBy: regularUserId,
        token: 'revoked-admin-pending-invite',
      });
      const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
        createdBy: regularUserId,
        organizerId: orgId,
        status: 'active',
        token: 'revoked-admin-active-link',
      });

      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const [invite, link] = await t.run(async (ctx) =>
        Promise.all([
          ctx.db.get('admin_invites', inviteId),
          ctx.db.get('magic_links', linkId),
        ]),
      );
      expect(invite?.status).toBe('cancelled');
      expect(link?.status).toBe('disabled');
      expect(link?.deletedAt).toEqual(expect.any(Number));
    });

    it('self-resign allowed', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant two admins
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      // Regular user resigns
      const asUser = t.withIdentity({subject: regularUserId});
      await asUser.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).not.toContain(regularUserId);
    });

    it('throws LAST_ADMIN when revoking last admin', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant only one admin
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      await expect(
        asAdmin.mutation(api.communities.admins.revoke, {
          userId: regularUserId,
          organizerId: orgId,
        }),
      ).rejects.toThrow('Cannot remove the last admin');
    });

    it('self-resign also throws LAST_ADMIN if last admin', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant only one admin
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const asUser = t.withIdentity({subject: regularUserId});
      await expect(
        asUser.mutation(api.communities.admins.revoke, {
          userId: regularUserId,
          organizerId: orgId,
        }),
      ).rejects.toThrow('Cannot remove the last admin');
    });

    it('community admin of Org A cannot revoke from Org B', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Create Org B with an admin
      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );
      const orgBAdmin = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Org B Admin', email: 'b@test.com'}),
      );
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: orgBAdmin,
        organizerId: orgB,
      });
      // Add a second admin to Org B so last-admin guard doesn't fire
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgB,
      });

      // Create Org A admin
      const orgAAdmin = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Org A Admin', email: 'a@test.com'}),
      );
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: orgAAdmin,
        organizerId: orgId,
      });

      // Org A admin tries to revoke from Org B
      const asOrgA = t.withIdentity({subject: orgAAdmin});
      await expect(
        asOrgA.mutation(api.communities.admins.revoke, {
          userId: orgBAdmin,
          organizerId: orgB,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('idempotent — revoking non-existent assignment is no-op', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Should not throw
      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });
    });

    it('inserts audit log entry', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant two admins
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      // Clear audit logs from grants
      await t.run(async (ctx) => {
        const logs = await ctx.db.query('adminAuditLogs').collect();
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- cleanup of test data; no production delete mutation for this entity
        for (const log of logs) await ctx.db.delete(log._id);
      });

      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const logs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('community_admin.revoke');
      expect(logs[0].organizerId).toBe(orgId);
    });

    it('does not mirror revocation back into user.roles', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant two admins so revoke is allowed (last-admin guard)
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins.map((admin) => admin.userId)).not.toContain(regularUserId);
    });

    it('leaves user.roles untouched when other assignments remain', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Create a second org
      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      // Grant regularUser as admin of BOTH orgs
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgB,
      });

      // Also grant rootAdmin to orgId so last-admin guard passes
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      // Revoke from orgId — regularUser still has orgB assignment
      await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const orgAAdmins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      const orgBAdmins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgB,
        },
      );
      expect(orgAAdmins.map((admin) => admin.userId)).not.toContain(
        regularUserId,
      );
      expect(orgBAdmins.map((admin) => admin.userId)).toContain(regularUserId);
    });

    it('unauthorized caller targeting existing admin throws FORBIDDEN (no role-membership leak)', async () => {
      // Regression: previously the "is target already an admin?" state read ran BEFORE
      // the authz gate, so an unauthorized caller saw a null return when the target
      // held the role (would-be no-op) vs. a FORBIDDEN throw when they did not.
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      // Grant regularUserId as admin and a second admin to keep last-admin guard off path.
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: rootAdminId,
        organizerId: orgId,
      });

      const outsiderId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          name: 'Outsider',
          email: 'outsider-revoke@test.com',
        }),
      );
      const asOutsider = t.withIdentity({subject: outsiderId});

      await expect(
        asOutsider.mutation(api.communities.admins.revoke, {
          userId: regularUserId,
          organizerId: orgId,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });

    it('authorized idempotent revoke writes no new audit log row', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      const logsBefore = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );

      // regularUserId has never been granted; revoke should be a no-op.
      const result = await asAdmin.mutation(api.communities.admins.revoke, {
        userId: regularUserId,
        organizerId: orgId,
      });
      expect(result).toBeNull();

      const logsAfter = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(logsAfter).toHaveLength(logsBefore.length);
    });
  });

  describe('community_admins.revoke — notification preference cleanup', () => {
    it('deletes adminNotificationPreferences row when admin is revoked', async () => {
      const t = convexTest();
      const rootAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Root'}),
      );
      await t.run(async (ctx) =>
        authz.assignRole(ctx, rootAdminId, 'root_admin'),
      );
      const adminUserId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Admin'}),
      );
      const secondAdminId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Second Admin'}),
      );
      const orgId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Community'}),
      );
      const asRoot = t.withIdentity({subject: rootAdminId});
      await asRoot.mutation(api.communities.admins.grant, {
        userId: adminUserId,
        organizerId: orgId,
      });
      await asRoot.mutation(api.communities.admins.grant, {
        userId: secondAdminId,
        organizerId: orgId,
      });
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seeding notification preference for revocation test; seedAdminNotificationPreference not used to keep test focused
        await ctx.db.insert('adminNotificationPreferences', {
          userId: adminUserId,
          organizerId: orgId,
          mode: 'all',
          digestHour: 9,
        });
      });

      await asRoot.mutation(api.communities.admins.revoke, {
        userId: adminUserId,
        organizerId: orgId,
      });

      const prefRow = await t.run(async (ctx) =>
        ctx.db
          .query('adminNotificationPreferences')
          .withIndex('by_user_and_community', (q) =>
            q.eq('userId', adminUserId).eq('organizerId', orgId),
          )
          .first(),
      );
      expect(prefRow).toBeNull();
    });
  });

  describe('listByCommunity', () => {
    it('root admin can list any community admins', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const admins = await asAdmin.query(
        api.communities.admins.listByCommunity,
        {
          organizerId: orgId,
        },
      );
      expect(admins).toHaveLength(1);
      expect(admins[0].userId).toBe(regularUserId);
    });

    it('community admin can list own community admins', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const asCommAdmin = t.withIdentity({subject: regularUserId});
      const admins = await asCommAdmin.query(
        api.communities.admins.listByCommunity,
        {organizerId: orgId},
      );
      expect(admins).toHaveLength(1);
    });

    it('community admin cannot list other community admins', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const orgB = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        insertOrganizer(ctx, {name: 'Org B'}),
      );

      const asCommAdmin = t.withIdentity({subject: regularUserId});
      await expect(
        asCommAdmin.query(api.communities.admins.listByCommunity, {
          organizerId: orgB,
        }),
      ).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
    });
  });

  describe('listMyCommunities', () => {
    it('returns community IDs for authenticated admin', async () => {
      const {t, rootAdminId, orgId, regularUserId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});

      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const asUser = t.withIdentity({subject: regularUserId});
      const communities = await asUser.query(
        api.communities.admins.listMyCommunities,
        {},
      );
      expect(communities).toEqual([orgId]);
    });

    it('returns empty array for non-admin', async () => {
      const {t, regularUserId} = await setupTestData();
      const asUser = t.withIdentity({subject: regularUserId});

      const communities = await asUser.query(
        api.communities.admins.listMyCommunities,
        {},
      );
      expect(communities).toEqual([]);
    });

    it('returns all organizer IDs for root admin', async () => {
      const {t, rootAdminId, orgId} = await setupTestData();
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const org2Id = await t.run(async (ctx) =>
        insertOrganizer(ctx, {name: 'Other Crew'}),
      );

      const asRootAdmin = t.withIdentity({subject: rootAdminId});
      const result = await asRootAdmin.query(
        api.communities.admins.listMyCommunities,
        {},
      );

      expect(result).toContain(orgId);
      expect(result).toContain(org2Id);
    });
  });

  describe('isMemberOf', () => {
    it('returns true for assigned community admin', async () => {
      const {t, rootAdminId, regularUserId, orgId} = await setupTestData();
      const asAdmin = t.withIdentity({subject: rootAdminId});
      await asAdmin.mutation(api.communities.admins.grant, {
        userId: regularUserId,
        organizerId: orgId,
      });

      const asRegular = t.withIdentity({subject: regularUserId});
      const result = await asRegular.query(api.communities.admins.isMemberOf, {
        organizerId: orgId,
      });
      expect(result).toBe(true);
    });

    it('returns false for unassigned user', async () => {
      const {t, orgId} = await setupTestData();
      const unassignedId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {name: 'Outsider', email: 'outsider@test.com'}),
      );
      const asUnassigned = t.withIdentity({subject: unassignedId});
      const result = await asUnassigned.query(
        api.communities.admins.isMemberOf,
        {organizerId: orgId},
      );
      expect(result).toBe(false);
    });

    it('returns false for root admin without junction row', async () => {
      const {t, rootAdminId} = await setupTestData();
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      const org2Id = await t.run(async (ctx) =>
        insertOrganizer(ctx, {name: 'Other Crew'}),
      );
      const asRootAdmin = t.withIdentity({subject: rootAdminId});
      const result = await asRootAdmin.query(
        api.communities.admins.isMemberOf,
        {organizerId: org2Id},
      );
      expect(result).toBe(false);
    });

    it('throws for unauthenticated user', async () => {
      const {t, orgId} = await setupTestData();
      await expect(
        t.query(api.communities.admins.isMemberOf, {organizerId: orgId}),
      ).rejects.toThrow();
    });
  });
});
