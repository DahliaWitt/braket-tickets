/**
 * Vitest Setup for Convex Tests
 *
 * This file runs before all Convex tests and sets up necessary mocks.
 */

import {vi} from 'vitest';
import {internalQuery} from '../_generated/server';
import {throwUnauthenticated} from '../lib/errors';

// Required by testingMutation / testingQuery wrappers in testing/wrappers.ts,
// which call isTestEnvironment() to prevent accidental use outside of tests.
process.env['IS_TEST'] = 'true';
process.env['TOKEN_DIGEST_SECRET'] ??= 'convex-vitest-token-digest-secret';

const CONVEX_TEST_TIMEOUT_SHIM_MARKER = '__braketConvexTestSchedulerShim';
const CONVEX_TEST_SCHEDULER_RACE_FLOOR_MS = -100;

function hasConvexTestSchedulerShim(
  timer: typeof globalThis.setTimeout,
): boolean {
  return Reflect.get(timer, CONVEX_TEST_TIMEOUT_SHIM_MARKER) === true;
}

function isConvexTestSchedulerStack(stack: string | undefined): boolean {
  return stack?.includes('/node_modules/convex-test/dist/index.js') === true;
}

function shouldClampConvexTestSchedulerDelay(
  delay: unknown,
  stack: string | undefined,
): delay is number {
  return (
    typeof delay === 'number' &&
    delay < 0 &&
    delay >= CONVEX_TEST_SCHEDULER_RACE_FLOOR_MS &&
    isConvexTestSchedulerStack(stack)
  );
}

/**
 * Clamp the tiny negative-delay race in convex-test's scheduler.
 *
 * Convex production supports immediate scheduled work via scheduler.runAfter(0),
 * but convex-test stores the scheduled timestamp and then calls Node's
 * setTimeout(scheduledTime - Date.now()). That can become slightly negative by
 * the time setTimeout runs, and @convex-dev/workpool can hit the same race
 * through scheduler.runAt().
 *
 * Keep the shim source- and magnitude-bound so genuine negative timers still
 * surface as Node TimeoutNegativeWarning diagnostics under --trace-warnings.
 */
if (!hasConvexTestSchedulerShim(globalThis.setTimeout)) {
  const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  const setTimeoutShim = ((
    ...args: Parameters<typeof globalThis.setTimeout>
  ) => {
    const [handler, delay] = args;
    if (shouldClampConvexTestSchedulerDelay(delay, new Error().stack)) {
      return originalSetTimeout(handler, 0);
    }

    return originalSetTimeout(...args);
  }) as typeof globalThis.setTimeout;

  Object.defineProperty(setTimeoutShim, CONVEX_TEST_TIMEOUT_SHIM_MARKER, {
    value: true,
  });

  globalThis.setTimeout = setTimeoutShim;
}

/**
 * Suppress unhandled rejection errors from convex-test's scheduler.
 *
 * convex-test doesn't properly handle scheduled functions - when a test
 * schedules work via scheduler.runAfter(), the scheduled function tries
 * to run after the test transaction closes, causing "Write outside of
 * transaction" errors.
 *
 * These are test infrastructure noise, not production bugs.
 */
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (
    message.includes('Write outside of transaction') &&
    message.includes('_scheduled_functions')
  ) {
    // Suppress convex-test scheduler noise
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});

type TestUser = {
  _id: string;
  email?: string;
  name?: string;
};

type TestCtx = {
  auth?: {
    getUserIdentity: () => Promise<{
      subject?: string;
      email?: string;
      name?: string;
    } | null>;
  };
  db?: {
    normalizeId: (table: 'users', id: string) => string | null;
    get: (table: 'users', id: string) => Promise<TestUser | null>;
  };
};

async function getTestUser(ctx: TestCtx): Promise<TestUser | null> {
  if (!ctx.auth || !ctx.db) {
    return null;
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  const userId = ctx.db.normalizeId('users', identity.subject);
  if (!userId) {
    return null;
  }

  return await ctx.db.get('users', userId);
}

async function getTestUserId(ctx: TestCtx): Promise<string | null> {
  const user = await getTestUser(ctx);
  return user?._id ?? null;
}

async function mockRequireUser(ctx: TestCtx): Promise<TestUser> {
  const user = await getTestUser(ctx);
  if (!user) {
    throwUnauthenticated();
  }
  return user;
}

async function mockGetAuthUserInAction(ctx: TestCtx): Promise<TestUser | null> {
  if (!ctx.auth) {
    return null;
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return {
    _id: identity.subject,
    email: identity.email ?? `${identity.subject}@test.local`,
    name: identity.name ?? 'Test User',
  };
}

vi.mock('../lib/auth_helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth_helpers')>();

  return {
    ...actual,
    getAuthUser: getTestUser,
    getAuthUserId: getTestUserId,
    getAuthUserInAction: mockGetAuthUserInAction,
    requireUser: mockRequireUser,
    getAuthUserIdInternal: internalQuery({
      args: {},
      handler: async (ctx) => {
        return await getTestUserId(ctx as unknown as TestCtx);
      },
    }),
  };
});

/**
 * Also mock the Better Auth integration module for any direct authComponent usage.
 */
vi.mock('../lib/better_auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/better_auth')>();

  return {
    ...actual,
    authComponent: {
      ...actual.authComponent,
      safeGetAuthUser: async (ctx: {
        auth?: {
          getUserIdentity: () => Promise<{
            subject?: string;
            email?: string;
            name?: string;
          } | null>;
        };
        db?: {
          normalizeId: (table: 'users', id: string) => string | null;
          get: (table: 'users', id: string) => Promise<unknown>;
        };
      }) => {
        if (!ctx.auth) {
          return null;
        }

        const identity = await ctx.auth.getUserIdentity();
        if (!identity?.subject) {
          return null;
        }

        // For queries/mutations, look up the user in the database
        if (ctx.db) {
          const userId = ctx.db.normalizeId('users', identity.subject);
          const user = userId ? await ctx.db.get('users', userId) : null;
          if (user && typeof user === 'object') {
            return {
              email:
                (user as {email?: string}).email ??
                `${identity.subject}@test.local`,
              name: (user as {name?: string}).name ?? '',
              _id: identity.subject,
            };
          }
        }

        return {
          email: identity.email ?? `${identity.subject}@test.local`,
          name: identity.name ?? 'Test User',
          _id: identity.subject,
        };
      },
      getAuth: async () => {
        return {
          auth: {
            api: {
              changePassword: async () => ({status: true}),
              changeEmail: async (args: {
                body: {newEmail: string; callbackURL?: string};
                headers?: Headers;
              }) => {
                const newEmail = args.body.newEmail.toLowerCase();
                if (newEmail === 'taken@example.com') {
                  throw new Error('User already exists');
                }
                if (newEmail === 'same@example.com') {
                  throw new Error('Email is the same');
                }
                if (newEmail === 'disabled@example.com') {
                  throw new Error('Change email is disabled');
                }
                return {status: true};
              },
            },
          },
          headers: new Headers(),
        };
      },
    },

    createAuth: () => {
      throw new Error('createAuth should not be called in tests');
    },
  };
});
