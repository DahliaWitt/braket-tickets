import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {
  MAX_GUEST_EMAIL_LENGTH,
  MAX_GUEST_NAME_LENGTH,
  MAX_GUEST_NOTES_LENGTH,
  validateStringLength,
} from '../lib/validation';
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
  validateStringLength(args.name, 'Name', MAX_GUEST_NAME_LENGTH);
  validateStringLength(args.email, 'Email', MAX_GUEST_EMAIL_LENGTH);
  validateStringLength(args.notes, 'Notes', MAX_GUEST_NOTES_LENGTH);

  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper with direct guest state control.
  const guestId = await ctx.db.insert('guests', {
    eventId: args.eventId,
    name: args.name,
    email: args.email,
    type: args.type,
    notes: args.notes,
    checkedInAt: args.checkedInAt,
    checkedInBy: args.checkedInBy,
  });
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
