import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {
  magicLinkRedemptionsByGuestSessionQuery,
  ticketOrdersByGuestSessionQuery,
  ticketsByGuestSessionQuery,
} from '../indexed_loaders';
import {collectAllQueryUnsafe, findMatchingInQuery} from '../query_scan';
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
    'expiresAt' | 'lastActiveAt' | 'convertedToUserId' | 'retiredAt'
  >,
  now: number,
): boolean {
  if (session.convertedToUserId) return false;
  if (session.retiredAt !== undefined) return false;
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

export async function loadUnretiredGuestSessionsByEmail(
  ctx: SessionLookupCtx,
  email: string,
): Promise<Array<Doc<'guest_sessions'>>> {
  // Bounded per email: `initiate` retires all prior unretired rows before
  // inserting a new one, so an email has at most one unretired row in steady
  // state (or a handful from legacy/concurrent edge cases).
  return await collectAllQueryUnsafe(
    ctx.db
      .query('guest_sessions')
      .withIndex('by_email_convertedToUserId_retiredAt', (q) =>
        q
          .eq('email', email.toLowerCase())
          .eq('convertedToUserId', undefined)
          .eq('retiredAt', undefined),
      )
      .order('desc'),
  );
}

export async function findActiveGuestSessionByEmail(
  ctx: SessionLookupCtx,
  email: string,
  now: number,
): Promise<Doc<'guest_sessions'> | null> {
  return await findMatchingInQuery(
    ctx.db
      .query('guest_sessions')
      .withIndex('by_email_convertedToUserId_retiredAt', (q) =>
        q
          .eq('email', email.toLowerCase())
          .eq('convertedToUserId', undefined)
          .eq('retiredAt', undefined),
      )
      .order('desc'),
    (session) => isGuestSessionActive(session, now),
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
  sessionToken?: string,
): Promise<boolean> {
  const now = Date.now();
  const session =
    sessionToken !== undefined
      ? await getActiveGuestSession(ctx, sessionToken, now)
      : await ctx.db.get('guest_sessions', sessionId);
  if (
    !session ||
    session._id !== sessionId ||
    !isGuestSessionActive(session, now)
  ) {
    return false;
  }

  if (
    !session.lastActiveAt ||
    now - session.lastActiveAt > LAST_ACTIVE_THROTTLE_MS
  ) {
    await ctx.db.patch('guest_sessions', sessionId, {lastActiveAt: now});
  }
  return true;
}

export async function attachMagicLinkTrustToGuestSession(
  ctx: MutationCtx,
  sessionId: Id<'guest_sessions'>,
  magicLinkId: Id<'magic_links'>,
): Promise<void> {
  const now = Date.now();
  const session = await ctx.db.get('guest_sessions', sessionId);
  if (!session || !isGuestSessionActive(session, now)) {
    return;
  }

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
      redeemedAt: now,
    });
  }
}

async function hasGuestSessionReferences(
  ctx: Pick<MutationCtx, 'db'>,
  sessionId: Id<'guest_sessions'>,
): Promise<boolean> {
  const [ticket, order, redemption] = await Promise.all([
    ticketsByGuestSessionQuery(ctx.db, sessionId).first(),
    ticketOrdersByGuestSessionQuery(ctx.db, sessionId).first(),
    magicLinkRedemptionsByGuestSessionQuery(ctx.db, sessionId).first(),
  ]);
  return ticket !== null || order !== null || redemption !== null;
}

export type RetireGuestSessionResult = 'deleted' | 'retained' | 'noop';

/**
 * Retire an expired or replaced guest session.
 *
 * - If tickets, orders, or magic-link redemption rows still reference the
 *   session, keep the document for ownership/contact lookups and future
 *   account migration while permanently revoking all bearer credentials.
 * - Otherwise delete the unreferenced session row.
 */
export async function retireGuestSessionDoc(
  ctx: MutationCtx,
  session: Doc<'guest_sessions'>,
  now = Date.now(),
): Promise<RetireGuestSessionResult> {
  if (session.convertedToUserId || session.retiredAt !== undefined) {
    return 'noop';
  }

  if (await hasGuestSessionReferences(ctx, session._id)) {
    await ctx.db.patch('guest_sessions', session._id, {
      retiredAt: now,
      sessionToken: undefined,
      sessionTokenDigest: undefined,
      sessionTokenPrefix: undefined,
      pendingSessionTokenDigest: undefined,
      pendingSessionTokenPrefix: undefined,
    });
    return 'retained';
  }

  await ctx.db.delete('guest_sessions', session._id);
  return 'deleted';
}

/** Max guest sessions retired per cleanup batch before rescheduling. */
export const CLEANUP_BATCH_SIZE = 200;

export async function cleanupExpiredGuestSessions(
  ctx: MutationCtx,
): Promise<number> {
  const now = Date.now();
  // Read only unretired, unconverted rows directly from
  // [convertedToUserId, retiredAt, expiresAt]. Converted sessions (audit
  // trail) and retired sessions (retained for tickets, orders, or redemption
  // history) have non-undefined convertedToUserId or retiredAt, so the index
  // skips them and cleanup never re-scans retained rows or stalls behind them.
  const expiredSessions = await ctx.db
    .query('guest_sessions')
    .withIndex('by_convertedToUserId_retiredAt_expiresAt', (q) =>
      q
        .eq('convertedToUserId', undefined)
        .eq('retiredAt', undefined)
        .lt('expiresAt', now),
    )
    .take(CLEANUP_BATCH_SIZE);

  const outcomes = await Promise.all(
    expiredSessions.map((session) => retireGuestSessionDoc(ctx, session, now)),
  );

  const deleted = outcomes.filter((outcome) => outcome === 'deleted').length;
  const retained = outcomes.filter((outcome) => outcome === 'retained').length;
  const cleaned = deleted + retained;
  if (cleaned > 0) {
    logger.info('guest_sessions', '[CRON] Retired expired guest sessions', {
      cleaned,
      deleted,
      retained,
    });
  }

  // Reschedule only when the batch was full, i.e. more unretired expired rows
  // likely remain. Every row processed here is either deleted or stamped with
  // retiredAt (leaving the index range), so the remaining population strictly
  // shrinks and the self-scheduling chain terminates.
  if (expiredSessions.length === CLEANUP_BATCH_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      internal.guest_sessions.core.cleanupExpiredSessions,
      {},
    );
  }

  return cleaned;
}
