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

/**
 * Bounded scan cap for sessions sharing one email. Session creation is
 * rate-limited per email and sessions hard-expire after 24h, so real counts
 * stay single-digit; the cap only guards against pathological data.
 */
export const EMAIL_SESSION_SCAN_LIMIT = 100;

/**
 * All sessions (active, expired, converted) currently stored for an email.
 * Multiple concurrent sessions per email are expected: re-entering an email
 * on a new device/browser mints a fresh session instead of gating on the old
 * one, so cross-session invariants (ticket limits, magic-link redemptions)
 * must aggregate over this list rather than assume a single session.
 */
export async function listGuestSessionsByEmail(
  db: QueryCtx['db'],
  email: string,
): Promise<Doc<'guest_sessions'>[]> {
  return await db
    .query('guest_sessions')
    .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
    .take(EMAIL_SESSION_SCAN_LIMIT);
}

/**
 * Whether any of the email's sessions already redeemed this magic link.
 * Redemptions count against `maxRedemptions`, and one buyer re-entering their
 * email across devices must burn at most one redemption — nor may their own
 * earlier redemption lock them out of a maxed link.
 */
export async function hasEmailRedeemedMagicLink(
  db: QueryCtx['db'],
  magicLinkId: Id<'magic_links'>,
  email: string,
): Promise<boolean> {
  const sessions = await listGuestSessionsByEmail(db, email);
  for (const session of sessions) {
    const redemption = await db
      .query('magic_link_redemption_log')
      .withIndex('by_magicLink_guest', (q) =>
        q.eq('magicLinkId', magicLinkId).eq('guestSessionId', session._id),
      )
      .first();
    if (redemption) return true;
  }
  return false;
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

  if (
    args.magicLinkId &&
    !(await hasEmailRedeemedMagicLink(ctx.db, args.magicLinkId, args.email))
  ) {
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

  const alreadyRedeemed = await hasEmailRedeemedMagicLink(
    ctx.db,
    magicLinkId,
    session.email,
  );

  if (!alreadyRedeemed) {
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

/** Max guest sessions deleted per cleanup batch before rescheduling. */
export const CLEANUP_BATCH_SIZE = 200;

export async function cleanupExpiredGuestSessions(
  ctx: MutationCtx,
): Promise<number> {
  const now = Date.now();
  // Read only deletable rows directly from the [convertedToUserId, expiresAt]
  // index: unconverted sessions (convertedToUserId === undefined) whose hard
  // expiry has passed. Converted sessions are preserved for the audit trail and
  // never deleted, but their expiresAt still lapses — so filtering them in
  // memory after an ascending by_expiresAt scan would let them pile up at the
  // head of the range. Once >=BATCH_SIZE converted rows existed, take() would
  // return an all-converted batch that deletes nothing yet still reschedules,
  // an infinite zero-progress runAfter(0) loop. Indexing on convertedToUserId
  // skips those rows entirely, so every row read here is deletable.
  const expiredSessions = await ctx.db
    .query('guest_sessions')
    .withIndex('by_convertedToUserId_expiresAt', (q) =>
      q.eq('convertedToUserId', undefined).lt('expiresAt', now),
    )
    .take(CLEANUP_BATCH_SIZE);

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

  // Reschedule only when the batch was full, i.e. more deletable rows likely
  // remain. Each run deletes the rows it read, so the remaining deletable
  // population strictly shrinks and the self-scheduling chain terminates once a
  // run clears fewer than a full batch.
  if (cleaned === CLEANUP_BATCH_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
  }

  return cleaned;
}
