import {extractErrorMessage} from '@/core/utils/error-message.utils';

/**
 * Extract a user-friendly message from Convex + JS errors.
 *
 * ConvexError carries the user message in `.data` (string or {message}).
 * Some Convex wrappers serialize prefixes into `Error.message`; strip those.
 */
export function cleanErrorMessage(err: unknown, fallback: string): string {
  return extractErrorMessage(err) || fallback;
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
