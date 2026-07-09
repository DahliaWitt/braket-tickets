import {isRecord} from '@shared/type-guards';
import {extractErrorMessage} from './error-message.utils';

/**
 * Detection of Better Auth error conditions from client (BetterFetch) errors.
 *
 * Better Auth 1.6.x tags failures with a stable machine code on the error
 * object (`error.code`, mirrored into nested `error`/`body`/`cause` shapes by
 * the client). The code is stable across releases; the human-readable message
 * is not (1.6.1 renamed several messages). These matchers therefore prefer the
 * machine code and keep substring matching only as a fallback for older or
 * wrapped errors that lack a code.
 *
 * Codes verified against the installed Better Auth 1.6.23 dist
 * (`node_modules/@better-auth/core/dist/error/codes.mjs` plus the sign-up /
 * sign-in route handlers). Preserving the substring fallback keeps behavior a
 * strict superset of the previous message-only matching — no currently-detected
 * error stops being detected.
 */

const MAX_ERROR_VISIT_DEPTH = 5;

/**
 * Walks a Better Auth / BetterFetch error object for its stable machine `code`.
 * Checks the value itself and common nesting points (`error`, `body`, `cause`)
 * up to a bounded depth, returning the first non-empty string code found.
 */
export function extractBetterAuthErrorCode(error: unknown): string | null {
  const visit = (value: unknown, depth: number): string | null => {
    if (
      depth > MAX_ERROR_VISIT_DEPTH ||
      value === null ||
      value === undefined
    ) {
      return null;
    }

    if (isRecord(value)) {
      if (typeof value['code'] === 'string' && value['code'].length > 0) {
        return value['code'];
      }
      for (const key of ['error', 'body', 'cause'] as const) {
        if (value[key] !== undefined) {
          const nested = visit(value[key], depth + 1);
          if (nested) return nested;
        }
      }
      return null;
    }

    if (value instanceof Error && value.cause !== undefined) {
      return visit(value.cause, depth + 1);
    }

    return null;
  };

  return visit(error, 0);
}

/**
 * Collects searchable error text (message + code + statusText, recursively)
 * from a Better Auth error response or a thrown error. Used only as the
 * substring fallback once the machine-code check misses.
 */
export function collectAuthErrorText(error: unknown): string {
  const parts: string[] = [];

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_ERROR_VISIT_DEPTH) return;

    if (isRecord(value)) {
      if (typeof value['message'] === 'string') parts.push(value['message']);
      if (typeof value['code'] === 'string') parts.push(value['code']);
      if (typeof value['statusText'] === 'string') {
        parts.push(value['statusText']);
      }
      // Same nesting points as extractBetterAuthErrorCode, so a code shadowed
      // by an outer non-matching code still surfaces in the fallback text.
      for (const key of ['error', 'body', 'cause'] as const) {
        if (value[key] !== undefined) visit(value[key], depth + 1);
      }
      return;
    }

    if (value instanceof Error) {
      parts.push(value.message);
      if (value.cause !== undefined) visit(value.cause, depth + 1);
      return;
    }

    parts.push(extractErrorMessage(value));
  };

  visit(error, 0);
  return parts.join(' ').toLowerCase();
}

/** Better Auth codes that mean "email must be verified before sign-in". */
const VERIFICATION_REQUIRED_CODES = new Set<string>(['EMAIL_NOT_VERIFIED']);

/**
 * Better Auth codes for a sign-up whose email already belongs to an account.
 * `FAILED_TO_CREATE_USER` is included because a duplicate-email unique-constraint
 * failure surfaces through it on the generic create path.
 */
const DUPLICATE_SIGNUP_CODES = new Set<string>([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'FAILED_TO_CREATE_USER',
]);

export function isVerificationRequiredError(error: unknown): boolean {
  const code = extractBetterAuthErrorCode(error);
  if (code && VERIFICATION_REQUIRED_CODES.has(code)) {
    return true;
  }

  // Fallback for older/wrapped errors without a machine code.
  const text = collectAuthErrorText(error);
  return text.includes('verif') || text.includes('not verified');
}

/**
 * Better Auth code from the haveIBeenPwned plugin: the submitted password
 * appears in a known breach.
 */
const COMPROMISED_PASSWORD_CODES = new Set<string>(['PASSWORD_COMPROMISED']);

/**
 * Returns true when a Better Auth error means the submitted password was
 * found in a known breach (haveIBeenPwned plugin). Safe to surface to the
 * user — it reveals nothing about the account, only about the password.
 */
export function isCompromisedPasswordError(error: unknown): boolean {
  const code = extractBetterAuthErrorCode(error);
  if (code && COMPROMISED_PASSWORD_CODES.has(code)) {
    return true;
  }

  // Fallback for older/wrapped errors without a machine code.
  const text = collectAuthErrorText(error);
  return (
    text.includes('password_compromised') || text.includes('known data breach')
  );
}

export function isDuplicateSignupError(error: unknown): boolean {
  const code = extractBetterAuthErrorCode(error);
  if (code && DUPLICATE_SIGNUP_CODES.has(code)) {
    return true;
  }

  // Fallback for older/wrapped errors without a machine code. Preserves the
  // exact prior anti-enumeration behavior for signup responses.
  const text = collectAuthErrorText(error);
  return (
    text.includes('account with this email already exists') ||
    text.includes('user already exists') ||
    text.includes('already in use') ||
    text.includes('user_already_exists') ||
    text.includes('failed_to_create_user')
  );
}
