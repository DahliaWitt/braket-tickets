import {convexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {addMember, authz} from '../../lib/authz';
import {rateLimiter} from '../../lib/rate_limits';
import {expectUnauthorizedError} from '../../testing/assertions';

/**
 * Run a mutation expected to reject and return the caught error for tight
 * shape assertions (rate-limit vs authz distinction).
 */
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

describe('community_admins rate limiting', () => {
  /**
   * Seed a caller user with community admin access to the given organizer.
   * Returns the caller ID and an authenticated test client.
   */
  async function setupCallerAsAdmin(
    t: ReturnType<typeof convexTest>,
    orgId: Id<'organizers'>,
    email = 'caller@test.com',
  ) {
    const callerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email}),
    );
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, callerId, 'community_admin', {
        type: 'organizer',
        id: orgId,
      });
      await addMember(ctx, callerId, orgId);
    });
    return {callerId, asCaller: t.withIdentity({subject: callerId})};
  }

  it('grant: rate limited after 10 unique targets in one window', async () => {
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Create 11 target users
    const targetIds = await t.run(async (ctx) => {
      const ids: Id<'users'>[] = [];
      for (let i = 0; i < 11; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ids.push(
          await ctx.db.insert('users', {email: `target-admin-${i}@test.com`}),
        );
      }
      return ids;
    });

    // First 10 grants consume the full rate limit budget
    for (let i = 0; i < 10; i++) {
      await asCaller.mutation(api.communities.admins.grant, {
        userId: targetIds[i],
        organizerId: orgId,
      });
    }

    // 11th grant exceeds the limit
    await expect(
      asCaller.mutation(api.communities.admins.grant, {
        userId: targetIds[10],
        organizerId: orgId,
      }),
    ).rejects.toThrow();
  });

  it('grant: idempotent no-ops do not consume rate-limit budget', async () => {
    // Rate-limit fires only on real role changes. A fully-granted target is a
    // pure no-op; repeated calls return null without touching the limiter, so
    // operators can safely retry a grant without burning budget. See BRA-384
    // for the broader discussion on spam protection at this layer.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'idempotent-admin@test.com'}),
    );

    // First call grants the role (consumes 1 of 10 budget).
    await asCaller.mutation(api.communities.admins.grant, {
      userId: targetId,
      organizerId: orgId,
    });

    // 30 further idempotent calls — all return null, none throw rate-limit.
    // If rate-limit fired on no-ops, the 11th of these would reject.
    for (let i = 0; i < 30; i++) {
      const result = await asCaller.mutation(api.communities.admins.grant, {
        userId: targetId,
        organizerId: orgId,
      });
      expect(result).toBeNull();
    }
  });

  it('revoke: rate limited after 10 revocations in one window', async () => {
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Create 11 target admin rows. Caller's own row remains so the last-admin
    // guard never fires (caller is always present throughout).
    const targetIds = await t.run(async (ctx) => {
      const ids: Id<'users'>[] = [];
      for (let i = 0; i < 11; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        const userId = await ctx.db.insert('users', {
          email: `revoke-target-${i}@test.com`,
        });
        await authz.assignRole(ctx, userId, 'community_admin', {
          type: 'organizer',
          id: orgId,
        });
        await addMember(ctx, userId, orgId);
        ids.push(userId);
      }
      return ids;
    });

    // First 10 revocations consume the full budget
    for (let i = 0; i < 10; i++) {
      await asCaller.mutation(api.communities.admins.revoke, {
        userId: targetIds[i],
        organizerId: orgId,
      });
    }

    // 11th revocation exceeds the limit
    await expect(
      asCaller.mutation(api.communities.admins.revoke, {
        userId: targetIds[10],
        organizerId: orgId,
      }),
    ).rejects.toThrow();
  });

  it('revoke: idempotent no-ops do not consume rate-limit budget', async () => {
    // Rate-limit fires only on real role removals. Revoking a non-admin is a
    // pure no-op; repeated calls return null without touching the limiter.
    // See BRA-384 for the broader discussion on spam protection at this layer.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Target user who is NOT an admin — revoke returns null without rate-limit consume.
    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'nonexistent-admin@test.com'}),
    );

    // 30 idempotent calls — all return null, none throw rate-limit.
    for (let i = 0; i < 30; i++) {
      const result = await asCaller.mutation(api.communities.admins.revoke, {
        userId: targetId,
        organizerId: orgId,
      });
      expect(result).toBeNull();
    }
  });

  it('grant: authz-failing spam leaves rate-limit counter untouched (rollback contract)', async () => {
    // Previously, this test spammed 10 unauthorized calls then asserted the 11th
    // ALSO rejected — a loose check that couldn't distinguish rate-limit from
    // authz. Tightening exposed the actual rollback semantics:
    //
    //   The handler calls rateLimiter.limit(ctx, ...) BEFORE requireManageCommunity.
    //   rateLimiter.limit uses ctx.runMutation on a component function. In Convex,
    //   component writes are transactional with the calling mutation — if authz
    //   then throws UNAUTHORIZED, the rate-limit write is ALSO rolled back.
    //
    // Consequence: spamming the endpoint with an unauthenticated-but-hostile
    // caller does NOT burn rate-limit budget in practice. Every call ends in
    // UNAUTHORIZED, no budget is consumed, and the "rate-limit fires before
    // authz on the N+1th call" invariant is unverifiable from the outside.
    //
    // This test pins the real observable contract: after N authz-failing calls,
    // the rate-limit counter for the outsider's key is untouched (full budget
    // remains). If a future handler change makes rate-limit non-transactional
    // (e.g., via ctx.scheduler) this test will fail loudly, signaling that the
    // stronger rate-limit-before-authz guarantee now applies and the test
    // should be rewritten to assert it.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Test Community'}),
    );
    // Outsider: authenticated, but no admin role on this org.
    const outsiderId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'outsider-admin-spam@test.com'}),
    );
    const asOutsider = t.withIdentity({subject: outsiderId});

    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'spam-target-admin@test.com'}),
    );

    // 10 unauthorized calls each throw authz UNAUTHORIZED (not rate-limit).
    // Shape-check each rejection: the rollback contract means each call looks
    // identical to an authz-first handler, so asserting the NOT-rate-limit
    // shape is load-bearing — a regression that swapped order or made
    // rate-limit non-transactional would flip these to RateLimited.
    for (let i = 0; i < 10; i++) {
      const err = await catchReject(
        asOutsider.mutation(api.communities.admins.grant, {
          userId: targetId,
          organizerId: orgId,
        }),
      );
      expectUnauthorizedError(err);
    }

    // 11th call: still UNAUTHORIZED because the prior 10 rate-limit writes were
    // all rolled back with their outer mutations. The rate-limit budget for
    // this caller is untouched — spam protection on the pure-FORBIDDEN path
    // is not provided by the current handler design.
    const finalErr = await catchReject(
      asOutsider.mutation(api.communities.admins.grant, {
        userId: targetId,
        organizerId: orgId,
      }),
    );
    expectUnauthorizedError(finalErr);

    // Directly verify the rate-limit counter in the component: the outsider's
    // fixed-window bucket must show a full `value` (unused budget). If
    // rate-limit were NOT rolled back, value would be below 0 (the rate-limiter
    // decrements on consume) or the config-defined rate would not match.
    const state = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'grantCommunityAdmin', {key: outsiderId}),
    );
    // Fixed-window initial value equals `rate` (10). A consumed token would
    // decrement this. All 11 spam attempts must have been rolled back.
    expect(state.value).toBe(state.config.rate);
  });
});

describe('community_scanners rate limiting', () => {
  /**
   * Seed a caller user with community admin access to the given organizer
   * (community admins are the ones who can grant/revoke scanner roles).
   */
  async function setupCallerAsAdmin(
    t: ReturnType<typeof convexTest>,
    orgId: Id<'organizers'>,
    email = 'scanner-caller@test.com',
  ) {
    const callerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email}),
    );
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, callerId, 'community_admin', {
        type: 'organizer',
        id: orgId,
      });
      await addMember(ctx, callerId, orgId);
    });
    return {callerId, asCaller: t.withIdentity({subject: callerId})};
  }

  it('grant: rate limited after 20 unique targets in one window', async () => {
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Scanner Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Create 21 target users
    const targetIds = await t.run(async (ctx) => {
      const ids: Id<'users'>[] = [];
      for (let i = 0; i < 21; i++) {
        ids.push(
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
          await ctx.db.insert('users', {email: `target-scanner-${i}@test.com`}),
        );
      }
      return ids;
    });

    // First 20 grants consume the full budget
    for (let i = 0; i < 20; i++) {
      await asCaller.mutation(api.communities.scanners.grant, {
        userId: targetIds[i],
        organizerId: orgId,
      });
    }

    // 21st grant exceeds the limit
    await expect(
      asCaller.mutation(api.communities.scanners.grant, {
        userId: targetIds[20],
        organizerId: orgId,
      }),
    ).rejects.toThrow();
  });

  it('grant: idempotent no-ops do not consume rate-limit budget', async () => {
    // Rate-limit fires only on real role grants. A fully-granted target is a
    // pure no-op; repeated calls return null without touching the limiter.
    // See BRA-384 for the broader discussion on spam protection at this layer.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Scanner Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'idempotent-scanner@test.com'}),
    );

    // First call grants the scanner role (consumes 1 of 20).
    await asCaller.mutation(api.communities.scanners.grant, {
      userId: targetId,
      organizerId: orgId,
    });

    // 50 further idempotent calls — all return null, none throw rate-limit.
    for (let i = 0; i < 50; i++) {
      const result = await asCaller.mutation(api.communities.scanners.grant, {
        userId: targetId,
        organizerId: orgId,
      });
      expect(result).toBeNull();
    }
  });

  it('revoke: rate limited after 20 revocations in one window', async () => {
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Scanner Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Create 21 scanner rows to revoke
    const targetIds = await t.run(async (ctx) => {
      const ids: Id<'users'>[] = [];
      for (let i = 0; i < 21; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        const userId = await ctx.db.insert('users', {
          email: `scanner-revoke-target-${i}@test.com`,
        });
        await authz.assignRole(ctx, userId, 'community_scanner', {
          type: 'organizer',
          id: orgId,
        });
        await addMember(ctx, userId, orgId);
        ids.push(userId);
      }
      return ids;
    });

    // First 20 revocations consume the full budget
    for (let i = 0; i < 20; i++) {
      await asCaller.mutation(api.communities.scanners.revoke, {
        userId: targetIds[i],
        organizerId: orgId,
      });
    }

    // 21st revocation exceeds the limit
    await expect(
      asCaller.mutation(api.communities.scanners.revoke, {
        userId: targetIds[20],
        organizerId: orgId,
      }),
    ).rejects.toThrow();
  });

  it('revoke: idempotent no-ops do not consume rate-limit budget', async () => {
    // Rate-limit fires only on real role removals. Revoking a non-scanner is
    // a pure no-op; repeated calls return null without touching the limiter.
    // See BRA-384 for the broader discussion on spam protection at this layer.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Scanner Community'}),
    );
    const {asCaller} = await setupCallerAsAdmin(t, orgId);

    // Target user who is NOT a scanner — revoke returns null without rate-limit consume.
    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'nonexistent-scanner@test.com'}),
    );

    // 50 idempotent calls — all return null, none throw rate-limit.
    for (let i = 0; i < 50; i++) {
      const result = await asCaller.mutation(api.communities.scanners.revoke, {
        userId: targetId,
        organizerId: orgId,
      });
      expect(result).toBeNull();
    }
  });

  it('grant: authz-failing spam leaves rate-limit counter untouched (rollback contract)', async () => {
    // See community_admins counterpart above for the full rationale: rate-limit
    // writes are transactional with the outer mutation, so authz-UNAUTHORIZED
    // throws roll back the rate-limit consume. The spam-protection intent is
    // not achievable for pure-FORBIDDEN callers with the current handler.
    // This test pins the observable contract and will fail if handler or
    // component semantics change (e.g., ctx.scheduler-based non-transactional
    // rate-limit), signaling that a stronger guarantee now holds.
    const t = convexTest();

    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
      insertOrganizer(ctx, {name: 'Scanner Community'}),
    );
    // Outsider: authenticated, but no admin role on this org.
    const outsiderId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'outsider-scanner-spam@test.com'}),
    );
    const asOutsider = t.withIdentity({subject: outsiderId});

    const targetId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {email: 'spam-target-scanner@test.com'}),
    );

    // 20 unauthorized calls each throw authz UNAUTHORIZED — shape-checked so
    // a regression that swapped ordering or defeated rollback flips the type.
    for (let i = 0; i < 20; i++) {
      const err = await catchReject(
        asOutsider.mutation(api.communities.scanners.grant, {
          userId: targetId,
          organizerId: orgId,
        }),
      );
      expectUnauthorizedError(err);
    }

    // 21st call: still UNAUTHORIZED — budget was never burned because every
    // prior rate-limit write rolled back with its outer mutation.
    const finalErr = await catchReject(
      asOutsider.mutation(api.communities.scanners.grant, {
        userId: targetId,
        organizerId: orgId,
      }),
    );
    expectUnauthorizedError(finalErr);

    // Rate-limit counter is untouched (fixed-window value == configured rate).
    const state = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'grantCommunityScanner', {key: outsiderId}),
    );
    expect(state.value).toBe(state.config.rate);
  });
});
