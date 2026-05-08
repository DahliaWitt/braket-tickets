import {Workpool} from '@convex-dev/workpool';
import {components} from '../_generated/api';
import {isRecord} from '@shared/type-guards';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const payoutPool = new Workpool(components.payoutPool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 4,
    initialBackoffMs: 5000,
    base: 2,
  },
});

export const stripePool = new Workpool(components.stripePool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 4,
    initialBackoffMs: 1000,
    base: 2,
  },
});

/**
 * Retry with exponential backoff for synchronous action calls.
 * Use for Stripe SDK calls that must return a value.
 *
 * Does NOT retry on client errors (4xx / ConvexError with structured data).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialBackoffMs?: number;
    base?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {},
): Promise<T> {
  const {maxAttempts = 3, initialBackoffMs = 500, base = 2, onRetry} = options;

  const runAttempt = async (attempt: number): Promise<T> => {
    try {
      return await fn();
    } catch (error: unknown) {
      if (isClientError(error)) throw error;
      if (attempt === maxAttempts) throw error;

      const delay = initialBackoffMs * Math.pow(base, attempt - 1);
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      onRetry?.(attempt, error);
      await sleep(delay + jitter);
      return runAttempt(attempt + 1);
    }
  };

  return runAttempt(1);
}

/**
 * Detect client errors that should NOT be retried.
 * - ConvexError with structured data (user-facing validation errors)
 * - Stripe errors with 4xx status codes
 */
function isClientError(error: unknown): boolean {
  if (isRecord(error) && isRecord(error['data'])) {
    return true;
  }

  if (isRecord(error) && typeof error['statusCode'] === 'number') {
    const status = error['statusCode'];
    if (status >= 400 && status < 500) return true;
  }

  return false;
}
