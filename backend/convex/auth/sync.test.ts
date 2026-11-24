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

    it('migrates tickets, orders, and magic-link redemptions from retained retired and active guest sessions on signup', async () => {
      const t = convexTest();
      vi.useFakeTimers();

      try {
        const start = Date.now();
        const guestEmail = 'retired-guest-signup@example.com';
        const adminId = (await t.mutation(
          api.testing.users.createUserDirectly,
          {
            email: 'retired-signup-admin@example.com',
            name: 'Admin',
          },
        )) as Id<'users'>;
        const organizerId = await t.mutation(
          api.testing.communities.seedOrganizer,
          {
            name: 'Retired Signup Org',
            slug: 'retired-signup-org',
          },
        );
        const eventId = await t.mutation(api.testing.events.seedEvent, {
          title: 'Retired Signup Event',
          date: '2099-06-01T20:00:00Z',
          price: 0,
          totalTickets: 25,
          status: 'published',
          visibility: 'public',
          organizerId,
        });
        const {linkId} = await t.mutation(
          api.testing.magic_links.seedMagicLink,
          {
            createdBy: adminId,
            organizerId,
            token: 'retired-signup-magic-link',
            status: 'active',
          },
        );

        const retiredSessionId = await t.mutation(
          api.testing.guest_sessions.seedGuestSession,
          {
            email: guestEmail,
            magicLinkId: linkId,
            sessionToken: 'retired-signup-session-token',
            expiresAt: start + 60_000,
          },
        );

        const claim1 = await t.mutation(
          api.orders.core.claimFreeTicketAsGuest,
          {
            sessionToken: 'retired-signup-session-token',
            eventId,
            quantity: 1,
            tier: 'regular',
            termsAccepted: true,
            idempotencyKey: 'idem-retired-signup-claim-1',
          },
        );

        // Advance past expiry and retire the first session via hourly cleanup.
        vi.advanceTimersByTime(120_000);
        const cleaned = await t.mutation(
          internal.guest_sessions.core.cleanupExpiredSessions,
          {},
        );
        expect(cleaned).toBe(1);

        // Guest later starts a second session and claims another ticket.
        const secondSession = await t.action(
          api.guest_sessions.actions.initiateGuestSession,
          {email: guestEmail},
        );
        const claim2 = await t.mutation(
          api.orders.core.claimFreeTicketAsGuest,
          {
            sessionToken: secondSession.sessionToken,
            eventId,
            quantity: 1,
            tier: 'regular',
            termsAccepted: true,
            idempotencyKey: 'idem-retired-signup-claim-2',
          },
        );

        // User signs up with the same verified email: both sessions must migrate.
        const syncResult = await t.mutation(internal.auth.sync.syncUser, {
          betterAuthUserId: 'ba-user-retired-signup',
          email: guestEmail,
          authEmailVerified: true,
        });
        await finishAllScheduledFunctions(t);

        await t.run(async (ctx) => {
          const retiredSession = await ctx.db.get(
            'guest_sessions',
            retiredSessionId,
          );
          expect(retiredSession?.retiredAt).toBeTypeOf('number');
          expect(retiredSession?.convertedToUserId).toBe(syncResult.userId);

          const order1 = await ctx.db.get('ticket_orders', claim1.orderId);
          const order2 = await ctx.db.get('ticket_orders', claim2.orderId);
          expect(order1?.userId).toBe(syncResult.userId);
          expect(order1?.guestSessionId).toBeUndefined();
          expect(order2?.userId).toBe(syncResult.userId);
          expect(order2?.guestSessionId).toBeUndefined();

          const tickets = await ctx.db
            .query('tickets')
            .withIndex('by_user', (q) => q.eq('userId', syncResult.userId))
            .collect();
          expect(tickets).toHaveLength(2);
          expect(tickets.every((tk) => tk.guestSessionId === undefined)).toBe(
            true,
          );

          const redemptions = await ctx.db
            .query('magic_link_redemption_log')
            .withIndex('by_guestSession', (q) =>
              q.eq('guestSessionId', retiredSessionId),
            )
            .collect();
          expect(redemptions).toHaveLength(1);
          expect(redemptions[0].userId).toBe(syncResult.userId);
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

    it('returns cleared social signup completion for an existing Better Auth-linked user with accepted terms', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'linked@example.com',
        name: 'Linked User',
        betterAuthUserId: 'ba-user-linked',
        authEmailVerified: true,
        socialSignupCompletionRequired: true,
        termsAcceptedAt: 1720000000000,
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

    it('keeps social signup completion for a Better Auth-linked user without accepted terms', async () => {
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
      expect(result.requiresSocialSignupCompletion).toBe(true);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.socialSignupCompletionRequired).toBe(true);
        expect(user?.termsAcceptedAt).toBeUndefined();
      });
    });

    it('returns cleared social signup completion when linking an existing local user by email with accepted terms', async () => {
      const t = convexTest();

      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        email: 'legacy@example.com',
        name: 'Legacy User',
        authEmailVerified: true,
        socialSignupCompletionRequired: true,
        termsAcceptedAt: 1720000000000,
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

    it('keeps social signup completion when linking an existing local user by email without accepted terms', async () => {
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
      expect(result.requiresSocialSignupCompletion).toBe(true);

      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        expect(user?.betterAuthUserId).toBe('ba-user-legacy');
        expect(user?.socialSignupCompletionRequired).toBe(true);
        expect(user?.termsAcceptedAt).toBeUndefined();
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
