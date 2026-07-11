import {v} from 'convex/values';
import {GenericDatabaseWriter} from 'convex/server';
import type {DataModel} from '../_generated/dataModel';
import {internalMutation, internalQuery} from '../_generated/server';
import {authz} from '../lib/authz';
import {adapterFindOne, adapterUpdateOne} from '../lib/better_auth_adapter';
import {userProfileValidator} from '../lib/users/validators';
import {testingMutation, testingQuery} from './wrappers';
import {addSeedMembership} from './communities';
import {insertSeedApplication} from './applications';

/**
 * Shared logic for mirroring Better Auth email verification into the app's
 * users table.
 */
export async function verifyUserLogic(
  db: GenericDatabaseWriter<DataModel>,
  email: string,
) {
  const user = await db
    .query('users')
    .withIndex('email', (q) => q.eq('email', email))
    .unique();

  if (user) {
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Bootstrap: auth state setup */
    await db.patch('users', user._id, {
      authEmailVerified: true,
      emailVerificationTime: user.emailVerificationTime ?? Date.now(),
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  }
}

// Better Auth writes can lag briefly under parallel E2E load.
const BETTER_AUTH_SEED_LOOKUP_DELAYS_MS = [
  0, 50, 125, 250, 500, 1000, 2000, 4000,
] as const;

export function getBetterAuthRecordId(
  record: Record<string, unknown> | null | undefined,
): string | undefined {
  const rawId = record?.['_id'] ?? record?.['id'];
  return typeof rawId === 'string' ? rawId : undefined;
}

export function getBetterAuthUserIdFromResponseBody(
  body: unknown,
): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  const rawUser = (body as Record<string, unknown>)['user'];
  if (typeof rawUser !== 'object' || rawUser === null) {
    return undefined;
  }

  return getBetterAuthRecordId(rawUser as Record<string, unknown>);
}

export async function findBetterAuthUserByEmailWithRetry(
  ctx: Parameters<typeof adapterFindOne>[0],
  email: string,
): Promise<Record<string, unknown> | null> {
  const normalizedEmail = email.trim().toLowerCase();

  for (const delayMs of BETTER_AUTH_SEED_LOOKUP_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const authUser = await adapterFindOne(ctx, {
      model: 'user',
      where: [{field: 'email', operator: 'eq', value: normalizedEmail}],
    });

    if (authUser) {
      return authUser;
    }
  }

  return null;
}

/**
 * Mirrors a Better Auth email verification event into the app's users table
 * and optionally updates the Better Auth user record itself.
 *
 * Used to bypass verification requirements in tests after a signUp.
 */
export const verifyAccountAndUser = testingMutation({
  args: {
    email: v.string(),
    verifyBetterAuth: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, {email, verifyBetterAuth}) => {
    // Only allow in test mode
    if (process.env['IS_TEST'] === undefined) {
      throw new Error(
        'Calling a test only function in an unexpected environment',
      );
    }

    // 1. Update app's users table if the user exists.
    await verifyUserLogic(ctx.db, email);

    // 2. Update Better Auth's user table (emailVerified is on user, not account).
    // With requireEmailVerification: true, login fails unless the BA user is verified.
    // Pass verifyBetterAuth: false to skip (e.g. for testing the verification gate).
    if (verifyBetterAuth === false) {
      return;
    }

    // BA verification runs by default. Pass verifyBetterAuth: false to skip
    // (e.g. for testing the email verification gate).
    const normalizedEmail = email.trim().toLowerCase();

    const authUser = await adapterFindOne(ctx, {
      model: 'user',
      where: [{field: 'email', operator: 'eq', value: normalizedEmail}],
    });
    const authUserId = authUser?.['_id'];
    if (typeof authUserId !== 'string') {
      return;
    }

    await adapterUpdateOne(ctx, {
      model: 'user',
      where: [{field: '_id', operator: 'eq', value: authUserId}],
      update: {
        emailVerified: true,
        updatedAt: Date.now(),
      },
    });

    return null;
  },
});

export const _verifyAccountAndUserInternal = internalMutation({
  args: {
    email: v.string(),
  },
  returns: v.null(),
  handler: async ({db}, {email}) => {
    await verifyUserLogic(db, email);
    return null;
  },
});

/**
 * Gets a user by email, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const getUserByEmail = testingQuery({
  args: {email: v.string()},
  returns: v.union(userProfileValidator, v.null()),
  handler: async ({db}, {email}) => {
    return await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique();
  },
});

/**
 * Gets a user by email address, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 * Used for E2E test setup.
 */
export const getByEmail = testingQuery({
  args: {email: v.string()},
  returns: v.union(userProfileValidator, v.null()),
  handler: async ({db}, {email}) => {
    return await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .first();
  },
});

/**
 * Creates a user directly in the users table.
 * Used as a workaround when auth library doesn't call createOrUpdateUser callback.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const createUserDirectly = testingMutation({
  args: {
    email: v.string(),
    name: v.string(),
    betterAuthUserId: v.optional(v.string()),
    authEmailVerified: v.optional(v.boolean()),
    termsAcceptedAt: v.optional(v.number()),
    socialSignupCompletionRequired: v.optional(v.boolean()),
    isRootAdmin: v.optional(v.boolean()),
  },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const {db} = ctx;
    const existing = await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', args.email))
      .unique();
    if (existing) {
      if (args.isRootAdmin !== undefined) {
        if (args.isRootAdmin) {
          await authz.assignRole(ctx, existing._id, 'root_admin');
        } else {
          await authz.revokeRole(ctx, existing._id, 'root_admin');
        }
      }
      return existing._id;
    }
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Bootstrap: no user exists for auth context */
    const userId = await db.insert('users', {
      email: args.email,
      name: args.name,
      betterAuthUserId: args.betterAuthUserId,
      authEmailVerified: args.authEmailVerified,
      termsAcceptedAt: args.termsAcceptedAt,
      socialSignupCompletionRequired: args.socialSignupCompletionRequired,
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    if (args.isRootAdmin) {
      await authz.assignRole(ctx, userId, 'root_admin');
    }
    return userId;
  },
});

/**
 * Seeds an app-level user record without going through Better Auth.
 * Useful for E2E cases that need unusual profile shapes, such as a missing name.
 */
export const seedAppUser = testingMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.id('users'),
  handler: async ({db}, {email, name}) => {
    const existing = await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique();
    if (existing) {
      return existing._id;
    }

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Bootstrap: no user exists for auth context
    return await db.insert('users', {
      email,
      name,
      authEmailVerified: true,
    });
  },
});

/**
 * Seeds an app-level user record that has NO email address.
 *
 * The digest-pagination tests need a large population of admins where only a
 * handful have emails, so most admins bail out before `enqueueEmailDelivery`
 * and avoid the convex-test parallel-mutation race. `createUserDirectly` and
 * `seedAppUser` both require an email, and the production signup flow always
 * assigns one, so there is no production mutation that produces an emailless
 * user — this bootstrap-only helper fills that gap.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEmaillessUser = testingMutation({
  args: {
    name: v.string(),
  },
  returns: v.id('users'),
  handler: async ({db}, {name}) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Bootstrap: emailless user has no production signup path
    return await db.insert('users', {name});
  },
});

/**
 * Sets root-admin status for a user, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 * Used for E2E test setup to promote users to root_admin.
 */
export const setRootAdminStatus = testingMutation({
  args: {
    userId: v.id('users'),
    isRootAdmin: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, {userId, isRootAdmin}) => {
    if (isRootAdmin) {
      await authz.assignRole(ctx, userId, 'root_admin');
    } else {
      await authz.revokeRole(ctx, userId, 'root_admin');
    }
    return null;
  },
});

/**
 * Marks a user as approved for a specific organizer community.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const makeUserVetted = testingMutation({
  args: {
    email: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    organizerId: v.id('organizers'),
  },
  returns: v.null(),
  handler: async (ctx, {email, userId, organizerId}) => {
    const {db} = ctx;
    if (!organizerId) {
      throw new Error('makeUserVetted requires organizerId');
    }

    let user;
    if (userId) {
      user = await db.get('users', userId);
    } else if (email) {
      user = await db
        .query('users')
        .withIndex('email', (q) => q.eq('email', email))
        .unique();
    } else {
      throw new Error('makeUserVetted requires either userId or email');
    }

    if (!user) {
      throw new Error(
        `makeUserVetted could not find a user for ${email ?? userId}`,
      );
    }

    // Bounded to one user's applications on one organizer (seed/test code).
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const existingApplications = await db
      .query('applications')
      .withIndex('by_user_status', (q) => q.eq('userId', user._id))
      .filter((q) => q.eq(q.field('organizerId'), organizerId))
      .collect();

    if (existingApplications.length > 0) {
      await Promise.all(
        existingApplications.map((existingApplication) => {
          if (existingApplication.status === 'approved') {
            return Promise.resolve();
          }
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Upsert: patching existing application status
          return db.patch('applications', existingApplication._id, {
            status: 'approved',
            denyReason: undefined,
            reason: undefined,
          });
        }),
      );
      // Derived state: membership + marketing preference for approved applications
      await addSeedMembership(ctx, user._id, organizerId);
      return;
    }

    // No existing application — create one through the seed helper, which
    // handles derived state (membership, marketing preferences) automatically.
    await insertSeedApplication(ctx, {
      userId: user._id,
      organizerId,
      status: 'approved',
      answers: {source: 'testing_functions.makeUserVetted'},
    });

    return null;
  },
});

// Internal helpers for seedUserAndGetTokens to avoid circular reference.
// Exposed as internal* functions so the Node-runtime action can call them
// via ctx.runQuery / ctx.runMutation.
export const _getByEmailInternal = internalQuery({
  args: {email: v.string()},
  returns: v.union(userProfileValidator, v.null()),
  handler: async ({db}, {email}) => {
    return await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .first();
  },
});

export const _createUserDirectlyInternal = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    betterAuthUserId: v.optional(v.string()),
    authEmailVerified: v.optional(v.boolean()),
    termsAcceptedAt: v.optional(v.number()),
    socialSignupCompletionRequired: v.optional(v.boolean()),
  },
  returns: v.id('users'),
  handler: async ({db}, args) => {
    const existing = await db
      .query('users')
      .withIndex('email', (q) => q.eq('email', args.email))
      .unique();
    if (existing) {
      return existing._id;
    }
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Bootstrap: no user exists for auth context
    return await db.insert('users', {
      email: args.email,
      name: args.name,
      betterAuthUserId: args.betterAuthUserId,
      authEmailVerified: args.authEmailVerified,
      termsAcceptedAt: args.termsAcceptedAt,
      socialSignupCompletionRequired: args.socialSignupCompletionRequired,
    });
  },
});
