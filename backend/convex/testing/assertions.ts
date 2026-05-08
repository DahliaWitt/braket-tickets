import {isRateLimitError} from '@convex-dev/rate-limiter';
import {ConvexError} from 'convex/values';
import {expect} from 'vitest';
import {ErrorMessages} from '../lib/errors';

/**
 * Assert a thrown ConvexError is the authz UNAUTHORIZED error, not a
 * rate-limit error. Tight shape check so the two error classes cannot
 * alias each other when verifying handler ordering.
 */
export function expectUnauthorizedError(err: unknown): void {
  // Must be a ConvexError and NOT a rate-limit error. The combination tightly
  // distinguishes the authz-UNAUTHORIZED path from the RateLimited path.
  expect(err).toBeInstanceOf(ConvexError);
  expect(isRateLimitError(err)).toBe(false);
  // convex-test serializes ConvexError.data via JSON, so we match on the
  // Error.message string (which contains the original UNAUTHORIZED payload).
  expect((err as Error).message).toContain(ErrorMessages.UNAUTHORIZED);
}
