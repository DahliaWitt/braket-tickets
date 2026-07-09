import {extractErrorMessage} from './error-message.utils';

/**
 * Extracts a clean error message from various error types.
 * Handles ConvexError, standard Error, and string errors.
 * Cleans up nested Convex error formatting.
 */
export {extractErrorMessage};

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
