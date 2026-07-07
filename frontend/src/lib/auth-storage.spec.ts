import {describe, expect, it} from 'vitest';
import {
  authCookieStorageKey,
  authSessionDataStorageKey,
  BETTER_AUTH_STORAGE_PREFIX,
  interpretAuthStorage,
} from './auth-storage';

const cookieWithToken = JSON.stringify({
  'braket-tickets.session_token': {value: 'abc', expires: null},
});
const sessionSnapshot = JSON.stringify({
  user: {email: 'buyer@example.com', name: 'Buyer'},
  session: {id: 'sess_1'},
});

describe('storage key helpers', () => {
  it('derive keys from the shared prefix', () => {
    expect(authCookieStorageKey()).toBe(`${BETTER_AUTH_STORAGE_PREFIX}_cookie`);
    expect(authSessionDataStorageKey()).toBe(
      `${BETTER_AUTH_STORAGE_PREFIX}_session_data`,
    );
  });
});

describe('interpretAuthStorage', () => {
  it('treats an absent credential as a known logged-out state', () => {
    expect(interpretAuthStorage(null, null)).toEqual({
      known: true,
      hasCredential: false,
      session: null,
    });
  });

  it('treats the {} logout sentinel as a known logged-out state', () => {
    expect(interpretAuthStorage('{}', null)).toEqual({
      known: true,
      hasCredential: false,
      session: null,
    });
  });

  it('reports a present credential as known + hasCredential', () => {
    const peek = interpretAuthStorage(cookieWithToken, null);
    expect(peek.known).toBe(true);
    expect(peek.hasCredential).toBe(true);
    expect(peek.session).toBeNull();
  });

  it('parses the cached session snapshot when a credential is present', () => {
    const peek = interpretAuthStorage(cookieWithToken, sessionSnapshot);
    expect(peek.hasCredential).toBe(true);
    expect(peek.session).toEqual({
      user: {email: 'buyer@example.com', name: 'Buyer'},
      session: {id: 'sess_1'},
    });
  });

  it('returns not-known on a corrupted credential rather than guessing', () => {
    expect(interpretAuthStorage('{not json', null)).toEqual({
      known: false,
      hasCredential: false,
      session: null,
    });
  });

  it('returns not-known when the credential JSON is not an object', () => {
    expect(interpretAuthStorage('"a string"', null).known).toBe(false);
    expect(interpretAuthStorage('42', null).known).toBe(false);
  });

  it('ignores a malformed session snapshot but still trusts the credential', () => {
    const peek = interpretAuthStorage(cookieWithToken, '{bad json');
    expect(peek.known).toBe(true);
    expect(peek.hasCredential).toBe(true);
    expect(peek.session).toBeNull();
  });

  it('rejects a snapshot missing a string email', () => {
    const peek = interpretAuthStorage(
      cookieWithToken,
      JSON.stringify({user: {name: 'No Email'}}),
    );
    expect(peek.session).toBeNull();
  });

  it('rejects an empty-object snapshot', () => {
    const peek = interpretAuthStorage(cookieWithToken, '{}');
    expect(peek.session).toBeNull();
  });
});
