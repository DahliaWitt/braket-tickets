import {describe, expect, it} from 'vitest';
import {
  BETTER_AUTH_STORAGE_PREFIX,
  narrowCachedSession,
  type CachedBetterAuthSession,
} from './auth-storage';

describe('BETTER_AUTH_STORAGE_PREFIX', () => {
  it('matches the crossDomain plugin storage prefix', () => {
    // Lockstep with auth.client.ts crossDomainClient({ storagePrefix }).
    expect(BETTER_AUTH_STORAGE_PREFIX).toBe('braket-tickets');
  });
});

describe('narrowCachedSession', () => {
  it('returns null for a null snapshot (plugin getSessionData → null)', () => {
    expect(narrowCachedSession(null)).toBeNull();
  });

  it('narrows a snapshot with a string user.email', () => {
    const data = {
      user: {email: 'buyer@example.com', name: 'Buyer'},
      session: {id: 'sess_1'},
    };
    const result = narrowCachedSession(data);
    expect(result).toEqual<CachedBetterAuthSession>({
      user: {email: 'buyer@example.com', name: 'Buyer'},
      session: {id: 'sess_1'},
    });
  });

  it('rejects a snapshot missing the user object', () => {
    expect(narrowCachedSession({session: {id: 'sess_1'}})).toBeNull();
  });

  it('rejects a snapshot whose user has no string email', () => {
    expect(narrowCachedSession({user: {name: 'No Email'}})).toBeNull();
  });

  it('rejects a snapshot whose user.email is not a string', () => {
    expect(narrowCachedSession({user: {email: 42}})).toBeNull();
  });

  it('rejects an empty-object snapshot', () => {
    expect(narrowCachedSession({})).toBeNull();
  });
});
