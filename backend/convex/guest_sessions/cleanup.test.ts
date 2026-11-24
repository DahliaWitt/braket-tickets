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

  test('retires expired sessions in place when referenced by a ticket, order, or magic-link redemption and permanently revokes credentials', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const start = Date.now();
      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Cleanup Admin',
        email: 'cleanup-ref-admin@example.com',
      });
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Cleanup Ref Org',
          slug: 'cleanup-ref-org',
          isPlatformOrganizer: true,
        },
      );
      const freeEventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Cleanup Free Event',
        date: '2099-06-01T20:00:00Z',
        price: 0,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      const paidEventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Cleanup Paid Event',
        date: '2099-06-01T20:00:00Z',
        price: 1500,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId,
      });
      const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
        createdBy: adminId,
        organizerId,
        token: 'cleanup-ref-magic-link',
        status: 'active',
      });

      const expiresAt = start + 60_000;
      const ticketSessionId = await createGuestSession(t, {
        email: 'ticket-owner@example.com',
        sessionToken: 'ticket-owner-token',
        expiresAt,
      });
      const orderSessionId = await createGuestSession(t, {
        email: 'order-owner@example.com',
        sessionToken: 'order-owner-token',
        expiresAt,
      });
      const redemptionSessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'redemption-owner@example.com',
          sessionToken: 'redemption-owner-token',
          magicLinkId: linkId,
          expiresAt,
        },
      );

      // Seed references through production mutations:
      // 1) ticket + completed order via claimFreeTicketAsGuest
      await t.mutation(api.orders.core.claimFreeTicketAsGuest, {
        sessionToken: 'ticket-owner-token',
        eventId: freeEventId,
        quantity: 1,
        tier: 'regular',
        termsAccepted: true,
        idempotencyKey: 'idem-cleanup-ticket-owner',
      });
      // 2) pending resume token prepared while session is still active
      const prepared = await t.mutation(
        internal.guest_sessions.core.prepareResumeSessionToken,
        {
          sessionId: ticketSessionId,
          sessionToken: 'pending-ticket-owner-token',
        },
      );
      expect(prepared).toEqual({status: 'prepared'});
      // 3) order-only reference (no ticket issued yet) via openForGuest
      await t.mutation(api.orders.core.openForGuest, {
        sessionToken: 'order-owner-token',
        eventId: paidEventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 1500,
        termsAccepted: true,
      });

      // Advance clock past expiresAt so cleanup retires all three.
      vi.advanceTimersByTime(120_000);

      const firstRun = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      expect(firstRun).toBe(3);

      // Subsequent cleanup run must skip already-retired rows without re-scanning.
      const secondRun = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      expect(secondRun).toBe(0);

      for (const [id, expectedEmail] of [
        [ticketSessionId, 'ticket-owner@example.com'],
        [orderSessionId, 'order-owner@example.com'],
        [redemptionSessionId, 'redemption-owner@example.com'],
      ] as const) {
        const session = await t.run(async (ctx) =>
          ctx.db.get('guest_sessions', id),
        );
        expect(session).not.toBeNull();
        expect(session!.email).toBe(expectedEmail);
        expect(session!.retiredAt).toBeTypeOf('number');
        expect(session!.sessionToken).toBeUndefined();
        expect(session!.sessionTokenDigest).toBeUndefined();
        expect(session!.sessionTokenPrefix).toBeUndefined();
        expect(session!.pendingSessionTokenDigest).toBeUndefined();
        expect(session!.pendingSessionTokenPrefix).toBeUndefined();
      }

      // Pass a timestamp BEFORE expiresAt to prove credential revocation
      // independently of wall-clock expiry for both primary and pending tokens.
      const beforeExpiry = expiresAt - 1_000;
      const primaryLookup = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'ticket-owner-token',
          now: beforeExpiry,
        },
      );
      const pendingLookup = await t.query(
        internal.guest_sessions.core.getBySessionToken,
        {
          sessionToken: 'pending-ticket-owner-token',
          now: beforeExpiry,
        },
      );
      expect(primaryLookup).toBeNull();
      expect(pendingLookup).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('deletes expired unreferenced sessions stuck behind >=200 retained retired sessions without re-scanning them', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const now = Date.now();
      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Retired Head Admin',
        email: 'retired-head-admin@example.com',
      });
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Retired Head Org',
          slug: 'retired-head-org',
        },
      );
      const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
        createdBy: adminId,
        organizerId,
        token: 'retired-head-magic-link',
        status: 'active',
      });

      // Seed CLEANUP_BATCH_SIZE expired sessions with redemption references so
      // they are retired in place and sit at older expiresAt timestamps.
      await Promise.all(
        Array.from({length: CLEANUP_BATCH_SIZE}, (_unused, i) =>
          t.mutation(api.testing.guest_sessions.seedGuestSession, {
            email: `retained-${i}@example.com`,
            sessionToken: `retained-token-${i}`,
            magicLinkId: linkId,
            expiresAt: now - 20_000,
          }),
        ),
      );

      // First cleanup retires all CLEANUP_BATCH_SIZE referenced rows.
      const firstCleaned = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      await finishAllScheduledFunctions(t);
      expect(firstCleaned).toBe(CLEANUP_BATCH_SIZE);

      // Now add unreferenced expired sessions with newer expiresAt behind the
      // retained rows.
      const unreferencedIds = await Promise.all(
        Array.from({length: 3}, (_unused, i) =>
          createGuestSession(t, {
            email: `behind-retired-${i}@example.com`,
            sessionToken: `behind-retired-token-${i}`,
            expiresAt: now - 1_000,
          }),
        ),
      );

      const secondCleaned = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      await finishAllScheduledFunctions(t);
      expect(secondCleaned).toBe(3);

      await t.run(async (ctx) => {
        for (const id of unreferencedIds) {
          expect(await ctx.db.get('guest_sessions', id)).toBeNull();
        }
      });

      const retainedRows = await t.run(async (ctx) =>
        ctx.db
          .query('guest_sessions')
          .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
          .collect(),
      );
      expect(retainedRows).toHaveLength(CLEANUP_BATCH_SIZE);
      expect(retainedRows.every((s) => s.retiredAt !== undefined)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
