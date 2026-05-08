import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader} from '../../_generated/server';
import {batchGetDocuments, batchGetUsers} from '../../lib/batch_utils';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {
  buildRecipientSet,
  type RecipientCandidate,
} from '../../lib/audience/recipient_set';

/**
 * Broadcasts are operational emails (event info to all ticket holders) —
 * they are NOT marketing, and so do not consult `marketingEmailPreferences`,
 * `emailAddressMarketingPreferences`, or `user.globalMarketingOptOut` for
 * *filtering*. The audience is purely "anyone with a valid ticket or guest
 * row for this event," deduped by normalized email.
 *
 * `userGlobalOptOut` is surfaced on user-kind recipients only so the send
 * handler can mirror the user's platform-wide marketing stance into a newly
 * minted per-organizer preference row (see `ensureUserMarketingPreferenceForSend`).
 * It is informational — never used to drop the recipient.
 *
 * For marketing-announcement audiences, see
 * `lib/marketing_emails/audience.ts`.
 */

export interface BroadcastRecipient {
  email: string;
  userId?: Id<'users'>;
  /** Only set for user-kind recipients. Mirrors `user.globalMarketingOptOut`
   * so the send handler can seed fresh preference rows without another read. */
  userGlobalOptOut?: boolean;
}

export interface BroadcastAudience {
  recipientCount: number;
  isComplete: boolean;
  recipients?: BroadcastRecipient[];
}

interface BroadcastTicketLike {
  userId?: Id<'users'>;
  guestSessionId?: Id<'guest_sessions'>;
}

interface BroadcastGuestLike {
  email?: string;
}

type BroadcastUserInfo = Pick<Doc<'users'>, 'email' | 'globalMarketingOptOut'>;

/**
 * Adapts ticket+guest async iterables into a candidate stream for the shared
 * recipient-set builder. Stops early if `stopAfterRecipientCount` is set and
 * the dedup Map reaches that size — the bounded path uses this to probe
 * whether an event exceeds the send cap without scanning every ticket.
 *
 * `getUser` is invoked at most once per distinct userId because the generator
 * caches results. The cache also powers the post-dedup enrichment pass that
 * annotates each user-kind recipient with `userGlobalOptOut`, so callers never
 * need a second pass of `db.get('users', ...)`.
 */
export async function buildBroadcastAudienceFromSources(args: {
  tickets: AsyncIterable<BroadcastTicketLike>;
  guests: AsyncIterable<BroadcastGuestLike>;
  getUser: (userId: Id<'users'>) => Promise<BroadcastUserInfo | undefined>;
  getGuestSessionEmail?: (
    guestSessionId: Id<'guest_sessions'>,
  ) => Promise<string | undefined>;
  includeRecipients?: boolean;
  stopAfterRecipientCount?: number;
}): Promise<BroadcastAudience> {
  const includeRecipients = args.includeRecipients ?? true;
  const userCache = new Map<Id<'users'>, BroadcastUserInfo | undefined>();

  const loadUser = async (
    userId: Id<'users'>,
  ): Promise<BroadcastUserInfo | undefined> => {
    if (userCache.has(userId)) return userCache.get(userId);
    const user = await args.getUser(userId);
    userCache.set(userId, user);
    return user;
  };

  const candidates = (async function* (): AsyncIterable<RecipientCandidate> {
    for await (const ticket of args.tickets) {
      if (ticket.userId) {
        const user = await loadUser(ticket.userId);
        yield {
          kind: 'user',
          userId: ticket.userId,
          email: user?.email,
        };
      } else if (ticket.guestSessionId && args.getGuestSessionEmail) {
        yield {
          kind: 'address',
          email: await args.getGuestSessionEmail(ticket.guestSessionId),
        };
      }
    }
    for await (const guest of args.guests) {
      yield {kind: 'address', email: guest.email};
    }
  })();

  const {recipients, isComplete} = await buildRecipientSet({
    candidates,
    // Operational policy: every surfaced candidate is included once
    // normalization/dedup succeeds.
    decide: async () => true,
    stopAfterRecipientCount: args.stopAfterRecipientCount,
  });

  const enrichedRecipients: BroadcastRecipient[] = recipients.map((r) => {
    if (!r.userId) return r;
    const user = userCache.get(r.userId);
    return {
      ...r,
      userGlobalOptOut: user?.globalMarketingOptOut === true,
    };
  });

  return {
    recipientCount: enrichedRecipients.length,
    isComplete,
    ...(includeRecipients ? {recipients: enrichedRecipients} : {}),
  };
}

export async function loadExactBroadcastAudience(
  db: DatabaseReader,
  eventId: Id<'events'>,
  options?: {includeRecipients?: boolean},
): Promise<BroadcastAudience> {
  // Exact audiences need every valid ticket so the recipient builder can
  // dedupe against guest rows and apply the operational send cap correctly.
  // Pre-fetch users and guest sessions in bulk via the same indexed reads,
  // then stream them through the shared builder to keep the dedup / stop-after
  // semantics consistent with the bounded loader.
  const validTickets = await collectAllQueryUnsafe(
    db.query('tickets').withIndex('by_event_status', (q) =>
      q.eq('eventId', eventId).eq('status', 'valid'),
    ),
  );
  const userIds = [
    ...new Set(
      validTickets
        .map((ticket) => ticket.userId)
        .filter((userId): userId is Id<'users'> => userId !== undefined),
    ),
  ];
  const guestSessionIds = [
    ...new Set(
      validTickets
        .map((ticket) => ticket.guestSessionId)
        .filter(
          (guestSessionId): guestSessionId is Id<'guest_sessions'> =>
            guestSessionId !== undefined,
        ),
    ),
  ];
  const [usersMap, guestSessionsMap] = await Promise.all([
    batchGetUsers({db}, userIds),
    batchGetDocuments({db}, 'guest_sessions', guestSessionIds),
  ]);

  async function* ticketsIterable(): AsyncIterable<BroadcastTicketLike> {
    for (const ticket of validTickets) yield ticket;
  }
  async function* guestsIterable(): AsyncIterable<BroadcastGuestLike> {
    const guests = db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId));
    for await (const guest of guests) yield guest;
  }

  return buildBroadcastAudienceFromSources({
    tickets: ticketsIterable(),
    guests: guestsIterable(),
    getUser: async (userId) => usersMap.get(userId),
    getGuestSessionEmail: async (guestSessionId) =>
      guestSessionsMap.get(guestSessionId)?.email,
    includeRecipients: options?.includeRecipients ?? true,
  });
}

export async function loadBroadcastAudienceUpToLimit(
  db: DatabaseReader,
  eventId: Id<'events'>,
  stopAfterRecipientCount: number,
): Promise<BroadcastAudience> {
  return buildBroadcastAudienceFromSources({
    tickets: db.query('tickets').withIndex('by_event_status', (q) =>
      q.eq('eventId', eventId).eq('status', 'valid'),
    ),
    guests: db.query('guests').withIndex('by_event', (q) =>
      q.eq('eventId', eventId),
    ),
    getUser: async (userId) => (await db.get('users', userId)) ?? undefined,
    getGuestSessionEmail: async (guestSessionId) =>
      (await db.get('guest_sessions', guestSessionId))?.email,
    includeRecipients: true,
    stopAfterRecipientCount,
  });
}
