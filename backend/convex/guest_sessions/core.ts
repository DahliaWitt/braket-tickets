/**
 * Guest session internal queries and mutations for checkout without an account.
 *
 * Guest sessions are created via initiateGuestSession (action) and have
 * a 24h hard expiry + 2h sliding inactivity window. No email verification
 * required — the session token is the credential.
 *
 * One email may hold multiple concurrent sessions: each tokenless re-entry
 * (new device/browser) mints a fresh session rather than gating on the old
 * one. Cross-session invariants are enforced per email where they matter:
 * ticket limits (lib/orders/open.ts) and magic-link redemption dedup
 * (lib/guest_sessions/lifecycle.ts).
 *
 * Architecture:
 * - This file: internal queries/mutations for DB operations (V8 runtime).
 * - guest_sessions_actions.ts: public actions (Node.js runtime).
 * - Rate limiting prevents abuse of session initiation.
 */

import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import {loadFirstMagicLinkByToken} from '../lib/indexed_loaders';
import {
  attachMagicLinkTrustToGuestSession,
  cleanupExpiredGuestSessions,
  createGuestSession,
  deleteGuestSession,
  getActiveGuestSession,
  hasEmailRedeemedMagicLink,
  isGuestSessionActive,
  listGuestSessionsByEmail,
  updateGuestSessionLastActive,
} from '../lib/guest_sessions/lifecycle';
import {
  evaluateMagicLinkState,
  validateMagicLinkToken,
} from '../lib/magic_links/validation';
import {
  getUnmigratedGuestSessionsByEmail,
  migrateGuestSessionsForUser,
  migrateOneGuestSessionToUser,
} from '../lib/guest_sessions/migration';
import {guestSessionDocValidator} from '../lib/guest_sessions/validators';
import {throwAppError} from '../lib/errors';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';

function getMagicLinkErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'paused':
      return 'This magic link is paused';
    case 'disabled':
      return 'This magic link is disabled';
    case 'expired':
      return 'This magic link has expired';
    case 'maxed':
      return 'This magic link has reached its redemption limit';
    default:
      return 'This magic link is invalid';
  }
}

/**
 * Best courtesy-resume target among an email's active sessions.
 *
 * With multiple concurrent sessions per email, the newest one may be an empty
 * just-minted session while an older one holds the buyer's in-flight
 * checkout. Prefer a session with an open ticket order (something to actually
 * resume), then fall back to the most recently active session.
 */
export const getResumeTargetByEmail = internalQuery({
  args: {email: v.string(), now: v.number()},
  returns: v.union(guestSessionDocValidator, v.null()),
  handler: async (ctx, args) => {
    const sessions = await listGuestSessionsByEmail(
      ctx.db,
      args.email.toLowerCase(),
    );
    const activeSessions = sessions.filter(
      (session) =>
        !session.convertedToUserId && isGuestSessionActive(session, args.now),
    );
    if (activeSessions.length === 0) return null;

    const lastTouched = (session: (typeof activeSessions)[number]): number =>
      session.lastActiveAt ?? session._creationTime;

    let fallback = activeSessions[0];
    for (const session of activeSessions) {
      if (lastTouched(session) > lastTouched(fallback)) {
        fallback = session;
      }
    }

    let bestWithOpenOrder: (typeof activeSessions)[number] | null = null;
    for (const session of activeSessions) {
      // The index ends in `state` but is prefixed by eventId, which we don't
      // know here — read the session's orders (a session holds only a
      // handful) and check state in memory.
      const orders = await ctx.db
        .query('ticket_orders')
        .withIndex('by_owner_guest_event_state', (q) =>
          q.eq('guestSessionId', session._id),
        )
        .take(50);
      if (!orders.some((order) => order.state === 'open')) continue;
      if (
        bestWithOpenOrder === null ||
        lastTouched(session) > lastTouched(bestWithOpenOrder)
      ) {
        bestWithOpenOrder = session;
      }
    }

    return bestWithOpenOrder ?? fallback;
  },
});

export const getBySessionToken = internalQuery({
  args: {sessionToken: v.string(), now: v.number()},
  returns: v.union(guestSessionDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await getActiveGuestSession(ctx, args.sessionToken, args.now);
  },
});

export const initiate = internalMutation({
  args: {
    email: v.string(),
    existingSessionToken: v.optional(v.string()),
    magicLinkToken: v.optional(v.string()),
    sessionToken: v.string(),
  },
  returns: v.object({
    sessionToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = args.email.toLowerCase();

    let magicLinkId: Id<'magic_links'> | undefined;

    if (args.magicLinkToken) {
      const link = await loadFirstMagicLinkByToken(ctx.db, args.magicLinkToken);
      const evaluation = await evaluateMagicLinkState(ctx.db, link, now);
      if (evaluation.valid) {
        magicLinkId = evaluation.link._id;
      } else if (
        evaluation.error === 'maxed' &&
        link &&
        (await hasEmailRedeemedMagicLink(ctx.db, link._id, email))
      ) {
        // The redemption cap is already accounted for by this email's earlier
        // redemption, and createGuestSession will not burn another. A buyer's
        // own redemption must never lock them out of re-entering their email
        // on a new device via the same link.
        magicLinkId = link._id;
      } else {
        const validation = await validateMagicLinkToken(ctx.db, {
          token: args.magicLinkToken,
          now,
        });
        throwAppError(
          'INVALID_MAGIC_LINK',
          getMagicLinkErrorMessage(validation.error),
        );
      }
    }

    if (args.existingSessionToken) {
      const existingByToken = await getActiveGuestSession(
        ctx,
        args.existingSessionToken,
        now,
      );

      if (
        existingByToken &&
        existingByToken.email === email &&
        !existingByToken.convertedToUserId
      ) {
        const existingSessionTokenDigest = await digestBearerToken(
          'guest_session',
          args.existingSessionToken,
        );
        if (!existingByToken.sessionTokenDigest) {
          await ctx.db.patch('guest_sessions', existingByToken._id, {
            sessionTokenDigest: existingSessionTokenDigest,
            sessionTokenPrefix: tokenPrefix(args.existingSessionToken),
            sessionToken: undefined,
          });
        } else if (
          existingByToken.pendingSessionTokenDigest ===
          existingSessionTokenDigest
        ) {
          await ctx.db.patch('guest_sessions', existingByToken._id, {
            sessionTokenDigest: existingSessionTokenDigest,
            sessionTokenPrefix: tokenPrefix(args.existingSessionToken),
            pendingSessionTokenDigest: undefined,
            pendingSessionTokenPrefix: undefined,
            sessionToken: undefined,
          });
        }
        await updateGuestSessionLastActive(ctx, existingByToken._id);
        if (magicLinkId) {
          await attachMagicLinkTrustToGuestSession(
            ctx,
            existingByToken._id,
            magicLinkId,
          );
        }
        return {sessionToken: args.existingSessionToken};
      }
    }

    // A concurrent active session for this email is allowed: re-entering an
    // email from a new device/browser mints a fresh session instead of hard-
    // stopping checkout (cross-session invariants — per-email ticket limits,
    // magic-link redemption dedup — are enforced where they matter). Only
    // reap the newest stale session as opportunistic hygiene; the cleanup
    // cron handles the rest.
    const existing = await ctx.db
      .query('guest_sessions')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .first();

    // Ticket ownership survives this delete: guest tickets are anchored by
    // tickets.guestEmailLower at issuance, so the per-email cap does not
    // depend on session rows staying alive.
    if (
      existing &&
      !existing.convertedToUserId &&
      !isGuestSessionActive(existing, now)
    ) {
      await deleteGuestSession(ctx, existing._id);
    }

    await createGuestSession(ctx, {
      email,
      ...(magicLinkId ? {magicLinkId} : {}),
      sessionToken: args.sessionToken,
    });

    return {sessionToken: args.sessionToken};
  },
});

export const rotateSessionToken = internalMutation({
  args: {sessionId: v.id('guest_sessions'), sessionToken: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch('guest_sessions', args.sessionId, {
      sessionTokenDigest: await digestBearerToken(
        'guest_session',
        args.sessionToken,
      ),
      sessionTokenPrefix: tokenPrefix(args.sessionToken),
      sessionToken: undefined,
      lastActiveAt: Date.now(),
    });
    return null;
  },
});

export const prepareResumeSessionToken = internalMutation({
  args: {sessionId: v.id('guest_sessions'), sessionToken: v.string()},
  returns: v.object({
    status: v.union(
      v.literal('prepared'),
      v.literal('already_pending'),
      v.literal('missing'),
    ),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session) return {status: 'missing' as const};
    if (session.pendingSessionTokenDigest) {
      return {status: 'already_pending' as const};
    }

    await ctx.db.patch('guest_sessions', args.sessionId, {
      pendingSessionTokenDigest: await digestBearerToken(
        'guest_session',
        args.sessionToken,
      ),
      pendingSessionTokenPrefix: tokenPrefix(args.sessionToken),
    });
    return {status: 'prepared' as const};
  },
});

export const clearResumeSessionToken = internalMutation({
  args: {sessionId: v.id('guest_sessions'), sessionToken: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session?.pendingSessionTokenDigest) return null;
    const tokenDigest = await digestBearerToken(
      'guest_session',
      args.sessionToken,
    );
    if (session.pendingSessionTokenDigest !== tokenDigest) return null;

    await ctx.db.patch('guest_sessions', args.sessionId, {
      pendingSessionTokenDigest: undefined,
      pendingSessionTokenPrefix: undefined,
    });
    return null;
  },
});

export const getById = internalQuery({
  args: {sessionId: v.id('guest_sessions')},
  returns: v.union(guestSessionDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get('guest_sessions', args.sessionId);
  },
});

export const updateLastActive = internalMutation({
  args: {sessionId: v.id('guest_sessions')},
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateGuestSessionLastActive(ctx, args.sessionId);
    return null;
  },
});

/**
 * Clean up expired guest sessions.
 * Runs as a cron job. Sessions past their 24h expiresAt are deleted.
 * Sessions that were converted to users (convertedToUserId set) are preserved
 * for audit trail but could be cleaned up after a longer retention period.
 */
export const cleanupExpiredSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    return await cleanupExpiredGuestSessions(ctx);
  },
});

export const getUnmigratedByEmail = internalQuery({
  args: {email: v.string()},
  returns: v.array(guestSessionDocValidator),
  handler: async (ctx, args) => {
    return await getUnmigratedGuestSessionsByEmail(ctx, args.email);
  },
});

/**
 * Migrate a single guest session's data to a real user account.
 *
 * Transfers tickets, payments, and magic_link_redemption_log rows from the guest
 * session to the user. Community access continues to come from the migrated
 * redemption/application records rather than a user-level trust flag.
 *
 * Idempotent: skips silently if the session is already converted.
 */
export const migrateOneSession = internalMutation({
  args: {
    sessionId: v.id('guest_sessions'),
    userId: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await migrateOneGuestSessionToUser(ctx, args);
    return null;
  },
});

/**
 * Background action to migrate all unmigrated guest sessions for an email
 * to a real user account. Processes sessions one at a time to avoid OCC
 * contention when multiple sessions exist.
 *
 * Triggered by syncUser via ctx.scheduler.runAfter(0, ...).
 */
export const migrateGuestToUser = internalAction({
  args: {
    email: v.string(),
    userId: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await migrateGuestSessionsForUser(ctx, args);
    return null;
  },
});
