import {describe, expect, it} from 'vitest';
import {APIError} from 'better-auth/api';
import {ConvexError} from 'convex/values';
import {
  getBetterAuthErrorCode,
  mapEmailChangeError,
  mapLinkAccountError,
  mapSetPasswordError,
  mapUnlinkAccountError,
} from './auth_error_map';

/**
 * Real Better Auth 1.6.23 codes + messages, read verbatim from
 * node_modules/@better-auth/core/dist/error/codes.mjs. Not invented — these are
 * exactly what `APIError.from(status, BASE_ERROR_CODES.X)` produces at runtime.
 */
const BA = {
  CHANGE_EMAIL_DISABLED: {
    code: 'CHANGE_EMAIL_DISABLED',
    message: 'Change email is disabled',
    status: 'BAD_REQUEST',
  },
  INVALID_EMAIL: {
    code: 'INVALID_EMAIL',
    message: 'Invalid email',
    status: 'BAD_REQUEST',
  },
  SOCIAL_ACCOUNT_ALREADY_LINKED: {
    code: 'SOCIAL_ACCOUNT_ALREADY_LINKED',
    message: 'Social account already linked',
    status: 'BAD_REQUEST',
  },
  LINKED_ACCOUNT_ALREADY_EXISTS: {
    code: 'LINKED_ACCOUNT_ALREADY_EXISTS',
    message: 'Linked account already exists',
    status: 'BAD_REQUEST',
  },
  PROVIDER_NOT_FOUND: {
    code: 'PROVIDER_NOT_FOUND',
    message: 'Provider not found',
    status: 'NOT_FOUND',
  },
  FAILED_TO_UNLINK_LAST_ACCOUNT: {
    code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
    message: "You can't unlink your last account",
    status: 'BAD_REQUEST',
  },
  ACCOUNT_NOT_FOUND: {
    code: 'ACCOUNT_NOT_FOUND',
    message: 'Account not found',
    status: 'BAD_REQUEST',
  },
  PASSWORD_TOO_SHORT: {
    code: 'PASSWORD_TOO_SHORT',
    message: 'Password too short',
    status: 'BAD_REQUEST',
  },
  PASSWORD_ALREADY_SET: {
    code: 'PASSWORD_ALREADY_SET',
    message: 'User already has a password set',
    status: 'BAD_REQUEST',
  },
} as const;

type ApiErrorStatus = Parameters<typeof APIError.from>[0];
type BaEntry = {code: string; message: string; status: ApiErrorStatus};

/** Mirrors better-auth's `APIError.from(status, BASE_ERROR_CODES.X)`. */
function apiError(entry: BaEntry): APIError {
  return APIError.from(entry.status, {
    code: entry.code,
    message: entry.message,
  });
}

/** Mirrors `APIError.fromStatus(status, {message})` — no machine code. */
function apiErrorMessageOnly(message: string): APIError {
  return APIError.fromStatus('BAD_REQUEST', {message});
}

describe('getBetterAuthErrorCode', () => {
  it('extracts the machine code from a Better Auth APIError', () => {
    expect(getBetterAuthErrorCode(apiError(BA.CHANGE_EMAIL_DISABLED))).toBe(
      'CHANGE_EMAIL_DISABLED',
    );
  });

  it('returns null for an APIError thrown without a machine code', () => {
    expect(
      getBetterAuthErrorCode(apiErrorMessageOnly('Email is the same')),
    ).toBe(null);
  });

  it('returns null for non-APIError values', () => {
    expect(getBetterAuthErrorCode(new Error('boom'))).toBe(null);
    expect(
      getBetterAuthErrorCode(new ConvexError({code: 'X', message: 'y'})),
    ).toBe(null);
    expect(getBetterAuthErrorCode('CHANGE_EMAIL_DISABLED')).toBe(null);
    expect(getBetterAuthErrorCode(null)).toBe(null);
  });
});

describe('mapEmailChangeError', () => {
  it('routes CHANGE_EMAIL_DISABLED by machine code', () => {
    expect(mapEmailChangeError(apiError(BA.CHANGE_EMAIL_DISABLED))).toBe(
      'Email change is currently unavailable',
    );
  });

  it('routes INVALID_EMAIL by machine code', () => {
    expect(mapEmailChangeError(apiError(BA.INVALID_EMAIL))).toBe(
      'Please enter a valid email address',
    );
  });

  it('falls back to message substring for code-less "Email is the same"', () => {
    expect(mapEmailChangeError(apiErrorMessageOnly('Email is the same'))).toBe(
      'New email must be different from current email',
    );
  });

  it('preserves prior behavior for app-level delivery failures', () => {
    expect(
      mapEmailChangeError(new Error('Email delivery is not configured')),
    ).toBe('Email change is currently unavailable');
    expect(mapEmailChangeError(new Error('SMTP connection refused'))).toBe(
      'Email change is currently unavailable',
    );
  });

  it('returns the raw message for unmapped code-less failures', () => {
    // Preserved: "Verification email isn't enabled" is not special-cased and
    // must surface verbatim, exactly as before this refactor.
    expect(
      mapEmailChangeError(
        apiErrorMessageOnly("Verification email isn't enabled"),
      ),
    ).toBe("Verification email isn't enabled");
  });
});

describe('mapLinkAccountError', () => {
  it('routes already-linked codes to the connect-blocked message', () => {
    expect(
      mapLinkAccountError(apiError(BA.SOCIAL_ACCOUNT_ALREADY_LINKED)),
    ).toBe('This provider cannot be connected to this account right now.');
    expect(
      mapLinkAccountError(apiError(BA.LINKED_ACCOUNT_ALREADY_EXISTS)),
    ).toBe('This provider cannot be connected to this account right now.');
  });

  it('preserves the prior default for PROVIDER_NOT_FOUND', () => {
    // "Provider not found" matched no substring before, so it fell through to
    // the generic default. Behavior must be unchanged.
    expect(mapLinkAccountError(apiError(BA.PROVIDER_NOT_FOUND))).toBe(
      'Unable to connect provider right now.',
    );
  });

  it('falls back to substrings for code-less failures', () => {
    expect(mapLinkAccountError(new Error('provider is disabled'))).toBe(
      'This provider is unavailable right now.',
    );
    expect(mapLinkAccountError(new Error('account already linked'))).toBe(
      'This provider cannot be connected to this account right now.',
    );
    expect(mapLinkAccountError(new Error('some other failure'))).toBe(
      'Unable to connect provider right now.',
    );
  });
});

describe('mapUnlinkAccountError', () => {
  it('routes FAILED_TO_UNLINK_LAST_ACCOUNT by machine code', () => {
    expect(
      mapUnlinkAccountError(apiError(BA.FAILED_TO_UNLINK_LAST_ACCOUNT)),
    ).toBe('Cannot remove the last login method.');
  });

  it('preserves the prior default for ACCOUNT_NOT_FOUND', () => {
    expect(mapUnlinkAccountError(apiError(BA.ACCOUNT_NOT_FOUND))).toBe(
      'Unable to remove this login method right now.',
    );
  });

  it('falls back to the "last account" substring', () => {
    expect(mapUnlinkAccountError(new Error('cannot unlink last account'))).toBe(
      'Cannot remove the last login method.',
    );
  });
});

describe('mapSetPasswordError', () => {
  it('collapses every set-password code to one generic message', () => {
    expect(mapSetPasswordError(apiError(BA.PASSWORD_TOO_SHORT))).toBe(
      'Unable to set password right now.',
    );
    expect(mapSetPasswordError(apiError(BA.PASSWORD_ALREADY_SET))).toBe(
      'Unable to set password right now.',
    );
    expect(mapSetPasswordError(new Error('anything'))).toBe(
      'Unable to set password right now.',
    );
  });
});
