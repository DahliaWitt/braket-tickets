import {describe, expect, it} from 'vitest';
import {COMPROMISED_PASSWORD_MESSAGE} from '@shared/constants';
import {
  extractBetterAuthErrorCode,
  isCompromisedPasswordError,
  isDuplicateSignupError,
  isVerificationRequiredError,
} from './auth-error-codes';

describe('extractBetterAuthErrorCode', () => {
  it('reads a top-level BetterFetch error code', () => {
    expect(
      extractBetterAuthErrorCode({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'anything',
        status: 403,
      }),
    ).toBe('EMAIL_NOT_VERIFIED');
  });

  it('reads a code nested under error/body/cause', () => {
    expect(
      extractBetterAuthErrorCode({error: {code: 'USER_ALREADY_EXISTS'}}),
    ).toBe('USER_ALREADY_EXISTS');
    expect(
      extractBetterAuthErrorCode({body: {code: 'FAILED_TO_CREATE_USER'}}),
    ).toBe('FAILED_TO_CREATE_USER');
    expect(
      extractBetterAuthErrorCode(
        new Error('wrapper', {cause: {code: 'EMAIL_NOT_VERIFIED'}}),
      ),
    ).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns null when no code is present', () => {
    expect(extractBetterAuthErrorCode({message: 'no code'})).toBeNull();
    expect(extractBetterAuthErrorCode(new Error('plain'))).toBeNull();
    expect(extractBetterAuthErrorCode('string error')).toBeNull();
    expect(extractBetterAuthErrorCode(null)).toBeNull();
  });
});

describe('isVerificationRequiredError', () => {
  it('detects EMAIL_NOT_VERIFIED by machine code', () => {
    expect(
      isVerificationRequiredError({
        code: 'EMAIL_NOT_VERIFIED',
        // Message deliberately unrelated to prove code-first detection.
        message: 'please confirm your address',
      }),
    ).toBe(true);
  });

  it('falls back to message substrings for code-less errors', () => {
    expect(
      isVerificationRequiredError(new Error('Email is not verified')),
    ).toBe(true);
    expect(isVerificationRequiredError({message: 'needs verification'})).toBe(
      true,
    );
  });

  it('is false for unrelated errors', () => {
    expect(isVerificationRequiredError(new Error('network down'))).toBe(false);
    expect(isVerificationRequiredError({code: 'SOME_OTHER_CODE'})).toBe(false);
  });
});

describe('isCompromisedPasswordError', () => {
  it('detects the structured Better Auth error code', () => {
    expect(
      isCompromisedPasswordError({
        status: 400,
        statusText: 'BAD_REQUEST',
        message: 'The password you entered has been compromised.',
        code: 'PASSWORD_COMPROMISED',
      }),
    ).toBe(true);
  });

  it('detects the code on a thrown Error carrying the code property', () => {
    expect(
      isCompromisedPasswordError(
        Object.assign(new Error('Password compromised'), {
          code: 'PASSWORD_COMPROMISED',
        }),
      ),
    ).toBe(true);
  });

  it('detects the code nested in an error cause chain', () => {
    expect(
      isCompromisedPasswordError(
        new Error('Registration failed', {
          cause: {message: 'rejected', code: 'PASSWORD_COMPROMISED'},
        }),
      ),
    ).toBe(true);
  });

  it('falls back to the shared server message when no code survives', () => {
    expect(
      isCompromisedPasswordError(new Error(COMPROMISED_PASSWORD_MESSAGE)),
    ).toBe(true);
  });

  it('ignores unrelated auth errors', () => {
    expect(
      isCompromisedPasswordError({
        status: 400,
        message: 'User already exists',
        code: 'USER_ALREADY_EXISTS',
      }),
    ).toBe(false);
    expect(isCompromisedPasswordError(new Error('Invalid password'))).toBe(
      false,
    );
    expect(isCompromisedPasswordError(null)).toBe(false);
    expect(isCompromisedPasswordError(undefined)).toBe(false);
    expect(isCompromisedPasswordError('PASSWORD_WRONG')).toBe(false);
  });

  it('survives circular cause chains', () => {
    const a: {message: string; cause?: unknown} = {message: 'a'};
    const b: {message: string; cause?: unknown} = {message: 'b', cause: a};
    a.cause = b;
    expect(isCompromisedPasswordError(a)).toBe(false);
  });
});

describe('isDuplicateSignupError', () => {
  it('detects duplicate-signup machine codes', () => {
    for (const code of [
      'USER_ALREADY_EXISTS',
      'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      'FAILED_TO_CREATE_USER',
    ]) {
      expect(isDuplicateSignupError({code, message: 'opaque wording'})).toBe(
        true,
      );
    }
  });

  it('detects a nested BetterFetch duplicate code', () => {
    expect(isDuplicateSignupError({error: {code: 'USER_ALREADY_EXISTS'}})).toBe(
      true,
    );
  });

  it('falls back to legacy message substrings', () => {
    expect(
      isDuplicateSignupError(
        new Error('An account with this email already exists'),
      ),
    ).toBe(true);
    expect(isDuplicateSignupError({message: 'email already in use'})).toBe(
      true,
    );
  });

  it('is false for unrelated errors', () => {
    expect(isDuplicateSignupError(new Error('rate limited'))).toBe(false);
    expect(isDuplicateSignupError({code: 'INVALID_PASSWORD'})).toBe(false);
  });
});
