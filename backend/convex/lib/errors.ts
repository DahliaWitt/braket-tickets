import {ConvexError, type Value} from 'convex/values';
import {isRecord} from '@shared/type-guards';

export const ErrorCodes = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATE: 'INVALID_STATE',
  CONFLICT: 'CONFLICT',
} as const;

export type AppErrorDetails = Record<string, Value | undefined>;
export type AppErrorData = AppErrorDetails & {
  code: string;
  message: string;
};

export const ErrorMessages = {
  UNAUTHENTICATED: 'Unauthenticated',
  UNAUTHORIZED: 'Unauthorized',
  ADMIN_ONLY: 'This action requires administrator privileges',
  NOT_FOUND: (resource: string) => `${resource} not found`,
  ALREADY_EXISTS: (resource: string) => `${resource} already exists`,
  INVALID_INPUT: (field: string, reason?: string) =>
    reason ? `Invalid ${field}: ${reason}` : `Invalid ${field}`,
  INVALID_STATE: (reason: string) => `Cannot perform action: ${reason}`,
  RATE_LIMITED: 'Too many requests. Please try again later',
  SERVER_ERROR: 'An unexpected error occurred. Please try again later',
  PAYMENT_SETUP_INCOMPLETE: 'This organizer has not completed payment setup',
} as const;

/**
 * Builds the canonical structured ConvexError payload.
 *
 * Use this for expected application failures that clients or tests may branch
 * on by `code`. Domain-specific helpers can wrap this, but should not recreate
 * the `{code, message}` shape themselves.
 */
export function appErrorData(
  code: string,
  message: string,
  details: AppErrorDetails = {},
): AppErrorData {
  return {...details, code, message};
}

/**
 * Throws an expected application error with the canonical structured payload.
 *
 * Use the common auth/resource helpers below when callers only need a
 * user-facing message. Use this helper directly for domain-specific
 * application codes such as checkout, invite, or export failures that need
 * custom messages or extra structured fields.
 */
export function throwAppError(
  code: string,
  message: string,
  details?: AppErrorDetails,
): never {
  throw new ConvexError(appErrorData(code, message, details));
}

export function throwUnauthenticated(): never {
  throwAppError(ErrorCodes.UNAUTHENTICATED, ErrorMessages.UNAUTHENTICATED);
}

export function throwUnauthorized(): never {
  throwForbidden(ErrorMessages.UNAUTHORIZED);
}

export function throwForbidden(
  message: string = ErrorMessages.UNAUTHORIZED,
  details?: AppErrorDetails,
): never {
  throwAppError(ErrorCodes.FORBIDDEN, message, details);
}

export function throwAdminOnly(): never {
  throwForbidden(ErrorMessages.ADMIN_ONLY);
}

export function throwNotFound(resource: string): never {
  throwAppError(ErrorCodes.NOT_FOUND, ErrorMessages.NOT_FOUND(resource), {
    resource,
  });
}

export function throwInvalidInput(
  message: string,
  details?: AppErrorDetails,
): never {
  throwAppError(ErrorCodes.INVALID_INPUT, message, details);
}

export function throwInvalidState(
  message: string,
  details?: AppErrorDetails,
): never {
  throwAppError(ErrorCodes.INVALID_STATE, message, details);
}

export function throwConflict(
  message: string,
  details?: AppErrorDetails,
): never {
  throwAppError(ErrorCodes.CONFLICT, message, details);
}

export function getAppErrorMessage(error: unknown): string | null {
  if (error instanceof ConvexError) {
    if (typeof error.data === 'string') return error.data;
    if (isRecord(error.data) && typeof error.data['message'] === 'string') {
      return error.data['message'];
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return null;
}

/**
 * Extracts the structured `code` from a ConvexError payload built by
 * {@link appErrorData}. Symmetric companion to {@link getAppErrorMessage},
 * which only surfaces the human-readable message and discards the code.
 *
 * The `code` is the stable, machine-branchable field: callers (including the
 * frontend, which receives it via `error.data.code`) should prefer it over
 * substring-matching the message, whose wording can change without notice.
 */
export function getAppErrorCode(error: unknown): string | null {
  if (
    error instanceof ConvexError &&
    isRecord(error.data) &&
    typeof error.data['code'] === 'string'
  ) {
    return error.data['code'];
  }

  return null;
}
