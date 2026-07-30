import {afterEach, beforeEach, vi} from 'vitest';
import {convexTest as baseConvexTest} from 'convex-test';
import type {TestConvex} from 'convex-test';
import schema from './schema';
import {register as registerRateLimiter} from '@convex-dev/rate-limiter/test';
import resendTest from '@convex-dev/resend/test';
import workpoolTest from '@convex-dev/workpool/test';
import authzTest from '@djpanda/convex-authz/test';

type BaseConvexTest = TestConvex<typeof schema>;

export type ConvexTestInstance = BaseConvexTest & {
  runInComponent: <Output>(
    componentPath: string,
    handler: (ctx: unknown) => Promise<Output>,
  ) => Promise<Output>;
};

/**
 * Wrapper around convexTest that automatically loads the schema and all backend modules.
 *
 * Authentication is handled by mocking the auth module in vitest.setup.ts.
 * The mock uses the identity subject (from withIdentity) to look up users directly.
 *
 * @example
 * const t = convexTest();
 *
 * // Create a user in the database
 * const userId = await t.run(async (ctx) =>
 *   ctx.db.insert('users', { name: 'Test User', email: 'test@example.com' })
 * );
 *
 * // Use withIdentity to authenticate as that user
 * const asUser = t.withIdentity({ subject: userId });
 * await asUser.mutation(api.someFunction, {...});
 */
export const convexTest = (): ConvexTestInstance => {
  const t = baseConvexTest(
    schema,
    import.meta.glob('./**/*.ts'),
  ) as ConvexTestInstance;
  registerRateLimiter(t);
  resendTest.register(t);
  workpoolTest.register(t, 'payoutPool');
  workpoolTest.register(t, 'stripePool');
  authzTest.register(t, 'authz');
  return t;
};

/**
 * Snapshot the current values of the given environment variables so a test
 * can mutate them and restore afterwards with {@link restoreEnv}.
 */
export function snapshotEnv<K extends string>(
  keys: readonly K[],
): Partial<Record<K, string>> {
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]] as const)
      .filter((entry): entry is [K, string] => entry[1] !== undefined),
  ) as Partial<Record<K, string>>;
}

/**
 * Restore environment variables captured by {@link snapshotEnv}: keys absent
 * from the snapshot are deleted, present keys are reset to their old values.
 */
export function restoreEnv<K extends string>(
  keys: readonly K[],
  snapshot: Partial<Record<K, string>>,
): void {
  for (const key of keys) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Timer advance function compatible with workpool components.
 *
 * The workpool mainLoop polls at 100ms segment intervals. Using
 * vi.runAllTimers triggers the 60s recovery cycle infinitely.
 * Advancing by one segment per iteration processes current work
 * without triggering recovery.
 */
export const advanceTimers = () => vi.advanceTimersByTime(100);

/** Max iterations for workpool's multi-step scheduling cycles. */
export const WORKPOOL_MAX_ITERATIONS = 2000;

/**
 * Compatibility wrapper for convex-test where runtime supports an optional
 * max iteration argument but d.ts currently exposes only one parameter.
 */
export const finishAllScheduledFunctions = async (
  t: ReturnType<typeof convexTest>,
  maxIterations = WORKPOOL_MAX_ITERATIONS,
) => {
  type FinishAllWithMaxIterations = (
    advanceTimersFn: () => void,
    maxIterationsArg?: number,
  ) => Promise<void>;

  const finishAllUnknown: unknown = t.finishAllScheduledFunctions;
  if (typeof finishAllUnknown !== 'function') {
    throw new Error('convexTest.finishAllScheduledFunctions is unavailable');
  }

  const finishAll = finishAllUnknown as FinishAllWithMaxIterations;
  await finishAll(advanceTimers, maxIterations);
};

/**
 * Factory for a convexTest() variant that auto-drains scheduled workpool /
 * setTimeout callbacks between tests.
 *
 * Why it exists: some tests still exercise workpool-backed components that
 * register polling timers. If one of those callbacks survives into the next
 * test, convex-test can race its own `_scheduled_functions` bookkeeping and
 * throw teardown-time errors. Using fake timers before the test body ensures
 * newly scheduled callbacks are controlled by `finishAllScheduledFunctions`
 * instead of firing later on the real event loop.
 *
 * Call ONCE at the top of a test file:
 *
 *     const convexTest = createAutoDrainConvexTest();
 *
 * The returned `convexTest()` behaves identically to the base factory, but
 * every instance is registered for drain. The wrapper installs one
 * `beforeEach` and one `afterEach` hook in the calling file's test context.
 */
export const createAutoDrainConvexTest = (): (() => ConvexTestInstance) => {
  const activeTests: ConvexTestInstance[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

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
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  return (): ConvexTestInstance => {
    const t = convexTest();
    activeTests.push(t);
    return t;
  };
};
