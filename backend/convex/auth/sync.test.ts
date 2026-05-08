import {beforeEach, describe, expect, it, vi} from 'vitest';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

const adapterFindManyMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/better_auth_adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/better_auth_adapter')
  >('../lib/better_auth_adapter');

  return {
    ...actual,
    adapterFindMany: adapterFindManyMock,
  };
});

describe('auth_sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterFindManyMock.mockResolvedValue([]);
  });

  describe('syncUser', () => {
    it('creates a new user linked to the Better Auth user id', async () => {
      const t = convexTest();

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-1',
        email: 'NewUser@example.com',
        name: 'New User',
        image: 'https://example.com/avatar.png',
        authEmailVerified: true,
        emailVerificationTime: 12345,
      });
      const userId = result.userId;

      expect(result.created).toBe(true);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user).toBeDefined();
        expect(user?.betterAuthUserId).toBe('ba-user-1');
        expect(user?.email).toBe('newuser@example.com');
        expect(user?.name).toBe('New User');
        expect(user?.image).toBe('https://example.com/avatar.png');
        expect(user?.authEmailVerified).toBe(true);
        expect(user?.emailVerificationTime).toBe(12345);
        expect('roles' in (user ?? {})).toBe(false);
      });
    });

    it('schedules guest migration when an older by_email session is already converted', async () => {
      const t = convexTest();
      vi.useFakeTimers();

      try {
        const previousUserId = (await t.mutation(
          api.testing.users.createUserDirectly,
          {
            email: 'previous-guest-owner@example.com',
            name: 'Previous Owner',
          },
        )) as Id<'users'>;
        const convertedSessionId = await t.mutation(
          api.testing.guest_sessions.seedGuestSession,
          {
            email: 'Guest-Migrate@example.com',
            sessionToken: 'converted-first-session',
            convertedToUserId: previousUserId,
          },
        );
        const unmigratedSessionId = await t.mutation(
          api.testing.guest_sessions.seedGuestSession,
          {
            email: 'guest-migrate@example.com',
            sessionToken: 'newer-unmigrated-session',
          },
        );

        const result = await t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-guest-migrate',
          email: 'guest-migrate@example.com',
          authEmailVerified: true,
        });

        await finishAllScheduledFunctions(t);

        await t.run(async (ctx) => {
          const converted = await ctx.db.get(convertedSessionId);
          const unmigrated = await ctx.db.get(unmigratedSessionId);
          expect(converted?.convertedToUserId).toBe(previousUserId);
          expect(unmigrated?.convertedToUserId).toBe(result.userId);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('updates an existing Better Auth-linked user without overwriting a custom name', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'linked@example.com',
        name: 'Custom Display Name',
        betterAuthUserId: 'ba-user-linked',
        authEmailVerified: false,
      })) as Id<'users'>;

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-linked',
        email: 'linked@example.com',
        name: 'Provider Name',
        image: 'https://example.com/new-avatar.png',
        authEmailVerified: true,
        emailVerificationTime: 99999,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.name).toBe('Custom Display Name');
        expect(user?.image).toBe('https://example.com/new-avatar.png');
        expect(user?.authEmailVerified).toBe(true);
        expect(user?.emailVerificationTime).toBe(99999);
      });
    });

    it('updates the mirrored app email when a linked Better Auth user changes email', async () => {
      const t = convexTest();

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-02T12:00:00.000Z'));

      try {
        const userId = await t.run(async (ctx) =>
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid email-change-in-progress state to test sync cleanup
          ctx.db.insert('users', {
            email: 'old-linked@example.com',
            name: 'Linked User',
            betterAuthUserId: 'ba-user-linked',
            authEmailVerified: true,
            emailVerificationTime: 111,
            pendingEmail: 'new-linked@example.com',
            emailChangeToken: 'legacy-token',
            emailChangeTokenExpiry: Date.now() + 10000,
          }),
        );

        const result = await t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-linked',
          email: 'New-Linked@Example.com',
          name: 'Provider Name',
          authEmailVerified: true,
        });

        expect(result.userId).toBe(userId);
        expect(result.created).toBe(false);

        await t.run(async (ctx) => {
          const user = await ctx.db.get(userId);
          expect(user?.email).toBe('new-linked@example.com');
          expect(user?.name).toBe('Linked User');
          expect(user?.pendingEmail).toBeUndefined();
          expect(user?.emailChangeToken).toBeUndefined();
          expect(user?.emailChangeTokenExpiry).toBeUndefined();
          expect(user?.authEmailVerified).toBe(true);
          expect(user?.emailVerificationTime).toBe(
            new Date('2026-04-02T12:00:00.000Z').getTime(),
          );
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not mirror a changed linked email from an unverified identity', async () => {
      const t = convexTest();

      vi.useFakeTimers();
      try {
        const userId = (await t.mutation(api.testing.users.createUserDirectly, {
          email: 'old-linked@example.com',
          name: 'Linked User',
          betterAuthUserId: 'ba-user-linked',
          authEmailVerified: true,
        })) as Id<'users'>;
        const guestSessionId = await t.mutation(
          api.testing.guest_sessions.seedGuestSession,
          {
            email: 'unverified-new@example.com',
            sessionToken: 'unverified-new-guest-token',
          },
        );

        const result = await t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-linked',
          email: 'Unverified-New@Example.com',
          authEmailVerified: false,
        });

        expect(result.userId).toBe(userId);
        expect(result.created).toBe(false);

        await t.run(async (ctx) => {
          const user = await ctx.db.get(userId);
          const guestSession = await ctx.db.get(guestSessionId);
          expect(user?.email).toBe('old-linked@example.com');
          expect(guestSession?.convertedToUserId).toBeUndefined();
        });

        await finishAllScheduledFunctions(t);

        await t.run(async (ctx) => {
          const guestSession = await ctx.db.get(guestSessionId);
          expect(guestSession?.convertedToUserId).toBeUndefined();
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves an existing verification timestamp when verified sync omits one', async () => {
      const t = convexTest();

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailVerificationTime not settable via createUserDirectly; needed to test sync preserves existing timestamp
      const userId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          email: 'linked@example.com',
          betterAuthUserId: 'ba-user-linked',
          authEmailVerified: true,
          emailVerificationTime: 12345,
        }),
      );

      await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-linked',
        email: 'linked@example.com',
        authEmailVerified: true,
      });

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.authEmailVerified).toBe(true);
        expect(user?.emailVerificationTime).toBe(12345);
      });
    });

    it('preserves emailVerificationTime for an already verified Better Auth-linked user', async () => {
      const t = convexTest();

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailVerificationTime not settable via createUserDirectly; needed to test sync preserves existing timestamp
      const userId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        ctx.db.insert('users', {
          email: 'linked@example.com',
          name: 'Already Verified',
          betterAuthUserId: 'ba-user-linked',
          authEmailVerified: true,
          emailVerificationTime: 12345,
        }),
      );

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-linked',
        email: 'linked@example.com',
        name: 'Provider Name',
        image: 'https://example.com/new-avatar.png',
        authEmailVerified: true,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.authEmailVerified).toBe(true);
        expect(user?.emailVerificationTime).toBe(12345);
      });
    });

    it('sets emailVerificationTime when a previously unverified user becomes verified', async () => {
      const t = convexTest();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-02T12:00:00.000Z'));

      try {
        const userId = (await t.mutation(api.testing.users.createUserDirectly, {
          email: 'linked@example.com',
          name: 'Needs Verification',
          betterAuthUserId: 'ba-user-linked',
          authEmailVerified: false,
        })) as Id<'users'>;

        await t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-linked',
          email: 'linked@example.com',
          authEmailVerified: true,
        });

        await t.run(async (ctx) => {
          const user = await ctx.db.get(userId);
          expect(user?.authEmailVerified).toBe(true);
          expect(user?.emailVerificationTime).toBe(
            new Date('2026-04-02T12:00:00.000Z').getTime(),
          );
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('links an existing local user by matching verified email and records an audit log', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'legacy@example.com',
        name: 'Legacy User',
        authEmailVerified: false,
      })) as Id<'users'>;

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-legacy',
        email: 'legacy@example.com',
        name: 'Legacy User',
        authEmailVerified: true,
        emailVerificationTime: 54321,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.betterAuthUserId).toBe('ba-user-legacy');
        expect(user?.authEmailVerified).toBe(true);
        expect(user?.emailVerificationTime).toBe(54321);

        const latestAudit = await ctx.db
          .query('adminAuditLogs')
          .withIndex('by_adminId', (q) => q.eq('adminId', userId))
          .order('desc')
          .first();

        expect(latestAudit?.action).toBe('auth.social_signin.linked_existing');
        expect(latestAudit?.source).toBe('better_auth_sync');
      });
    });

    it('rejects sync when the Better Auth identity email is missing', async () => {
      const t = convexTest();

      await expect(
        t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-missing-email',
          authEmailVerified: true,
        }),
      ).rejects.toThrow(/verified identity email is required/i);
    });

    it('rejects sync when the Better Auth identity email is unverified', async () => {
      const t = convexTest();

      await expect(
        t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-unverified',
          email: 'user@example.com',
          authEmailVerified: false,
        }),
      ).rejects.toThrow(/unverified identity email/i);
    });

    it('preserves social signup completion for existing social-only users', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'social@example.com',
        name: 'Social User',
        betterAuthUserId: 'ba-user-social',
        authEmailVerified: true,
        socialSignupCompletionRequired: true,
      })) as Id<'users'>;

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-social',
        email: 'social@example.com',
        authEmailVerified: true,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(true);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.socialSignupCompletionRequired).toBe(true);
      });
    });

    it('returns cleared social signup completion for an existing Better Auth-linked user', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'linked@example.com',
        name: 'Linked User',
        betterAuthUserId: 'ba-user-linked',
        authEmailVerified: true,
        socialSignupCompletionRequired: true,
      })) as Id<'users'>;

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-linked',
        email: 'linked@example.com',
        authEmailVerified: true,
        socialSignupCompletionRequired: false,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.socialSignupCompletionRequired).toBe(false);
      });
    });

    it('returns cleared social signup completion when linking an existing local user by email', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'legacy@example.com',
        name: 'Legacy User',
        authEmailVerified: true,
        socialSignupCompletionRequired: true,
      })) as Id<'users'>;

      const result = await t.mutation(internal.auth.sync.syncUser, {
        betterAuthUserId: 'ba-user-legacy',
        email: 'legacy@example.com',
        name: 'Legacy User',
        authEmailVerified: true,
        socialSignupCompletionRequired: false,
      });

      expect(result.userId).toBe(userId);
      expect(result.created).toBe(false);
      expect(result.requiresSocialSignupCompletion).toBe(false);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.betterAuthUserId).toBe('ba-user-legacy');
        expect(user?.socialSignupCompletionRequired).toBe(false);
      });
    });
  });

  describe('backfillAuthUserLinks', () => {
    it('links an unlinked app user to the matching Better Auth user and is idempotent', async () => {
      const t = convexTest();

      const actorUserId = (await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'actor@example.com',
          name: 'Actor',
          betterAuthUserId: 'ba-actor',
          isRootAdmin: true,
        },
      )) as Id<'users'>;

      const targetUserId = (await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'Backfill@example.com',
          name: 'Needs Backfill',
        },
      )) as Id<'users'>;

      adapterFindManyMock.mockResolvedValueOnce([
        {
          _id: 'ba-user-backfill',
          email: 'backfill@example.com',
          emailVerified: true,
        },
      ]);

      const firstRun = await t.mutation(
        internal.auth.sync.backfillAuthUserLinks,
        {
          actorUserId,
        },
      );

      expect(firstRun.linked).toBe(1);
      expect(firstRun.collisions).toBe(0);
      expect(firstRun.isDone).toBe(true);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(targetUserId);
        expect(user?.betterAuthUserId).toBe('ba-user-backfill');
        expect(user?.authEmailVerified).toBe(true);
      });

      const secondRun = await t.mutation(
        internal.auth.sync.backfillAuthUserLinks,
        {
          actorUserId,
        },
      );
      expect(secondRun.linked).toBe(0);
      expect(secondRun.skipped).toBeGreaterThan(0);
    });

    it('skips duplicate-email collisions and records a collision sample', async () => {
      const t = convexTest();

      const actorUserId = (await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'actor@example.com',
          name: 'Actor',
          betterAuthUserId: 'ba-actor',
          isRootAdmin: true,
        },
      )) as Id<'users'>;

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: duplicate emails to test collision handling; createUserDirectly deduplicates by email
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        await ctx.db.insert('users', {
          email: 'duplicate@example.com',
          name: 'Dup A',
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        await ctx.db.insert('users', {
          email: 'duplicate@example.com',
          name: 'Dup B',
        });
      });

      const result = await t.mutation(
        internal.auth.sync.backfillAuthUserLinks,
        {
          actorUserId,
        },
      );

      expect(result.linked).toBe(0);
      expect(result.collisions).toBeGreaterThan(0);

      await t.run(async (ctx) => {
        const duplicateUsers = await ctx.db
          .query('users')
          .withIndex('email', (q) => q.eq('email', 'duplicate@example.com'))
          .collect();

        expect(duplicateUsers).toHaveLength(2);
        expect(
          duplicateUsers.every((user) => user.betterAuthUserId === undefined),
        ).toBe(true);
      });
      expect(result.collisionSample.length).toBeGreaterThan(0);
    });
  });
});
