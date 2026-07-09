import {isRecord} from '@shared/type-guards';
import {extractErrorMessage} from './error-message.utils';

/**
 * Extracts a clean error message from various error types.
 * Handles ConvexError, standard Error, and string errors.
 * Cleans up nested Convex error formatting.
 */
export {extractErrorMessage};

/**
 * Returns true when a Better Auth error means the submitted password was
 * found in a known breach (haveIBeenPwned plugin, PASSWORD_COMPROMISED).
 *
 * Matches on the structured error code first, walking nested causes, and
 * falls back to the server's compromised-password message text so the
 * mapping survives error-wrapping on any surface (signup, password reset).
 */
export function isCompromisedPasswordError(err: unknown): boolean {
  const seen = new Set<unknown>();

  const hasCompromisedCode = (value: unknown): boolean => {
    if (seen.has(value)) return false;
    seen.add(value);

    if (isRecord(value)) {
      if (value['code'] === 'PASSWORD_COMPROMISED') return true;
      return hasCompromisedCode(value['cause']);
    }

    if (value instanceof Error) {
      return hasCompromisedCode(value.cause);
    }

    return false;
  };

  if (hasCompromisedCode(err)) return true;

  const message = extractErrorMessage(err).toLowerCase();
  return (
    message.includes('password_compromised') ||
    message.includes('known data breach')
  );
}

/**
 * Returns true for network/timeout errors that should trigger a retry.
 */
export function isRetryableAuthBackendError(err: unknown): boolean {
  const message = extractErrorMessage(err).toLowerCase();
  return (
    message.includes('function execution timed out') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('503') ||
    message.includes('service unavailable')
  );
}
