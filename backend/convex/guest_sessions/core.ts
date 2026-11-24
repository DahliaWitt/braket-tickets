/**
 * Guest session internal queries and mutations for checkout without an account.
 *
 * Guest sessions are created via initiateGuestSession (action) and have
 * a 24h hard expiry + 2h sliding inactivity window. No email verification
 * required — the session token is the credential.
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
  findActiveGuestSessionByEmail,
  getActiveGuestSession,
  isGuestSessionActive,
  loadUnretiredGuestSessionsByEmail,
  retireGuestSessionDoc,
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
import {throwPaymentAppError} from '../lib/payment_errors';
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

export const getReusableByEmail = internalQuery({
  args: {email: v.string(), now: v.number()},
  returns: v.union(guestSessionDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await findActiveGuestSessionByEmail(ctx, args.email, args.now);
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
      if (!evaluation.valid) {
        const validation = await validateMagicLinkToken(ctx.db, {
          token: args.magicLinkToken,
          now,
        });
        throwAppError(
          'INVALID_MAGIC_LINK',
          getMagicLinkErrorMessage(validation.error),
        );
      }

      magicLinkId = evaluation.link._id;
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

    const unretiredSessions = await loadUnretiredGuestSessionsByEmail(
      ctx,
      email,
    );

    if (
      unretiredSessions.some((session) => isGuestSessionActive(session, now))
    ) {
      throwPaymentAppError(
        'SESSION_RESUME_REQUIRED',
        'An active guest session already exists for this email. Resume checkout from the same device or wait for the session to expire.',
      );
    }

    await Promise.all(
      unretiredSessions.map((session) =>
        retireGuestSessionDoc(ctx, session, now),
      ),
    );

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
    const now = Date.now();
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session || !isGuestSessionActive(session, now)) {
      return null;
    }

    await ctx.db.patch('guest_sessions', args.sessionId, {
      sessionTokenDigest: await digestBearerToken(
        'guest_session',
        args.sessionToken,
      ),
      sessionTokenPrefix: tokenPrefix(args.sessionToken),
      sessionToken: undefined,
      lastActiveAt: now,
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
    const now = Date.now();
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session || !isGuestSessionActive(session, now)) {
      return {status: 'missing' as const};
    }
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

export const promoteResumeSessionToken = internalMutation({
  args: {sessionId: v.id('guest_sessions'), sessionToken: v.string()},
  returns: v.object({
    status: v.union(
      v.literal('promoted'),
      v.literal('inactive'),
      v.literal('skipped'),
    ),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session) return {status: 'inactive' as const};

    const tokenDigest = await digestBearerToken(
      'guest_session',
      args.sessionToken,
    );

    if (!isGuestSessionActive(session, now)) {
      if (session.pendingSessionTokenDigest === tokenDigest) {
        await ctx.db.patch('guest_sessions', args.sessionId, {
          pendingSessionTokenDigest: undefined,
          pendingSessionTokenPrefix: undefined,
        });
      }
      return {status: 'inactive' as const};
    }

    if (
      !session.pendingSessionTokenDigest &&
      session.sessionTokenDigest === tokenDigest
    ) {
      return {status: 'promoted' as const};
    }

    if (session.pendingSessionTokenDigest !== tokenDigest) {
      return {status: 'skipped' as const};
    }

    await ctx.db.patch('guest_sessions', args.sessionId, {
      sessionTokenDigest: session.pendingSessionTokenDigest,
      sessionTokenPrefix: session.pendingSessionTokenPrefix,
      pendingSessionTokenDigest: undefined,
      pendingSessionTokenPrefix: undefined,
      sessionToken: undefined,
      lastActiveAt: now,
    });
    return {status: 'promoted' as const};
  },
});

export const clearResumeSessionToken = internalMutation({
  args: {sessionId: v.id('guest_sessions'), sessionToken: v.string()},
  returns: v.object({
    status: v.union(
      v.literal('cleared'),
      v.literal('inactive'),
      v.literal('skipped'),
    ),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const session = await ctx.db.get('guest_sessions', args.sessionId);
    if (!session) return {status: 'inactive' as const};

    const tokenDigest = await digestBearerToken(
      'guest_session',
      args.sessionToken,
    );
    const matchesPending = session.pendingSessionTokenDigest === tokenDigest;
    if (matchesPending) {
      await ctx.db.patch('guest_sessions', args.sessionId, {
        pendingSessionTokenDigest: undefined,
        pendingSessionTokenPrefix: undefined,
      });
    }

    if (!isGuestSessionActive(session, now)) {
      return {status: 'inactive' as const};
    }

    return {
      status: matchesPending ? ('cleared' as const) : ('skipped' as const),
    };
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
  args: {
    sessionId: v.id('guest_sessions'),
    sessionToken: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await updateGuestSessionLastActive(
      ctx,
      args.sessionId,
      args.sessionToken,
    );
  },
});

/**
 * Retire expired guest sessions.
 * Runs as a cron job. Unreferenced sessions past their 24h expiresAt are
 * deleted; sessions referenced by tickets, orders, or magic-link redemptions
 * are retired in place (retiredAt set, credentials cleared) so ownership and
 * contact records remain intact. Converted sessions are preserved as-is.
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
