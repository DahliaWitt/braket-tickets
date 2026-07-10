import {expect, test, describe} from 'vitest';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id, Doc} from '../_generated/dataModel';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';

/**
 * Guest Sessions Tests
 *
 * Tests focus on internal queries and mutations which are the building blocks
 * of the public actions. The actions themselves use bcrypt (Node.js runtime)
 * and email sending which cannot run in the edge-runtime test environment.
 *
 * Coverage:
 * - Session creation with and without magic link
 * - Email lookup through the guest-session test fixture
 * - Session token lookup with expiry/inactivity enforcement
 * - Session lifecycle (create -> use)
 */

async function createMagicLink(
  t: ReturnType<typeof convexTest>,
  createdBy: Id<'users'>,
): Promise<Id<'magic_links'>> {
  const result = await t.mutation(api.testing.magic_links.seedMagicLink, {
    createdBy,
    status: 'active',
  });
  return result.linkId;
}

async function createMagicLinkWithConfig(
  t: ReturnType<typeof convexTest>,
  args: {
    createdBy: Id<'users'>;
    token: string;
    expiresAt?: number;
    maxRedemptions?: number;
  },
): Promise<Id<'magic_links'>> {
  const result = await t.mutation(api.testing.magic_links.seedMagicLink, {
    createdBy: args.createdBy,
    token: args.token,
    status: 'active',
    expiresAt: args.expiresAt,
    maxRedemptions: args.maxRedemptions,
  });
  return result.linkId;
}

async function createUser(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    email,
    name: 'Test User',
  });
}

/** Type-safe helper to read a guest session from the database. */
async function getSession(
  t: ReturnType<typeof convexTest>,
  sessionId: Id<'guest_sessions'>,
): Promise<Doc<'guest_sessions'> | null> {
  return await t.run(async (ctx) => {
    return await ctx.db.get(sessionId);
  });
}

describe('guest_sessions', () => {
  describe('initiateGuestSession', () => {
    test('reuses an existing guest session when the caller presents its session token', async () => {
      const t = convexTest();
      const adminId = await createUser(t, 'reuse-proof-admin@test.com');
      const token = `reuse-proof-guest-link-${Date.now()}`;
      const linkId = await createMagicLinkWithConfig(t, {
        createdBy: adminId,
        token,
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'reuse-proof-guest@test.com',
          sessionToken: 'existing-proof-session-token',
        },
      );

      const result = await t.action(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: 'reuse-proof-guest@test.com',
          existingSessionToken: 'existing-proof-session-token',
          magicLinkToken: token,
        },
      );

      expect(result.sessionToken).toBe('existing-proof-session-token');

      const session = await getSession(t, sessionId);
      expect(session!.magicLinkId).toBe(linkId);

      const redemptions = await t.run(async (ctx) =>
        ctx.db
          .query('magic_link_redemption_log')
          .withIndex('by_guestSession', (q) =>
            q.eq('guestSessionId', sessionId),
          )
          .collect(),
      );
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].magicLinkId).toBe(linkId);
      expect(redemptions[0].guestSessionId).toBe(sessionId);
      expect(redemptions[0].userId).toBeUndefined();
    });

    test('rejects an expired magic link during guest-session initiation', async () => {
      const t = convexTest();
      const adminId = await createUser(t, 'expired-admin@test.com');
      const token = `expired-guest-link-${Date.now()}`;

      await createMagicLinkWithConfig(t, {
        createdBy: adminId,
        token,
        expiresAt: Date.now() - 1_000,
      });

      await expect(
        t.action(api.guest_sessions.actions.initiateGuestSession, {
          email: 'expired-guest@test.com',
          magicLinkToken: token,
        }),
      ).rejects.toThrow('expired');

      const session = await t.query(
        api.testing.guest_sessions.getGuestSessionByEmail,
        {
          email: 'expired-guest@test.com',
        },
      );
      expect(session).toBeNull();

      const redemptions = await t.run(async (ctx) =>
        ctx.db.query('magic_link_redemption_log').collect(),
      );
      expect(redemptions).toHaveLength(0);
    });

    test('rejects a maxed magic link during guest-session initiation', async () => {
      const t = convexTest();
      const adminId = await createUser(t, 'maxed-admin@test.com');
      const token = `maxed-guest-link-${Date.now()}`;
      const linkId = await createMagicLinkWithConfig(t, {
        createdBy: adminId,
        token,
        maxRedemptions: 1,
      });

      await t.mutation(api.testing.magic_links.seedMagicLinkRedemption, {
        magicLinkId: linkId,
        userId: adminId,
      });

      await expect(
        t.action(api.guest_sessions.actions.initiateGuestSession, {
          email: 'maxed-guest@test.com',
          magicLinkToken: token,
        }),
      ).rejects.toThrow('redemption limit');

      const session = await t.query(
        api.testing.guest_sessions.getGuestSessionByEmail,
        {
          email: 'maxed-guest@test.com',
        },
      );
      expect(session).toBeNull();

      const redemptions = await t.run(async (ctx) =>
        ctx.db
          .query('magic_link_redemption_log')
          .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
          .collect(),
      );
      expect(redemptions).toHaveLength(1);
    });

    test('rejects creating a second active guest session without proof of possession', async () => {
      const t = convexTest();
      const adminId = await createUser(t, 'reuse-admin@test.com');
      const token = `reuse-guest-link-${Date.now()}`;
      await createMagicLinkWithConfig(t, {
        createdBy: adminId,
        token,
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'reuse-guest@test.com',
          sessionToken: 'existing-reuse-session-token',
        },
      );

      await expect(
        t.action(api.guest_sessions.actions.initiateGuestSession, {
          email: 'reuse-guest@test.com',
          magicLinkToken: token,
        }),
      ).rejects.toThrow('active guest session already exists');

      const session = await getSession(t, sessionId);
      expect(session!.sessionToken).toBeUndefined();
      expect(session!.sessionTokenDigest).toBeTruthy();
      expect(session!.magicLinkId).toBeUndefined();

      const oldSession = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'existing-reuse-session-token',
          now: Date.now(),
        },
      );
      expect(oldSession).toBeNull();

      const redemptions = await t.run(async (ctx) =>
        ctx.db
          .query('magic_link_redemption_log')
          .withIndex('by_guestSession', (q) =>
            q.eq('guestSessionId', sessionId),
          )
          .collect(),
      );
      expect(redemptions).toHaveLength(0);
      const sessionsForEmail = await t.run(async (ctx) =>
        ctx.db
          .query('guest_sessions')
          .withIndex('by_email', (q) => q.eq('email', 'reuse-guest@test.com'))
          .collect(),
      );
      expect(sessionsForEmail).toHaveLength(1);
    });

    test('does not revive an inactivity-expired session when initiating again', async () => {
      const t = convexTest();
      const adminId = await createUser(t, 'inactive-admin@test.com');
      const token = `inactive-guest-link-${Date.now()}`;
      const linkId = await createMagicLinkWithConfig(t, {
        createdBy: adminId,
        token,
      });

      const oldSessionToken = 'inactive-existing-session-token';
      const oldSessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'inactive-guest@test.com',
          sessionToken: oldSessionToken,
        },
      );

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- directly aging lastActiveAt to simulate inactivity expiry; no public mutation exposes this state */
      await t.run(async (ctx) => {
        await ctx.db.patch(oldSessionId, {
          lastActiveAt: Date.now() - 3 * 60 * 60 * 1000,
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const result = await t.action(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: 'inactive-guest@test.com',
          magicLinkToken: token,
        },
      );

      expect(result.sessionToken).not.toBe(oldSessionToken);

      const oldSession = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: oldSessionToken,
          now: Date.now(),
        },
      );
      expect(oldSession).toBeNull();

      const newSession = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: result.sessionToken,
          now: Date.now(),
        },
      );
      expect(newSession).not.toBeNull();
      expect(newSession!.magicLinkId).toBe(linkId);
    });
  });

  describe('create', () => {
    test('creates session with valid magic link', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'promoter@test.com');
      const magicLinkId = await createMagicLink(t, userId);

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'guest@test.com',
          magicLinkId,
          sessionToken: 'test-session-token-123',
        },
      );

      expect(sessionId).toBeDefined();

      const session = await getSession(t, sessionId);
      expect(session).not.toBeNull();
      expect(session!.email).toBe('guest@test.com');
      expect(session!.magicLinkId).toBe(magicLinkId);
      expect(session!.sessionToken).toBeUndefined();
      expect(session!.sessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'test-session-token-123'),
      );
      expect(session!.sessionTokenPrefix).toBe(
        tokenPrefix('test-session-token-123'),
      );
      expect(session!.expiresAt).toBeGreaterThan(Date.now());
    });

    test('creates session without magic link', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'guest@test.com',
          sessionToken: 'test-session-token-456',
        },
      );

      expect(sessionId).toBeDefined();

      const session = await getSession(t, sessionId);
      expect(session).not.toBeNull();
      expect(session!.email).toBe('guest@test.com');
      expect(session!.magicLinkId).toBeUndefined();
    });

    test('normalizes email to lowercase', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'Guest@Test.COM',
          sessionToken: 'test-token',
        },
      );

      const session = await getSession(t, sessionId);
      expect(session!.email).toBe('guest@test.com');
    });

    test('inserts magic_link_redemption_log record when magicLinkId provided (BRA-137)', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'promoter@test.com');
      const magicLinkId = await createMagicLink(t, userId);

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'guest@test.com',
          magicLinkId,
          sessionToken: 'test-session-token-redeem',
        },
      );

      const redemptions = await t.run(async (ctx) =>
        ctx.db
          .query('magic_link_redemption_log')
          .withIndex('by_magicLink', (q) => q.eq('magicLinkId', magicLinkId))
          .collect(),
      );

      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].magicLinkId).toBe(magicLinkId);
      expect(redemptions[0].guestSessionId).toBe(sessionId);
      expect(redemptions[0].userId).toBeUndefined();
      expect(typeof redemptions[0].redeemedAt).toBe('number');
    });

    test('no redemption record when magicLinkId is absent', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'guest@test.com',
        sessionToken: 'test-session-token-no-link',
      });

      const redemptions = await t.run(async (ctx) =>
        ctx.db.query('magic_link_redemption_log').collect(),
      );

      expect(redemptions).toHaveLength(0);
    });
  });

  describe('getGuestSessionByEmail fixture', () => {
    test('returns correct session for email', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'lookup@test.com',
        sessionToken: 'lookup-token',
      });

      const result = await t.query(
        api.testing.guest_sessions.getGuestSessionByEmail,
        {
          email: 'lookup@test.com',
        },
      );

      expect(result).not.toBeNull();
      expect(result!.email).toBe('lookup@test.com');
      expect(result!.sessionToken).toBeUndefined();
      expect(result!.sessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'lookup-token'),
      );
    });

    test('returns null for nonexistent email', async () => {
      const t = convexTest();

      const result = await t.query(
        api.testing.guest_sessions.getGuestSessionByEmail,
        {
          email: 'noone@test.com',
        },
      );

      expect(result).toBeNull();
    });

    test('is case-insensitive via normalized storage', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'CaSe@Test.COM',
        sessionToken: 'case-token',
      });

      const result = await t.query(
        api.testing.guest_sessions.getGuestSessionByEmail,
        {
          email: 'case@test.com',
        },
      );

      expect(result).not.toBeNull();
      expect(result!.sessionToken).toBeUndefined();
      expect(result!.sessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'case-token'),
      );
    });
  });

  describe('getBySessionToken', () => {
    test('returns valid session by token', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'valid@test.com',
        sessionToken: 'valid-token',
      });

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'valid-token',
          now: Date.now(),
        },
      );

      expect(result).not.toBeNull();
      expect(result!.email).toBe('valid@test.com');
    });

    test('returns valid session by pending resume token before promotion', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'pending-resume@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'pending-resume-token',
      });

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'pending-resume-token',
          now: Date.now(),
        },
      );

      expect(result).not.toBeNull();
      expect(result!._id).toBe(sessionId);
      expect(result!.pendingSessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'pending-resume-token'),
      );
      expect(result!.pendingSessionTokenPrefix).toBe(
        tokenPrefix('pending-resume-token'),
      );
    });

    test('promotes pending resume token to primary without invalidating delivered token', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'promoted-resume@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'promoted-resume-token',
      });
      await t.mutation(internal.guest_sessions.core.promoteResumeSessionToken, {
        sessionId,
        sessionToken: 'promoted-resume-token',
      });

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'promoted-resume-token',
          now: Date.now(),
        },
      );

      expect(result).not.toBeNull();
      expect(result!._id).toBe(sessionId);
      expect(result!.sessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'promoted-resume-token'),
      );
      expect(result!.pendingSessionTokenDigest).toBeUndefined();
      expect(result!.pendingSessionTokenPrefix).toBeUndefined();
    });

    test('promotes pending resume token when it is used to resume initiation', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'pending-initiate@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'pending-initiate-token',
      });

      const result = await t.action(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: 'pending-initiate@test.com',
          existingSessionToken: 'pending-initiate-token',
        },
      );
      const session = await getSession(t, sessionId);

      expect(result.sessionToken).toBe('pending-initiate-token');
      expect(session?.sessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'pending-initiate-token'),
      );
      expect(session?.pendingSessionTokenDigest).toBeUndefined();
      expect(session?.pendingSessionTokenPrefix).toBeUndefined();
    });

    test('does not overwrite an existing pending resume token', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'pending-collision@test.com',
          sessionToken: 'current-token',
        },
      );

      const firstPrepared = await t.mutation(
        internal.guest_sessions.core.prepareResumeSessionToken,
        {
          sessionId,
          sessionToken: 'first-pending-token',
        },
      );
      const secondPrepared = await t.mutation(
        internal.guest_sessions.core.prepareResumeSessionToken,
        {
          sessionId,
          sessionToken: 'second-pending-token',
        },
      );

      const firstResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'first-pending-token',
          now: Date.now(),
        },
      );
      const secondResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'second-pending-token',
          now: Date.now(),
        },
      );

      expect(firstPrepared).toEqual({status: 'prepared'});
      expect(secondPrepared).toEqual({status: 'already_pending'});
      expect(firstResult?._id).toBe(sessionId);
      expect(secondResult).toBeNull();
    });

    test('does not clear a pending resume token owned by another request', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'pending-owner@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'first-pending-token',
      });
      await t.mutation(internal.guest_sessions.core.clearResumeSessionToken, {
        sessionId,
        sessionToken: 'second-pending-token',
      });

      const firstResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'first-pending-token',
          now: Date.now(),
        },
      );

      expect(firstResult?._id).toBe(sessionId);
    });

    test('does not promote a pending resume token owned by another request', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'pending-promote-owner@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'first-pending-token',
      });
      await t.mutation(internal.guest_sessions.core.promoteResumeSessionToken, {
        sessionId,
        sessionToken: 'second-pending-token',
      });

      const session = await getSession(t, sessionId);
      const currentResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'current-token',
          now: Date.now(),
        },
      );

      expect(session?.pendingSessionTokenDigest).toBe(
        await digestBearerToken('guest_session', 'first-pending-token'),
      );
      expect(currentResult?._id).toBe(sessionId);
    });

    test('clears pending resume token without rotating the active token', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'cleared-resume@test.com',
          sessionToken: 'current-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.prepareResumeSessionToken, {
        sessionId,
        sessionToken: 'cleared-resume-token',
      });
      await t.mutation(internal.guest_sessions.core.clearResumeSessionToken, {
        sessionId,
        sessionToken: 'cleared-resume-token',
      });

      const pendingResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'cleared-resume-token',
          now: Date.now(),
        },
      );
      const currentResult = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'current-token',
          now: Date.now(),
        },
      );

      expect(pendingResult).toBeNull();
      expect(currentResult?._id).toBe(sessionId);
    });

    test('returns null for expired session', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'expired@test.com',
          sessionToken: 'expired-token',
        },
      );

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- directly setting expiresAt to simulate a past-expired session; no public mutation exposes this state */
      await t.run(async (ctx) => {
        await ctx.db.patch(sessionId, {
          expiresAt: Date.now() - 1000, // expired 1s ago
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'expired-token',
          now: Date.now(),
        },
      );

      expect(result).toBeNull();
    });

    test('returns null for inactive session (> 2h)', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'inactive@test.com',
          sessionToken: 'inactive-token',
        },
      );

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- directly aging lastActiveAt to simulate inactivity expiry; no public mutation exposes this state */
      await t.run(async (ctx) => {
        await ctx.db.patch(sessionId, {
          lastActiveAt: Date.now() - 3 * 60 * 60 * 1000,
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'inactive-token',
          now: Date.now(),
        },
      );

      expect(result).toBeNull();
    });

    test('returns null for nonexistent token', async () => {
      const t = convexTest();

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'does-not-exist',
          now: Date.now(),
        },
      );

      expect(result).toBeNull();
    });

    test('returns null for converted sessions', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'converted-session-owner@test.com');

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'converted-session@test.com',
        sessionToken: 'converted-session-token',
        convertedToUserId: userId,
      });

      const result = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'converted-session-token',
          now: Date.now(),
        },
      );

      expect(result).toBeNull();
    });

    test('returns session with attached magic link', async () => {
      const t = convexTest();

      const userId = await createUser(t, 'promoter@test.com');
      const magicLinkId = await createMagicLink(t, userId);

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'trusted@test.com',
        magicLinkId,
        sessionToken: 'trusted-token',
      });

      const session = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'trusted-token',
          now: Date.now(),
        },
      );

      expect(session).not.toBeNull();
      expect(session!.magicLinkId).toBe(magicLinkId);
    });

    test('converted sessions cannot authenticate guest order mutations', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'converted-order-owner@test.com');
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Converted Guest Order Org',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Converted Guest Order Event',
        date: '2099-01-01T00:00:00.000Z',
        price: 0,
        organizerId,
        totalTickets: 10,
        status: 'published',
        visibility: 'public',
      });

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'converted-order@test.com',
        sessionToken: 'converted-order-token',
        convertedToUserId: userId,
      });

      await expect(
        t.mutation(api.orders.core.claimFreeTicketAsGuest, {
          sessionToken: 'converted-order-token',
          eventId,
          quantity: 1,
          tier: 'regular',
          termsAccepted: true,
        }),
      ).rejects.toThrow('Unauthenticated');
    });
  });

  describe('updateLastActive', () => {
    test('updates lastActiveAt timestamp', async () => {
      const t = convexTest();

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'active@test.com',
          sessionToken: 'active-token',
        },
      );

      // Initially no lastActiveAt
      const before = await getSession(t, sessionId);
      expect(before!.lastActiveAt).toBeUndefined();

      // Update
      await t.mutation(internal.guest_sessions.core.updateLastActive, {
        sessionId,
      });

      const after = await getSession(t, sessionId);
      expect(after!.lastActiveAt).toBeDefined();
      expect(after!.lastActiveAt).toBeGreaterThan(0);
    });
  });

  // -- Guest-to-User Migration Tests --

  describe('getUnmigratedByEmail', () => {
    test('returns unmigrated sessions for the given email', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'migrate@test.com',
        sessionToken: 'migrate-token-1',
      });

      const results = await t.query(
        internal.guest_sessions.core.getUnmigratedByEmail,
        {
          email: 'migrate@test.com',
        },
      );

      expect(results).toHaveLength(1);
      expect(results[0].email).toBe('migrate@test.com');
    });

    test('excludes already-migrated sessions', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'realuser@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'migrate@test.com',
          sessionToken: 'migrate-token-2',
        },
      );

      // Mark as converted by running the real migration mutation
      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const results = await t.query(
        internal.guest_sessions.core.getUnmigratedByEmail,
        {
          email: 'migrate@test.com',
        },
      );

      expect(results).toHaveLength(0);
    });

    test('returns empty array for nonexistent email', async () => {
      const t = convexTest();

      const results = await t.query(
        internal.guest_sessions.core.getUnmigratedByEmail,
        {
          email: 'nobody@test.com',
        },
      );

      expect(results).toHaveLength(0);
    });

    test('returns multiple unmigrated sessions for same email', async () => {
      const t = convexTest();

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'multi@test.com',
        sessionToken: 'multi-token-1',
      });

      await t.mutation(api.testing.guest_sessions.seedGuestSession, {
        email: 'multi@test.com',
        sessionToken: 'multi-token-2',
      });

      const results = await t.query(
        internal.guest_sessions.core.getUnmigratedByEmail,
        {
          email: 'multi@test.com',
        },
      );

      expect(results).toHaveLength(2);
    });
  });

  describe('migrateOneSession', () => {
    test('transfers tickets from guestSessionId to userId', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'newuser@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'newuser@test.com',
          sessionToken: 'migrate-tickets-token',
        },
      );

      // Create an event and a guest ticket
      const eventOrganizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-migrate',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-06-01T20:00:00Z',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: eventOrganizerId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest ticket has no userId before migration; seedTicket requires userId which is the post-migration state */
      const ticketId = await t.run(async (ctx) => {
        return await ctx.db.insert('tickets', {
          guestSessionId: sessionId,
          eventId,
          status: 'valid',
          tier: 'regular',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      // Migrate
      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      // Verify ticket now belongs to user
      const ticket = await t.run(async (ctx) => {
        return await ctx.db.get(ticketId);
      });
      expect(ticket!.userId).toBe(userId);
      // Schema invariant: exactly one owner after migration.
      expect(ticket!.guestSessionId).toBeUndefined();
    });

    test('transfers orders from guestSessionId to userId', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'payuser@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'payuser@test.com',
          sessionToken: 'migrate-payments-token',
        },
      );

      const payEventOrganizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-payment',
        },
      );
      const payEventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Payment Event',
        date: '2026-06-01T20:00:00Z',
        price: 2500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId: payEventOrganizerId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest order has no userId before migration; seed helper requires userId which is the post-migration state */
      const orderId = await t.run(async (ctx) => {
        return await ctx.db.insert('ticket_orders', {
          guestSessionId: sessionId,
          eventId: payEventId,
          kind: 'primary',
          amountCents: 2500,
          currency: 'USD',
          quantity: 1,
          tier: 'regular',
          state: 'completed',
          expiresAt: Date.now() + 60_000,
          completedAt: Date.now(),
          trustSource: 'open_access',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const order = await t.run(async (ctx) => {
        return await ctx.db.get(orderId);
      });
      expect(order!.userId).toBe(userId);
      expect(order!.guestSessionId).toBeUndefined();
    });

    test('does not mutate the user document when a trusted session migrates', async () => {
      const t = convexTest();
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        email: 'trustme@test.com',
        name: 'Trust Me User',
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'trustme@test.com',
          sessionToken: 'trust-migrate-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });
      expect(user).toMatchObject({email: 'trustme@test.com'});
    });

    test('does not mutate the user document when an untrusted session migrates', async () => {
      const t = convexTest();
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        email: 'alreadytrusted@test.com',
        name: 'Already Trusted User',
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'alreadytrusted@test.com',
          sessionToken: 'notrust-migrate-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });
      expect(user).toMatchObject({email: 'alreadytrusted@test.com'});
    });

    test('marks session as converted (convertedToUserId set)', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'converted@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'converted@test.com',
          sessionToken: 'converted-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const session = await getSession(t, sessionId);
      expect(session!.convertedToUserId).toBe(userId);
    });

    test('is idempotent — running twice does not double-transfer', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'idempotent@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'idempotent@test.com',
          sessionToken: 'idempotent-token',
        },
      );

      const idempotentOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-idempotent',
        },
      );
      const idempotentEventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Idempotent Event',
        date: '2026-06-01T20:00:00Z',
        price: 1000,
        totalTickets: 10,
        status: 'published',
        visibility: 'public',
        organizerId: idempotentOrgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest ticket has no userId before migration; seedTicket requires userId which is the post-migration state */
      const ticketId = await t.run(async (ctx) => {
        return await ctx.db.insert('tickets', {
          guestSessionId: sessionId,
          eventId: idempotentEventId,
          status: 'valid',
          tier: 'regular',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      // First migration
      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      // Second migration — should be a no-op
      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      // Verify ticket still belongs to user (not duplicated or altered)
      const ticket = await t.run(async (ctx) => {
        return await ctx.db.get(ticketId);
      });
      expect(ticket!.userId).toBe(userId);

      // Session still marked as converted
      const session = await getSession(t, sessionId);
      expect(session!.convertedToUserId).toBe(userId);
    });

    test('backfills magic_link_redemption_log userId', async () => {
      const t = convexTest();
      const communityAdminId = await createUser(t, 'promoter@test.com');
      const userId = await createUser(t, 'redeemer@test.com');
      const magicLinkId = await createMagicLink(t, communityAdminId);

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'redeemer@test.com',
          magicLinkId,
          sessionToken: 'redemption-migrate-token',
        },
      );

      // Create a redemption record with guestSessionId but no userId
      const redemptionId = (await t.mutation(
        api.testing.magic_links.seedMagicLinkRedemption,
        {
          magicLinkId,
          guestSessionId: sessionId,
        },
      )) as Id<'magic_link_redemption_log'>;

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const redemption = await t.run(async (ctx) => {
        return await ctx.db.get(
          'magic_link_redemption_log',
          redemptionId as Id<'magic_link_redemption_log'>,
        );
      });
      expect(redemption!.userId).toBe(userId);
    });

    test('handles zero-ticket sessions gracefully', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'zerotickets@test.com');

      // Create a guest session with NO tickets and NO payments
      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'zerotickets@test.com',
          sessionToken: 'zero-tickets-token',
        },
      );

      // Act: migrate the session even though it has no tickets or payments
      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      // Assert: session.convertedToUserId === userId
      const session = await getSession(t, sessionId);
      expect(session!.convertedToUserId).toBe(userId);

      // Assert: user's ticket count is 0 (no tickets were transferred)
      const userTickets = await t.run(async (ctx) => {
        return await ctx.db
          .query('tickets')
          .filter((q) => q.eq(q.field('userId'), userId))
          .collect();
      });
      expect(userTickets).toHaveLength(0);
    });

    test('skips silently if session does not exist', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'nocrash@test.com');

      // Create and immediately delete a session to get a valid-format but nonexistent ID
      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'nocrash@test.com',
          sessionToken: 'ghost-token',
        },
      );
      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- deleting session to simulate nonexistent ID for crash safety test */
      await t.run(async (ctx) => {
        await ctx.db.delete(sessionId);
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      // Should not throw
      const result = await t.mutation(
        internal.guest_sessions.core.migrateOneSession,
        {
          sessionId,
          userId,
        },
      );
      expect(result).toBeNull();
    });

    test('transfers ticket_orders ownership and clears guestSessionId', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'orderuser@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'orderuser@test.com',
          sessionToken: 'migrate-orders-token',
        },
      );

      const orderOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Test Org',
          slug: 'test-org-orders',
        },
      );
      const orderEventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Order Event',
        date: '2026-06-01T20:00:00Z',
        price: 2500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId: orderOrgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest order has no userId before migration; no seed helper exists for ticket_orders */
      const orderId = await t.run(async (ctx) => {
        return await ctx.db.insert('ticket_orders', {
          guestSessionId: sessionId,
          eventId: orderEventId,
          kind: 'primary',
          quantity: 1,
          tier: 'regular',
          amountCents: 2500,
          currency: 'USD',
          state: 'completed',
          expiresAt: Date.now() + 60_000,
          completedAt: Date.now(),
          trustSource: 'open_access',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const order = await t.run(async (ctx) => {
        return await ctx.db.get(orderId);
      });
      expect(order!.userId).toBe(userId);
      expect(order!.guestSessionId).toBeUndefined();
    });

    test('carries over address-level marketing opt-out to user preferences', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'optout@test.com');

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'optout@test.com',
          sessionToken: 'migrate-optout-token',
        },
      );

      const prefOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Opt Out Org',
          slug: 'test-org-optout',
        },
      );

      await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
        email: 'optout@test.com',
        organizerId: prefOrgId,
        optedIn: false,
        unsubToken: 'optout-unsub-token',
      });

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const userPref = await t.run(async (ctx) =>
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', prefOrgId),
          )
          .unique(),
      );
      expect(userPref).not.toBeNull();
      expect(userPref!.optedIn).toBe(false);
    });

    test('does not re-subscribe a user who explicitly opted out when an address opt-in default exists', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'explicit-optout@test.com');
      const asUser = t.withIdentity({subject: userId});

      const prefOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Explicit Opt Out Org',
          slug: 'test-org-explicit-optout',
        },
      );

      // User explicitly opts out of this organizer's marketing (user-level).
      await asUser.mutation(api.marketing.emails.updateMarketingPreference, {
        organizerId: prefOrgId,
        optedIn: false,
      });

      // Later, logged out, the same email buys a guest ticket and a broadcast
      // lazily mints an address preference defaulting to optedIn:true.
      await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
        email: 'explicit-optout@test.com',
        organizerId: prefOrgId,
        optedIn: true,
        unsubToken: 'explicit-optout-address-token',
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'explicit-optout@test.com',
          sessionToken: 'migrate-explicit-optout-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const userPref = await t.run(async (ctx) =>
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', prefOrgId),
          )
          .unique(),
      );
      // The explicit opt-out must survive migration — no silent re-subscribe.
      expect(userPref).not.toBeNull();
      expect(userPref!.optedIn).toBe(false);
    });

    test('creates an opted-in user preference from an address opt-in when the user has no prior preference', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'new-optin@test.com');

      const prefOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'New Opt In Org',
          slug: 'test-org-new-optin',
        },
      );

      // No user-level preference exists yet; only an address-level opt-in.
      await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
        email: 'new-optin@test.com',
        organizerId: prefOrgId,
        optedIn: true,
        unsubToken: 'new-optin-address-token',
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'new-optin@test.com',
          sessionToken: 'migrate-new-optin-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const userPref = await t.run(async (ctx) =>
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', prefOrgId),
          )
          .unique(),
      );
      // Genuine new opt-ins are preserved for users with no prior choice.
      expect(userPref).not.toBeNull();
      expect(userPref!.optedIn).toBe(true);
    });

    test('carries an address-level unsubscribe over an existing user opt-in', async () => {
      const t = convexTest();
      const userId = await createUser(t, 'optin-then-unsub@test.com');
      const asUser = t.withIdentity({subject: userId});

      const prefOrgId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Opt In Then Unsub Org',
          slug: 'test-org-optin-then-unsub',
        },
      );

      // User is opted in at the user level.
      await asUser.mutation(api.marketing.emails.updateMarketingPreference, {
        organizerId: prefOrgId,
        optedIn: true,
      });

      // As a guest, they unsubscribed against the address (optedIn:false).
      await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
        email: 'optin-then-unsub@test.com',
        organizerId: prefOrgId,
        optedIn: false,
        unsubToken: 'optin-then-unsub-address-token',
      });

      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'optin-then-unsub@test.com',
          sessionToken: 'migrate-optin-then-unsub-token',
        },
      );

      await t.mutation(internal.guest_sessions.core.migrateOneSession, {
        sessionId,
        userId,
      });

      const userPref = await t.run(async (ctx) =>
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', prefOrgId),
          )
          .unique(),
      );
      // The unsubscribe wins — migration propagates opt-outs.
      expect(userPref).not.toBeNull();
      expect(userPref!.optedIn).toBe(false);
    });
  });
});
