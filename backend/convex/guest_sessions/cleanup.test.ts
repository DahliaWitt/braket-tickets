import {expect, test, describe, vi} from 'vitest';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {CLEANUP_BATCH_SIZE} from '../lib/guest_sessions/lifecycle';

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

  // Regression: converted sessions are preserved forever (audit trail) but their
  // expiresAt still lapses. Once >= CLEANUP_BATCH_SIZE converted-expired rows
  // exist they sort to the head of the ascending expiresAt range. The old
  // implementation scanned by_expiresAt, took the first 200 rows (all
  // converted), filtered them all out (deleted nothing), yet rescheduled
  // because candidates.length === 200 — an infinite zero-progress runAfter(0)
  // chain that never reached the expired unconverted rows behind them.
  test('deletes expired unconverted sessions stuck behind >=200 converted expired sessions', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const now = Date.now();
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Converted User',
        email: 'converted-head@example.com',
      });

      // Converted rows expired further in the past so they occupy the head of
      // the ascending by_expiresAt range, ahead of the unconverted rows.
      await Promise.all(
        Array.from({length: CLEANUP_BATCH_SIZE}, (_unused, i) =>
          createGuestSession(t, {
            email: `converted-${i}@example.com`,
            sessionToken: `converted-token-${i}`,
            expiresAt: now - 10_000,
            convertedToUserId: userId,
          }),
        ),
      );

      const unconvertedIds = await Promise.all(
        Array.from({length: 3}, (_unused, i) =>
          createGuestSession(t, {
            email: `stuck-${i}@example.com`,
            sessionToken: `stuck-token-${i}`,
            expiresAt: now - 1_000,
          }),
        ),
      );

      const cleaned = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      // Drain any self-reschedule; a correct implementation terminates.
      await finishAllScheduledFunctions(t);

      expect(cleaned).toBe(3);

      // The unconverted expired rows are gone.
      await t.run(async (ctx) => {
        for (const id of unconvertedIds) {
          expect(await ctx.db.get(id)).toBeNull();
        }
      });

      // All converted rows are preserved for the audit trail.
      const remainingConverted = await t.run(async (ctx) =>
        ctx.db
          .query('guest_sessions')
          .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
          .collect(),
      );
      expect(remainingConverted).toHaveLength(CLEANUP_BATCH_SIZE);
      expect(
        remainingConverted.every((s) => s.convertedToUserId === userId),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Verifies the self-rescheduling chain drains a backlog larger than one batch
  // and terminates, deleting every expired unconverted row while preserving
  // converted ones.
  test('paginates a multi-batch backlog to completion and terminates', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const now = Date.now();
      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Converted User',
        email: 'converted-multi@example.com',
      });

      const backlog = CLEANUP_BATCH_SIZE + 5;
      await Promise.all(
        Array.from({length: backlog}, (_unused, i) =>
          createGuestSession(t, {
            email: `backlog-${i}@example.com`,
            sessionToken: `backlog-token-${i}`,
            expiresAt: now - 1_000,
          }),
        ),
      );
      await Promise.all(
        Array.from({length: 5}, (_unused, i) =>
          createGuestSession(t, {
            email: `keep-${i}@example.com`,
            sessionToken: `keep-token-${i}`,
            expiresAt: now - 10_000,
            convertedToUserId: userId,
          }),
        ),
      );

      const firstBatch = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      expect(firstBatch).toBe(CLEANUP_BATCH_SIZE);

      // Run the rescheduled continuation(s) to completion. If the chain failed
      // to terminate, this would exhaust the iteration cap and throw.
      await finishAllScheduledFunctions(t);

      const remaining = await t.run(async (ctx) =>
        ctx.db
          .query('guest_sessions')
          .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
          .collect(),
      );
      // Only the converted rows survive; every unconverted expired row is gone.
      expect(remaining).toHaveLength(5);
      expect(remaining.every((s) => s.convertedToUserId === userId)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
