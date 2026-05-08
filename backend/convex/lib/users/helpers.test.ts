import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import * as batchUtils from '../../lib/batch_utils';
import {
  buildCommunityUserRows,
  stripCommunityAdminFields,
  stripSensitiveUserFields,
} from './helpers';

vi.mock('../../lib/batch_utils', () => ({
  batchGetUsers: vi.fn(),
}));

describe('buildCommunityUserRows', () => {
  const mockCtx = {} as QueryCtx;
  const organizerId = 'org123' as Id<'organizers'>;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps mixed community users through the display-name fallbacks', async () => {
    const userId1 = 'user1' as Id<'users'>;
    const userId2 = 'user2' as Id<'users'>;
    const userId3 = 'user3' as Id<'users'>;

    vi.mocked(batchUtils.batchGetUsers).mockResolvedValueOnce(
      new Map<Id<'users'>, Doc<'users'>>([
        [
          userId1,
          {
            _id: userId1,
            name: 'Alice',
            email: 'alice@example.com',
          } as Doc<'users'>,
        ],
        [
          userId2,
          {
            _id: userId2,
            name: undefined,
            email: 'bob@example.com',
          } as Doc<'users'>,
        ],
      ]),
    );

    const result = await buildCommunityUserRows(mockCtx, organizerId, [
      userId1,
      userId2,
      userId3,
    ]);

    expect(result).toEqual([
      {
        _id: userId1,
        userId: userId1,
        organizerId,
        displayName: 'Alice',
        email: 'alice@example.com',
      },
      {
        _id: userId2,
        userId: userId2,
        organizerId,
        displayName: 'bob@example.com',
        email: 'bob@example.com',
      },
      {
        _id: userId3,
        userId: userId3,
        organizerId,
        displayName: userId3,
        email: undefined,
      },
    ]);
  });

  it('returns an empty array for empty input and still calls batchGetUsers', async () => {
    vi.mocked(batchUtils.batchGetUsers).mockResolvedValueOnce(new Map());

    const result = await buildCommunityUserRows(mockCtx, organizerId, []);

    expect(result).toEqual([]);
    expect(batchUtils.batchGetUsers).toHaveBeenCalledWith(mockCtx, []);
  });
});

describe('stripSensitiveUserFields', () => {
  it('removes auth and legacy flags while preserving public user fields', () => {
    const userId = 'user1' as Id<'users'>;
    const user = {
      _id: userId,
      name: 'Alice',
      email: 'alice@example.com',
      pendingEmail: 'alice.pending@example.com',
      emailVerificationTime: 123,
      emailChangeToken: 'secret-token',
      emailChangeTokenExpiry: 456,
      authEmailVerified: true,
      betterAuthUserId: 'auth-123',
    } as Doc<'users'>;

    const result = stripSensitiveUserFields(user);

    expect(result).toMatchObject({
      _id: userId,
      name: 'Alice',
      email: 'alice@example.com',
      pendingEmail: 'alice.pending@example.com',
      emailVerificationTime: 123,
    });
    expect(result).not.toHaveProperty('emailChangeToken');
    expect(result).not.toHaveProperty('emailChangeTokenExpiry');
    expect(result).not.toHaveProperty('authEmailVerified');
    expect(result).not.toHaveProperty('betterAuthUserId');
  });
});

describe('stripCommunityAdminFields', () => {
  it('removes community-admin-only email workflow fields', () => {
    const userId = 'user2' as Id<'users'>;
    const user = stripSensitiveUserFields({
      _id: userId,
      name: 'Bea',
      email: 'bea@example.com',
      pendingEmail: 'bea.pending@example.com',
      emailVerificationTime: 789,
      emailChangeToken: 'another-secret',
      emailChangeTokenExpiry: 1011,
      authEmailVerified: false,
      betterAuthUserId: 'auth-456',
    } as Doc<'users'>);

    const result = stripCommunityAdminFields(user);

    expect(result).toMatchObject({
      _id: userId,
      name: 'Bea',
      email: 'bea@example.com',
    });
    expect(result).not.toHaveProperty('pendingEmail');
    expect(result).not.toHaveProperty('emailVerificationTime');
  });
});
