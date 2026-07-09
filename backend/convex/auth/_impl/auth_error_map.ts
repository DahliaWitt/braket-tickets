import {APIError} from 'better-auth/api';
import {isRecord} from '@shared/type-guards';
import {getAppErrorMessage} from '../../lib/errors';

/**
 * Maps Better Auth `auth.api.*` failures to stable, user-facing copy.
 *
 * Better Auth 1.6.x throws `APIError.from(status, BASE_ERROR_CODES.X)`, which
 * stores a stable machine code (e.g. `FAILED_TO_UNLINK_LAST_ACCOUNT`) on
 * `error.body.code`. The code is guaranteed stable across releases; the
 * human-readable `message` is not — 1.6.1 renamed
 * `CREDENTIAL_ACCOUNT_NOT_FOUND`'s message, for example. Each mapper therefore
 * switches on the machine code FIRST and only falls back to substring matching
 * the (unstable) message for failure paths Better Auth surfaces without a code
 * (`APIError.fromStatus(status, {message})`) or for app-level delivery errors.
 *
 * The verified codes below were read from the installed Better Auth 1.6.23
 * dist, not invented:
 *   - node_modules/@better-auth/core/dist/error/codes.mjs (BASE_ERROR_CODES)
 *   - better-auth/dist/api/routes/account.mjs      (link-social, unlink-account)
 *   - better-auth/dist/api/routes/update-user.mjs  (change-email, set-password)
 *
 * The mapped copy intentionally matches the previous message-substring behavior
 * exactly: this change swaps the detection mechanism, not the wording shown to
 * users. Codes are only special-cased where the equivalent message substring
 * would already have produced that same string; every other code falls through
 * to the substring fallback, preserving the prior default outcome.
 */

/**
 * Returns Better Auth's stable machine error code (`error.body.code`) when the
 * thrown value is a Better Auth {@link APIError} carrying one, else `null`.
 */
export function getBetterAuthErrorCode(error: unknown): string | null {
  if (error instanceof APIError) {
    const body: unknown = error.body;
    if (isRecord(body) && typeof body['code'] === 'string') {
      return body['code'];
    }
  }

  return null;
}

function normalizedMessage(error: unknown): string {
  return (getAppErrorMessage(error) ?? String(error)).toLowerCase();
}

export function mapEmailChangeError(error: unknown): string {
  switch (getBetterAuthErrorCode(error)) {
    case 'CHANGE_EMAIL_DISABLED':
      // Message-substring equivalent: 'disabled'.
      return 'Email change is currently unavailable';
    case 'INVALID_EMAIL':
      // Message-substring equivalent: 'invalid email'.
      return 'Please enter a valid email address';
    default:
      break;
  }

  // Fallback: change-email also fails via `APIError.fromStatus(status,
  // {message})` (e.g. "Email is the same", "Verification email isn't enabled")
  // and via app-level mail-delivery errors — none of which carry a stable
  // machine code. Match the (unstable) message text for these.
  const message = getAppErrorMessage(error) ?? String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('already exists') ||
    normalized.includes('another email')
  ) {
    return 'Email address already in use';
  }

  if (normalized.includes('email is the same')) {
    return 'New email must be different from current email';
  }

  if (normalized.includes('disabled')) {
    return 'Email change is currently unavailable';
  }

  if (
    normalized.includes('smtp') ||
    normalized.includes('resend') ||
    normalized.includes('delivery is required') ||
    normalized.includes('email delivery is not configured')
  ) {
    return 'Email change is currently unavailable';
  }

  if (normalized.includes('invalid email')) {
    return 'Please enter a valid email address';
  }

  return message || 'Failed to request email change';
}

export function mapLinkAccountError(error: unknown): string {
  switch (getBetterAuthErrorCode(error)) {
    case 'SOCIAL_ACCOUNT_ALREADY_LINKED':
    case 'LINKED_ACCOUNT_ALREADY_EXISTS':
      // Message-substring equivalent: 'already linked' / 'already exists'.
      return 'This provider cannot be connected to this account right now.';
    default:
      break;
  }

  const normalized = normalizedMessage(error);

  if (
    normalized.includes('already linked') ||
    normalized.includes('already exists') ||
    normalized.includes('linked to another')
  ) {
    return 'This provider cannot be connected to this account right now.';
  }

  if (
    normalized.includes('disabled') ||
    normalized.includes('invalid provider')
  ) {
    return 'This provider is unavailable right now.';
  }

  return 'Unable to connect provider right now.';
}

export function mapUnlinkAccountError(error: unknown): string {
  if (getBetterAuthErrorCode(error) === 'FAILED_TO_UNLINK_LAST_ACCOUNT') {
    // Message-substring equivalent: 'last account'.
    return 'Cannot remove the last login method.';
  }

  if (normalizedMessage(error).includes('last account')) {
    return 'Cannot remove the last login method.';
  }

  return 'Unable to remove this login method right now.';
}

export function mapSetPasswordError(_error: unknown): string {
  // Every set-password failure code (PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG,
  // PASSWORD_ALREADY_SET) collapses to a single generic message, preserving the
  // prior behavior of returning the same copy regardless of the underlying
  // cause. Kept as a mapper for a uniform catch-site signature.
  return 'Unable to set password right now.';
}
