import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {logger} from '../../lib/logger';
import {digestBearerToken, tokenPrefix} from '../token_digests';

/** Hard session expiry (24 hours). */
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Sliding inactivity window (2 hours). */
const INACTIVITY_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Minimum time between lastActive updates. */
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;

type SessionLookupCtx = {
  db: QueryCtx['db'];
};

export function isGuestSessionActive(
  session: Pick<
    Doc<'guest_sessions'>,
    'expiresAt' | 'lastActiveAt' | 'convertedToUserId'
  >,
  now: number,
): boolean {
  if (session.convertedToUserId) return false;
  if (now > session.expiresAt) return false;
  if (
    session.lastActiveAt &&
    now - session.lastActiveAt > INACTIVITY_WINDOW_MS
  ) {
    return false;
  }

  return true;
}

/**
 * Pure token-to-session lookup. Does NOT check freshness or conversion state —
 * deterministic and safe to call from query handlers. Use this when the caller
 * gates on something else (e.g. the order's `guestSessionId` match) and only
 * needs to resolve the session row.
 */
export async function findGuestSessionByToken(
  ctx: SessionLookupCtx,
  sessionToken: string,
): Promise<Doc<'guest_sessions'> | null> {
  const sessionTokenDigest = await digestBearerToken(
    'guest_session',
    sessionToken,
  );
  return (
    (await ctx.db
      .query('guest_sessions')
      .withIndex('by_sessionTokenDigest', (q) =>
        q.eq('sessionTokenDigest', sessionTokenDigest),
      )
      .first()) ??
    (await ctx.db
      .query('guest_sessions')
      .withIndex('by_pendingSessionTokenDigest', (q) =>
        q.eq('pendingSessionTokenDigest', sessionTokenDigest),
      )
      .first()) ??
    (await ctx.db
      .query('guest_sessions')
      .withIndex('by_sessionToken', (q) => q.eq('sessionToken', sessionToken))
      .first())
  );
}

export async function getActiveGuestSession(
  ctx: SessionLookupCtx,
  sessionToken: string,
  now: number,
): Promise<Doc<'guest_sessions'> | null> {
  const session = await findGuestSessionByToken(ctx, sessionToken);
  if (!session || !isGuestSessionActive(session, now)) return null;
  return session;
}

export async function createGuestSession(
  ctx: MutationCtx,
  args: {
    email: string;
    clientKey?: string;
    magicLinkId?: Id<'magic_links'>;
    sessionToken: string;
    expiresAt?: number;
    lastActiveAt?: number;
  },
): Promise<Id<'guest_sessions'>> {
  const now = Date.now();
  const sessionTokenDigest = await digestBearerToken(
    'guest_session',
    args.sessionToken,
  );
  const sessionId = await ctx.db.insert('guest_sessions', {
    email: args.email.toLowerCase(),
    clientKey: args.clientKey,
    magicLinkId: args.magicLinkId,
    sessionTokenDigest,
    sessionTokenPrefix: tokenPrefix(args.sessionToken),
    expiresAt: args.expiresAt ?? now + SESSION_EXPIRY_MS,
    lastActiveAt: args.lastActiveAt,
  });

  if (args.magicLinkId) {
    await ctx.db.insert('magic_link_redemption_log', {
      magicLinkId: args.magicLinkId,
      guestSessionId: sessionId,
      redeemedAt: now,
    });
  }

  return sessionId;
}

export async function updateGuestSessionLastActive(
  ctx: MutationCtx,
  sessionId: Id<'guest_sessions'>,
): Promise<void> {
  const now = Date.now();
  const session = await ctx.db.get('guest_sessions', sessionId);
  if (!session) return;
  if (!isGuestSessionActive(session, now)) return;

  if (
    !session.lastActiveAt ||
    now - session.lastActiveAt > LAST_ACTIVE_THROTTLE_MS
  ) {
    await ctx.db.patch('guest_sessions', sessionId, {lastActiveAt: now});
  }
}

export async function attachMagicLinkTrustToGuestSession(
  ctx: MutationCtx,
  sessionId: Id<'guest_sessions'>,
  magicLinkId: Id<'magic_links'>,
): Promise<void> {
  const session = await ctx.db.get('guest_sessions', sessionId);
  if (!session) return;

  const patch: Partial<Doc<'guest_sessions'>> = {};
  if (session.magicLinkId !== magicLinkId) {
    patch.magicLinkId = magicLinkId;
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch('guest_sessions', sessionId, patch);
  }

  const existingRedemption = await ctx.db
    .query('magic_link_redemption_log')
    .withIndex('by_magicLink_guest', (q) =>
      q.eq('magicLinkId', magicLinkId).eq('guestSessionId', sessionId),
    )
    .first();

  if (!existingRedemption) {
    await ctx.db.insert('magic_link_redemption_log', {
      magicLinkId,
      guestSessionId: sessionId,
      redeemedAt: Date.now(),
    });
  }
}

export async function deleteGuestSession(
  ctx: MutationCtx,
  sessionId: Id<'guest_sessions'>,
): Promise<void> {
  await ctx.db.delete('guest_sessions', sessionId);
}

export async function cleanupExpiredGuestSessions(
  ctx: MutationCtx,
): Promise<number> {
  const now = Date.now();
  const candidates = await ctx.db
    .query('guest_sessions')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
    .take(200);

  const expiredSessions = candidates.filter(
    (session) => session.convertedToUserId === undefined,
  );
  await Promise.all(
    expiredSessions.map((session) =>
      ctx.db.delete('guest_sessions', session._id),
    ),
  );

  const cleaned = expiredSessions.length;
  if (cleaned > 0) {
    logger.info('guest_sessions', '[CRON] Cleaned up expired guest sessions', {
      cleaned,
    });
  }

  if (candidates.length === 200) {
    await ctx.scheduler.runAfter(
      0,
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
  }

  return cleaned;
}
