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
  /**
   * Reachability split for imported (external) ticket holders, so the compose
   * flow can render "includes N external ticket holders". Counts every imported
   * entry for the event regardless of the include toggle: `reachable` are those
   * WITH an email (join the audience when included), `unreachable` are those
   * without. Independent of the dedup Map — an imported email that collides with
   * a native purchaser still counts as reachable here even though it yields no
   * additional send.
   */
  importedReachableCount: number;
  importedUnreachableCount: number;
}

interface BroadcastTicketLike {
  userId?: Id<'users'>;
  guestSessionId?: Id<'guest_sessions'>;
}

interface BroadcastGuestLike {
  email?: string;
}

interface BroadcastImportedLike {
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
  imported?: AsyncIterable<BroadcastImportedLike>;
  getUser: (userId: Id<'users'>) => Promise<BroadcastUserInfo | undefined>;
  getGuestSessionEmail?: (
    guestSessionId: Id<'guest_sessions'>,
  ) => Promise<string | undefined>;
  /**
   * Whether imported entries WITH an email join the audience (default true).
   * When false, imported entries are excluded from the send entirely; the
   * reachable/unreachable split is still reported for the compose UI.
   */
  includeExternalTicketHolders?: boolean;
  includeRecipients?: boolean;
  stopAfterRecipientCount?: number;
}): Promise<BroadcastAudience> {
  const includeRecipients = args.includeRecipients ?? true;
  const includeExternal = args.includeExternalTicketHolders ?? true;
  const userCache = new Map<Id<'users'>, BroadcastUserInfo | undefined>();

  const loadUser = async (
    userId: Id<'users'>,
  ): Promise<BroadcastUserInfo | undefined> => {
    if (userCache.has(userId)) return userCache.get(userId);
    const user = await args.getUser(userId);
    userCache.set(userId, user);
    return user;
  };

  // Count the imported reachability split before dedup so the compose flow can
  // always show "includes N external ticket holders". This iterates the imported
  // source once regardless of the toggle; when the toggle is on, reachable
  // (with-email) entries are ALSO fed into the candidate stream and deduped by
  // normalized email across native purchasers, guests, and imported entries.
  let importedReachableCount = 0;
  let importedUnreachableCount = 0;
  const importedEmails: (string | undefined)[] = [];
  if (args.imported) {
    for await (const entry of args.imported) {
      const email = entry.email?.trim();
      if (email && email.length > 0) {
        importedReachableCount += 1;
        if (includeExternal) importedEmails.push(email);
      } else {
        importedUnreachableCount += 1;
      }
    }
  }

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
    // Imported entries are inert address-kind recipients — never linked to a
    // user account (no account linkage by email, per spec). The shared builder
    // dedups them by normalized email against native purchasers and guests.
    for (const email of importedEmails) {
      yield {kind: 'address', email};
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
    importedReachableCount,
    importedUnreachableCount,
    ...(includeRecipients ? {recipients: enrichedRecipients} : {}),
  };
}

export async function loadExactBroadcastAudience(
  db: DatabaseReader,
  eventId: Id<'events'>,
  options?: {
    includeRecipients?: boolean;
    includeExternalTicketHolders?: boolean;
  },
): Promise<BroadcastAudience> {
  // Exact audiences need every valid ticket so the recipient builder can
  // dedupe against guest rows and apply the operational send cap correctly.
  // Pre-fetch users and guest sessions in bulk via the same indexed reads,
  // then stream them through the shared builder to keep the dedup / stop-after
  // semantics consistent with the bounded loader.
  const validTickets = await collectAllQueryUnsafe(
    db
      .query('tickets')
      .withIndex('by_event_status', (q) =>
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
  async function* importedIterable(): AsyncIterable<BroadcastImportedLike> {
    const imported = db
      .query('importedTicketHolders')
      .withIndex('by_event', (q) => q.eq('eventId', eventId));
    for await (const entry of imported) yield {email: entry.email};
  }

  return buildBroadcastAudienceFromSources({
    tickets: ticketsIterable(),
    guests: guestsIterable(),
    imported: importedIterable(),
    getUser: async (userId) => usersMap.get(userId),
    getGuestSessionEmail: async (guestSessionId) =>
      guestSessionsMap.get(guestSessionId)?.email,
    includeExternalTicketHolders: options?.includeExternalTicketHolders ?? true,
    includeRecipients: options?.includeRecipients ?? true,
  });
}

export async function loadBroadcastAudienceUpToLimit(
  db: DatabaseReader,
  eventId: Id<'events'>,
  stopAfterRecipientCount: number,
  options?: {includeExternalTicketHolders?: boolean},
): Promise<BroadcastAudience> {
  async function* importedIterable(): AsyncIterable<BroadcastImportedLike> {
    const imported = db
      .query('importedTicketHolders')
      .withIndex('by_event', (q) => q.eq('eventId', eventId));
    for await (const entry of imported) yield {email: entry.email};
  }

  return buildBroadcastAudienceFromSources({
    tickets: db
      .query('tickets')
      .withIndex('by_event_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'valid'),
      ),
    guests: db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId)),
    imported: importedIterable(),
    getUser: async (userId) => (await db.get('users', userId)) ?? undefined,
    getGuestSessionEmail: async (guestSessionId) =>
      (await db.get('guest_sessions', guestSessionId))?.email,
    includeExternalTicketHolders: options?.includeExternalTicketHolders ?? true,
    includeRecipients: true,
    stopAfterRecipientCount,
  });
}
