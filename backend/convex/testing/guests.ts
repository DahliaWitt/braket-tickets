import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {validateGuestFields} from '../lib/events/guest_fields';
import {
  getOrCreateGuestListEventStats,
  MAX_GUESTS_PER_EVENT_STATS,
  updateGuestListEventStats,
} from '../lib/guest_list/event_stats';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';
import {guestTypeValidator, type GuestType} from '../lib/validators/guests';
import {testingMutation} from './wrappers';

interface InsertSeedGuestArgs {
  eventId: Id<'events'>;
  name: string;
  email?: string;
  type: GuestType;
  notes?: string;
  checkedInAt?: number;
  checkedInBy?: Id<'users'>;
}

export async function insertSeedGuest(
  ctx: MutationCtx,
  args: InsertSeedGuestArgs,
): Promise<Id<'guests'>> {
  validateGuestFields(args);

  const stats = await getOrCreateGuestListEventStats(ctx, args.eventId);
  if (stats.totalGuestAdmissionCount >= MAX_GUESTS_PER_EVENT_STATS) {
    throw new Error(
      `Guest seed exceeds the supported per-event limit (${MAX_GUESTS_PER_EVENT_STATS} guests)`,
    );
  }

  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper with direct guest state control.
  const guestId = await ctx.db.insert('guests', {
    eventId: args.eventId,
    name: args.name,
    email: args.email,
    emailKey: args.email?.trim().toLowerCase(),
    type: args.type,
    notes: args.notes,
    checkedInAt: args.checkedInAt,
    checkedInBy: args.checkedInBy,
  });
  await updateGuestListEventStats(ctx, stats, (current) => ({
    totalGuestAdmissionCount: current.totalGuestAdmissionCount + 1,
  }));
  return guestId;
}

interface InsertSeedGuestSessionArgs {
  email: string;
  magicLinkId?: Id<'magic_links'>;
  sessionToken?: string;
  expiresAt?: number;
  lastActiveAt?: number;
}

export async function insertSeedGuestSession(
  ctx: MutationCtx,
  args: InsertSeedGuestSessionArgs,
): Promise<Id<'guest_sessions'>> {
  const sessionToken =
    args.sessionToken ?? crypto.randomUUID().replaceAll('-', '');
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper for guest checkout session fixtures.
  const sessionId = await ctx.db.insert('guest_sessions', {
    email: args.email.toLowerCase(),
    magicLinkId: args.magicLinkId,
    sessionTokenDigest: await digestBearerToken('guest_session', sessionToken),
    sessionTokenPrefix: tokenPrefix(sessionToken),
    expiresAt: args.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
    lastActiveAt: args.lastActiveAt,
  });
  return sessionId;
}

/**
 * Seeds a guest for an event, bypassing normal admin flow.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedGuest = testingMutation({
  args: {
    eventId: v.id('events'),
    name: v.string(),
    email: v.optional(v.string()),
    type: guestTypeValidator,
    notes: v.optional(v.string()),
  },
  returns: v.id('guests'),
  handler: async (ctx, args) => {
    return insertSeedGuest(ctx, args);
  },
});
