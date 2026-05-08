import {ConvexError} from 'convex/values';
import {
  extractConvexErrorMessage,
  normalizeRuntimeErrorMessage,
} from '@/core/utils/error-message.utils';

/**
 * Extract a user-friendly message from Convex + JS errors.
 *
 * ConvexError carries the user message in `.data` (string or {message}).
 * Some Convex wrappers serialize prefixes into `Error.message`; strip those.
 */
export function cleanErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;

    // Rate limit errors from @convex-dev/rate-limiter:
    // { kind: 'RateLimited', name: string, retryAfter: number (ms) }
    if (
      typeof data === 'object' &&
      data !== null &&
      'kind' in data &&
      (data as Record<string, unknown>)['kind'] === 'RateLimited'
    ) {
      const retryAfterMs = (data as Record<string, unknown>)['retryAfter'];
      if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
        const minutes = Math.ceil(retryAfterMs / 60000);
        return `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
      }
      return 'Too many requests. Please try again later.';
    }

    const convexMessage = extractConvexErrorMessage(err);
    if (convexMessage !== null) return convexMessage;
    return fallback;
  }

  if (err instanceof Error) {
    const message = normalizeRuntimeErrorMessage(err.message);
    return message || fallback;
  }

  return fallback;
}

export function samePendingEmail(
  first: string | null,
  second: string | null,
): boolean {
  return normalizePendingEmail(first) === normalizePendingEmail(second);
}

function normalizePendingEmail(value: string | null): string | null {
  return value?.trim().toLowerCase() ?? null;
}
