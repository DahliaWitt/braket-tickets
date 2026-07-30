import type {Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {ActionCtx, MutationCtx, QueryCtx} from '../../_generated/server';
import {collectAllQueryUnsafe, collectMatchingInQuery} from '../../lib/query_scan';
import {
  loadAllTicketOrdersByGuestSession,
  loadAllTicketsByGuestSession,
  magicLinkRedemptionsByGuestSessionQuery,
} from '../../lib/indexed_loaders';
import {carryOverAddressMarketingPreferenceToUser} from '../marketing_emails/preferences';

type SessionMigrationArgs = {
  sessionId: Id<'guest_sessions'>;
  userId: Id<'users'>;
};

export async function getUnmigratedGuestSessionsByEmail(
  ctx: QueryCtx,
  email: string,
) {
  return await collectMatchingInQuery(
    ctx.db
      .query('guest_sessions')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase())),
    (session) => !session.convertedToUserId,
  );
}

export async function migrateOneGuestSessionToUser(
  ctx: MutationCtx,
  args: SessionMigrationArgs,
): Promise<void> {
  const session = await ctx.db.get('guest_sessions', args.sessionId);
  if (!session || session.convertedToUserId) return;

  // One session typically has a small ticket set; we migrate all rows for correctness.
  const guestTickets = await loadAllTicketsByGuestSession(ctx.db, session._id);
  await Promise.all(
    guestTickets.map((ticket) =>
      ctx.db.patch('tickets', ticket._id, {
        userId: args.userId,
        guestSessionId: undefined,
      }),
    ),
  );

  // ticket_orders mirror the same guest → user ownership transfer.
  const guestOrders = await loadAllTicketOrdersByGuestSession(ctx.db, session._id);
  await Promise.all(
    guestOrders.map((order) =>
      ctx.db.patch('ticket_orders', order._id, {
        userId: args.userId,
        guestSessionId: undefined,
      }),
    ),
  );

  const unmigratedRedemptions = await collectMatchingInQuery(
    magicLinkRedemptionsByGuestSessionQuery(ctx.db, session._id),
    (redemption) => !redemption.userId,
  );
  await Promise.all(
    unmigratedRedemptions.map((redemption) =>
      ctx.db.patch('magic_link_redemption_log', redemption._id, {userId: args.userId}),
    ),
  );

  // Carry over address-level marketing signals without ever re-subscribing a
  // user. An address row defaults to optedIn:true on first send, so a blind
  // upsert would silently flip a user's explicit opt-out back on. The helper
  // only creates a new preference or propagates an unsubscribe (CAN-SPAM).
  const addressPreferences = await collectAllQueryUnsafe(
    ctx.db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_email', (q) => q.eq('email', session.email)),
  );
  await Promise.all(
    addressPreferences.map((preference) =>
      carryOverAddressMarketingPreferenceToUser(ctx.db, {
        userId: args.userId,
        organizerId: preference.organizerId,
        addressOptedIn: preference.optedIn,
      }),
    ),
  );

  await ctx.db.patch('guest_sessions', args.sessionId, {convertedToUserId: args.userId});
}

export async function migrateGuestSessionsForUser(
  ctx: ActionCtx,
  args: {email: string; userId: Id<'users'>},
): Promise<void> {
  const sessions = await ctx.runQuery(internal.guest_sessions.core.getUnmigratedByEmail, {
    email: args.email,
  });

  for (const session of sessions) {
    await ctx.runMutation(internal.guest_sessions.core.migrateOneSession, {
      sessionId: session._id,
      userId: args.userId,
    });
  }
}
