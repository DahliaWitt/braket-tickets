import {expect, test, describe} from 'vitest';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

/**
 * Tests for:
 * 1. cleanupExpiredSessions (cron cleanup mutation)
 */

async function createGuestSession(
  t: ReturnType<typeof convexTest>,
  overrides: {
    email?: string;
    sessionToken?: string;
    expiresAt?: number;
    convertedToUserId?: Id<'users'>;
    lastActiveAt?: number;
  } = {},
): Promise<Id<'guest_sessions'>> {
  const now = Date.now();
  return await t.mutation(api.testing.guest_sessions.seedGuestSession, {
    email: overrides.email ?? 'guest@example.com',
    sessionToken:
      overrides.sessionToken ?? `token-${Math.random().toString(36).slice(2)}`,
    expiresAt: overrides.expiresAt ?? now + 24 * 60 * 60 * 1000,
    lastActiveAt: overrides.lastActiveAt ?? now,
    convertedToUserId: overrides.convertedToUserId,
  });
}

// -- cleanupExpiredSessions tests --

describe('cleanupExpiredSessions', () => {
  test('deletes expired, non-converted sessions', async () => {
    const t = convexTest();
    const pastExpiry = Date.now() - 1000;

    const sessionId = await createGuestSession(t, {
      email: 'expired@example.com',
      expiresAt: pastExpiry,
    });

    const cleaned = await t.mutation(
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
    expect(cleaned).toBe(1);

    // Verify session was deleted
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session).toBeNull();
  });

  test('preserves non-expired sessions', async () => {
    const t = convexTest();
    const futureExpiry = Date.now() + 24 * 60 * 60 * 1000;

    const sessionId = await createGuestSession(t, {
      email: 'active@example.com',
      expiresAt: futureExpiry,
    });

    const cleaned = await t.mutation(
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
    expect(cleaned).toBe(0);

    // Verify session still exists
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session).not.toBeNull();
  });

  test('preserves converted sessions even if expired', async () => {
    const t = convexTest();
    const pastExpiry = Date.now() - 1000;

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Converted User',
      email: 'converted@example.com',
    });

    const sessionId = await createGuestSession(t, {
      email: 'converted@example.com',
      expiresAt: pastExpiry,
      convertedToUserId: userId,
    });

    const cleaned = await t.mutation(
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
    expect(cleaned).toBe(0);

    // Verify session still exists (audit trail preserved)
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session).not.toBeNull();
    expect(session!.convertedToUserId).toBe(userId);
  });

  test('handles mixed expired and non-expired sessions', async () => {
    const t = convexTest();
    const pastExpiry = Date.now() - 1000;
    const futureExpiry = Date.now() + 24 * 60 * 60 * 1000;

    // Two expired, one active
    await createGuestSession(t, {
      email: 'expired1@example.com',
      expiresAt: pastExpiry,
      sessionToken: 'expired-1',
    });
    await createGuestSession(t, {
      email: 'expired2@example.com',
      expiresAt: pastExpiry,
      sessionToken: 'expired-2',
    });
    const activeId = await createGuestSession(t, {
      email: 'active@example.com',
      expiresAt: futureExpiry,
      sessionToken: 'active-1',
    });

    const cleaned = await t.mutation(
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
    expect(cleaned).toBe(2);

    // Active session survives
    const activeSession = await t.run(async (ctx) => ctx.db.get(activeId));
    expect(activeSession).not.toBeNull();
  });

  test('returns 0 when no sessions exist', async () => {
    const t = convexTest();

    const cleaned = await t.mutation(
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
    expect(cleaned).toBe(0);
  });
});
