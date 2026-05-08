import {v} from 'convex/values';
import {guestSessionDocValidator} from '../lib/guest_sessions/validators';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';
import {testingMutation, testingQuery} from './wrappers';

export const seedGuestSession = testingMutation({
  args: {
    email: v.string(),
    clientKey: v.optional(v.string()),
    magicLinkId: v.optional(v.id('magic_links')),
    sessionToken: v.string(),
    expiresAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.number()),
    convertedToUserId: v.optional(v.id('users')),
  },
  returns: v.id('guest_sessions'),
  handler: async ({db}, args) => {
    const now = Date.now();
    const sessionTokenDigest = await digestBearerToken(
      'guest_session',
      args.sessionToken,
    );
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test bootstrap for guest sessions; public creation runs in Node actions and is not available in edge-runtime unit tests. */
    const sessionId = await db.insert('guest_sessions', {
      email: args.email.toLowerCase(),
      ...(args.clientKey !== undefined ? {clientKey: args.clientKey} : {}),
      ...(args.magicLinkId !== undefined
        ? {magicLinkId: args.magicLinkId}
        : {}),
      sessionTokenDigest,
      sessionTokenPrefix: tokenPrefix(args.sessionToken),
      expiresAt: args.expiresAt ?? now + 24 * 60 * 60 * 1000,
      ...(args.lastActiveAt !== undefined
        ? {lastActiveAt: args.lastActiveAt}
        : {}),
      ...(args.convertedToUserId !== undefined
        ? {convertedToUserId: args.convertedToUserId}
        : {}),
    });

    if (args.magicLinkId) {
      await db.insert('magic_link_redemption_log', {
        magicLinkId: args.magicLinkId,
        guestSessionId: sessionId,
        redeemedAt: now,
      });
    }

    return sessionId;
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  },
});

export const getGuestSessionByEmail = testingQuery({
  args: {email: v.string()},
  returns: v.union(guestSessionDocValidator, v.null()),
  handler: async ({db}, {email}) => {
    return await db
      .query('guest_sessions')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
      .order('desc')
      .first();
  },
});
