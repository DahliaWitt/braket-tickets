import {describe, expect, it} from 'vitest';
import {COMPROMISED_PASSWORD_MESSAGE} from '@shared/constants';
import {isCompromisedPasswordError} from './auth.utils';

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
