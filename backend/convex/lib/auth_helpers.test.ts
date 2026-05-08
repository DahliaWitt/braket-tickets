import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const safeGetAuthUserMock = vi.hoisted(() => vi.fn());

type QueryUser = {
  _id: string;
  email?: string;
  betterAuthUserId?: string;
};

function makeAsyncIterable<T>(items: ReadonlyArray<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function makeCtx(args: {
  betterAuthMatches?: ReadonlyArray<QueryUser>;
  emailMatches?: ReadonlyArray<QueryUser>;
}) {
  return {
    db: {
      query: (table: string) => {
        if (table !== 'users') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          withIndex: (index: string) => {
            if (index === 'by_betterAuthUserId') {
              return makeAsyncIterable(args.betterAuthMatches ?? []);
            }
            if (index === 'email') {
              return makeAsyncIterable(args.emailMatches ?? []);
            }
            throw new Error(`Unexpected index ${index}`);
          },
        };
      },
    },
  };
}

const originalVitest = process.env.VITEST;

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('./auth_helpers');
  vi.doMock('./better_auth', () => ({
    authComponent: {
      safeGetAuthUser: safeGetAuthUserMock,
    },
  }));
  safeGetAuthUserMock.mockReset();
  delete process.env.VITEST;
});

afterEach(() => {
  if (originalVitest === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = originalVitest;
  }
});

describe('getAuthUserId', () => {
  it('does not fall back to an unlinked email-matched app user', async () => {
    safeGetAuthUserMock.mockResolvedValue({
      _id: 'ba-user-1',
      email: 'person@example.com',
      emailVerified: true,
    });

    const {getAuthUserId} = await import('./auth_helpers');

    const userId = await getAuthUserId(
      makeCtx({
        betterAuthMatches: [],
        emailMatches: [
          {
            _id: 'user-1',
            email: 'person@example.com',
          },
        ],
      }) as never,
    );

    expect(userId).toBeNull();
  });

  it('returns the directly linked app user', async () => {
    safeGetAuthUserMock.mockResolvedValue({
      _id: 'ba-user-1',
      email: 'person@example.com',
      emailVerified: true,
    });

    const {getAuthUserId} = await import('./auth_helpers');

    const userId = await getAuthUserId(
      makeCtx({
        betterAuthMatches: [
          {
            _id: 'user-1',
            email: 'person@example.com',
            betterAuthUserId: 'ba-user-1',
          },
        ],
      }) as never,
    );

    expect(userId).toBe('user-1');
  });
});

describe('requireUser', () => {
  it('returns the linked app user document', async () => {
    safeGetAuthUserMock.mockResolvedValue({_id: 'ba-user-1'});
    const {requireUser} = await import('./auth_helpers');

    const user = await requireUser(
      makeCtx({
        betterAuthMatches: [
          {
            _id: 'user-1',
            email: 'a@example.com',
            betterAuthUserId: 'ba-user-1',
          },
        ],
      }) as never,
    );

    expect(user).toMatchObject({_id: 'user-1'});
  });

  it('throws when authentication is missing', async () => {
    safeGetAuthUserMock.mockResolvedValue(null);
    const {requireUser} = await import('./auth_helpers');

    await expect(
      requireUser(makeCtx({betterAuthMatches: []}) as never),
    ).rejects.toThrow();
  });

  it('throws when the authenticated Better Auth user has no linked app user row', async () => {
    safeGetAuthUserMock.mockResolvedValue({_id: 'ba-user-1'});
    const {requireUser} = await import('./auth_helpers');

    await expect(
      requireUser(makeCtx({betterAuthMatches: []}) as never),
    ).rejects.toThrow();
  });
});
