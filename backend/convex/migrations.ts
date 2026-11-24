import {Migrations} from '@convex-dev/migrations';
import {createFunctionHandle, getFunctionName} from 'convex/server';
import {ConvexError, v} from 'convex/values';
import {components, internal} from './_generated/api';
import type {DataModel} from './_generated/dataModel';
import {internalMutation, type MutationCtx} from './_generated/server';
import {isRecord} from '@shared/type-guards';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';
import {normalizeEmailOrNull} from './lib/validation';
import {logger} from './lib/logger';
import {UNNORMALIZABLE_RECIPIENT_KEY} from './lib/validators/email_delivery';
import {buildTicketRosterProjection} from './lib/ticket_roster_projection';
import {
  describeGuestListEventOverage,
  loadGuestListEventCounterOutcome,
  replaceGuestListEventStats,
} from './lib/guest_list/event_stats';

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * The event-stats step reads one event's full bounded roster (up to 5,000
 * guests plus 500 active assignments), so it must stay at one document per
 * transaction. This bound belongs to that migration alone — see
 * {@link runGuestListBackfills} for why it is no longer passed to the series.
 */
const GUEST_LIST_EVENT_STATS_BATCH_SIZE = 1;

/**
 * Row-oriented guest-list steps touch one document (plus at most one indexed
 * lookup) each, so they use the component's ordinary batch size.
 */
const GUEST_LIST_ROW_BATCH_SIZE = 100;

export const backfillMagicLinkTokenDigests = migrations.define({
  table: 'magic_links',
  migrateOne: async (_ctx, link) => {
    if (!link.token) return {};
    return {
      tokenDigest:
        link.tokenDigest ?? (await digestBearerToken('magic_link', link.token)),
      tokenPrefix: link.tokenPrefix ?? tokenPrefix(link.token),
      token: undefined,
    };
  },
});

export const backfillAdminInviteTokenDigests = migrations.define({
  table: 'admin_invites',
  migrateOne: async (_ctx, invite) => {
    if (!invite.token) return {};
    return {
      tokenDigest:
        invite.tokenDigest ??
        (await digestBearerToken('admin_invite', invite.token)),
      tokenPrefix: invite.tokenPrefix ?? tokenPrefix(invite.token),
      token: undefined,
    };
  },
});

export const backfillGuestSessionTokenDigests = migrations.define({
  table: 'guest_sessions',
  migrateOne: async (_ctx, session) => {
    if (!session.sessionToken) return {};
    return {
      sessionTokenDigest:
        session.sessionTokenDigest ??
        (await digestBearerToken('guest_session', session.sessionToken)),
      sessionTokenPrefix:
        session.sessionTokenPrefix ?? tokenPrefix(session.sessionToken),
      sessionToken: undefined,
    };
  },
});

export const backfillUserMarketingUnsubscribeTokenDigests = migrations.define({
  table: 'marketingEmailPreferences',
  migrateOne: async (_ctx, preference) => {
    if (!preference.unsubToken) return {};
    return {
      unsubTokenDigest:
        preference.unsubTokenDigest ??
        (await digestBearerToken(
          'marketing_unsubscribe_user',
          preference.unsubToken,
        )),
      unsubTokenPrefix:
        preference.unsubTokenPrefix ?? tokenPrefix(preference.unsubToken),
      unsubToken: undefined,
    };
  },
});

export const backfillAddressMarketingUnsubscribeTokenDigests =
  migrations.define({
    table: 'emailAddressMarketingPreferences',
    migrateOne: async (_ctx, preference) => {
      if (!preference.unsubToken) return {};
      return {
        unsubTokenDigest:
          preference.unsubTokenDigest ??
          (await digestBearerToken(
            'marketing_unsubscribe_address',
            preference.unsubToken,
          )),
        unsubTokenPrefix:
          preference.unsubTokenPrefix ?? tokenPrefix(preference.unsubToken),
        unsubToken: undefined,
      };
    },
  });

export const backfillMarketingDeliveryTrackingTokenDigests = migrations.define({
  table: 'marketingEmailDeliveries',
  migrateOne: async (_ctx, delivery) => {
    return {
      ...(delivery.openToken
        ? {
            openTokenDigest:
              delivery.openTokenDigest ??
              (await digestBearerToken(
                'marketing_tracking_open',
                delivery.openToken,
              )),
            openTokenPrefix:
              delivery.openTokenPrefix ?? tokenPrefix(delivery.openToken),
            openToken: undefined,
          }
        : {}),
      ...(delivery.clickToken
        ? {
            clickTokenDigest:
              delivery.clickTokenDigest ??
              (await digestBearerToken(
                'marketing_tracking_click',
                delivery.clickToken,
              )),
            clickTokenPrefix:
              delivery.clickTokenPrefix ?? tokenPrefix(delivery.clickToken),
            clickToken: undefined,
          }
        : {}),
    };
  },
});

export const clearLegacyUserEmailChangeTokens = migrations.define({
  table: 'users',
  migrateOne: (_ctx, user) => {
    if (!user.emailChangeToken && !user.emailChangeTokenExpiry) return {};
    return {
      emailChangeToken: undefined,
      emailChangeTokenExpiry: undefined,
    };
  },
});

/**
 * The component only skips the write when `migrateOne` returns an object with
 * no keys (`Object.keys(next).length > 0` in
 * `@convex-dev/migrations/src/client/index.ts`). Returning
 * `{emailKey: undefined}` therefore patches every row, including rows with no
 * email and rows already carrying the right key — turning the backfill into a
 * full rewrite of the `guests` table. Compare only, and return `{}` when the
 * stored value already matches.
 */
export function guestEmailKeyPatch(guest: {
  email?: string;
  emailKey?: string;
}): {emailKey?: string} {
  const emailKey = normalizeEmailOrNull(guest.email) ?? undefined;
  if (guest.emailKey === emailKey) return {};
  return {emailKey};
}

export const backfillGuestEmailKeys = migrations.define({
  table: 'guests',
  batchSize: GUEST_LIST_ROW_BATCH_SIZE,
  migrateOne: (_ctx, guest) => guestEmailKeyPatch(guest),
});

/**
 * Populates the roster projection on tickets issued before
 * `lib/ticket_roster_projection.ts` shipped.
 *
 * `hasValidTicketForAssignment` resolves "this delegate already has a ticket"
 * partly through the `by_event_and_rosterEmailLower_and_status` index. That
 * index is only fed by the projection, which is written on ticket create and
 * update — never backfilled. Account-linked legacy tickets are now covered by
 * a user-id fallback, but guest-checkout tickets (a `guestSessionId` and no
 * `userId`) matched no dedup rule at all, so the delegate received a duplicate
 * admission and a duplicate ticket email.
 *
 * Values are derived exactly as `lib/orders/complete.ts` derives them at
 * issue time (attendee user first, then guest session) and built with the
 * shared {@link buildTicketRosterProjection} so normalization stays in one
 * place. An existing `rosterAttendeeName` is preserved rather than recomputed.
 */
export const backfillTicketRosterEmailLower = migrations.define({
  table: 'tickets',
  batchSize: GUEST_LIST_ROW_BATCH_SIZE,
  migrateOne: async (ctx, ticket) => {
    const [attendeeUser, guestSession] = await Promise.all([
      ticket.userId
        ? ctx.db.get('users', ticket.userId)
        : Promise.resolve(null),
      ticket.guestSessionId
        ? ctx.db.get('guest_sessions', ticket.guestSessionId)
        : Promise.resolve(null),
    ]);
    const email = attendeeUser?.email ?? guestSession?.email ?? null;
    const projection = buildTicketRosterProjection({
      ticketId: ticket._id,
      status: ticket.status,
      attendeeName: ticket.rosterAttendeeName ?? attendeeUser?.name ?? email,
      email,
      checkedInByName: ticket.rosterCheckedInByName ?? null,
    });
    // The component patches whenever the returned object has any key, so an
    // unconditional return would rewrite every ticket row in the deployment.
    if (
      ticket.rosterEmail === projection.rosterEmail &&
      ticket.rosterEmailLower === projection.rosterEmailLower
    ) {
      return {};
    }
    return projection;
  },
});

/**
 * Guest-list backfill module tag used by the operator-facing log lines.
 */
const GUEST_LIST_MIGRATION_MODULE = 'guest_list_migrations';

export const backfillGuestListEventStats = migrations.define({
  table: 'events',
  // A dense event can read up to 5,000 guests and 500 assignments. Keep each
  // event in its own transaction so two dense events never share limits.
  batchSize: GUEST_LIST_EVENT_STATS_BATCH_SIZE,
  migrateOne: async (ctx, event) => {
    const existing = await ctx.db
      .query('guestListEventStats')
      .withIndex('by_eventId', (q) => q.eq('eventId', event._id))
      .unique();
    if (existing) return {};
    const outcome = await loadGuestListEventCounterOutcome(ctx, event._id);
    if (outcome.kind === 'oversized') {
      // Do NOT throw. The migrations component records the error on the state
      // row and stops the series, so one legacy event over the cap would block
      // every later step (and therefore enablement) for the whole deployment.
      // Skip it loudly instead: no stats row is written, so verification keeps
      // the feature fail-closed until an operator resolves or explicitly
      // acknowledges the event.
      logger.error(
        GUEST_LIST_MIGRATION_MODULE,
        'Guest-list event stats backfill skipped an oversized event; ' +
          `${describeGuestListEventOverage(outcome.overage)}. ` +
          'Run guest_list/maintenance:listEventsMissingGuestListStats to enumerate the blocked events.',
        outcome.overage,
      );
      return {};
    }
    await replaceGuestListEventStats(ctx, outcome.counters);
    return {};
  },
});

export const backfillGuestListAssignmentEventDates = migrations.define({
  table: 'guestListAssignments',
  batchSize: GUEST_LIST_ROW_BATCH_SIZE,
  migrateOne: async (ctx, assignment) => {
    if (assignment.eventDate !== undefined) return {};
    const event = await ctx.db.get('events', assignment.eventId);
    return event ? {eventDate: event.date} : {};
  },
});

/**
 * Every legacy row gets a key, including rows whose recipient cannot be
 * normalized: those receive {@link UNNORMALIZABLE_RECIPIENT_KEY}. Leaving them
 * unkeyed would keep them in `hasDelivery`'s bounded legacy scan permanently,
 * so the fallback could never drain even after the migration reports done.
 */
export function emailDeliveryRecipientKeyPatch(delivery: {
  recipient: string;
  recipientKey?: string;
}): {recipientKey?: string} {
  if (delivery.recipientKey !== undefined) return {};
  return {
    recipientKey:
      normalizeEmailOrNull(delivery.recipient) ?? UNNORMALIZABLE_RECIPIENT_KEY,
  };
}

/**
 * Adds normalized lookup keys while preserving the provider-facing recipient
 * exactly as sent. The field remains optional until this migration has run on
 * every deployment so the schema is safe to deploy over historical rows.
 */
export const backfillEmailDeliveryRecipientKeys = migrations.define({
  table: 'emailDeliveries',
  migrateOne: async (_ctx, delivery) =>
    emailDeliveryRecipientKeyPatch(delivery),
});

/**
 * Ordered cheapest-first: the two row-oriented lookup-key backfills that the
 * admission dedup rules depend on, then the per-event stats step (one event
 * per transaction), then the assignment date projection.
 */
const guestListBackfills = [
  internal.migrations.backfillGuestEmailKeys,
  internal.migrations.backfillTicketRosterEmailLower,
  internal.migrations.backfillGuestListEventStats,
  internal.migrations.backfillGuestListAssignmentEventDates,
] as const;

export type MigrationDryRunOutcome = 'succeeded' | 'failed' | 'unrecognized';

/**
 * A successful dry run reaches the caller as a thrown `ConvexError`: the
 * component rolls the transaction back on purpose. Its payload
 * (`{kind: 'DRY RUN', status}`) is an internal shape of
 * `@convex-dev/migrations`, so this classifier is deliberately conservative —
 * anything it cannot positively recognize is `'unrecognized'` and the original
 * error is rethrown rather than swallowed.
 *
 * Success is decided by the ABSENCE of a failure signal, not by an allowlist of
 * `state` values. `getMigrationState` (component/lib.ts) reports `'unknown'`
 * whenever a dry run stops part-way through a table — the common case for any
 * table larger than one batch — while a genuine failure always sets
 * `status.error` and reports `'failed'`. An allowlist of
 * `success | inProgress` therefore rejects most healthy dry runs.
 *
 * `migrations.test.ts` asserts this against a live thrown payload so a library
 * upgrade that changes the shape fails loudly instead of silently turning every
 * dry run into a hard error.
 */
export function classifyMigrationDryRun(
  error: unknown,
): MigrationDryRunOutcome {
  if (!(error instanceof ConvexError)) return 'unrecognized';
  const data: unknown = error.data;
  if (!isRecord(data) || data['kind'] !== 'DRY RUN') return 'unrecognized';
  const status: unknown = data['status'];
  if (!isRecord(status)) return 'unrecognized';
  if (status['error'] !== undefined) return 'failed';
  const state: unknown = status['state'];
  if (typeof state !== 'string') return 'unrecognized';
  if (state === 'failed' || state === 'canceled') return 'failed';
  return 'succeeded';
}

type ScheduledMigration = {name: string; fnHandle: string};
type MigrationRef = typeof internal.migrations.backfillGuestEmailKeys;

async function resolveMigration(
  migration: MigrationRef,
): Promise<ScheduledMigration> {
  return {
    name: getFunctionName(migration),
    fnHandle: await createFunctionHandle(migration),
  };
}

/**
 * Starts a migration series through the component, translating a successful
 * dry run's deliberate rollback back into a normal return.
 *
 * `batchSize` is intentionally never forwarded: the component copies whatever
 * it receives into every scheduled `next` migration, so a single value here
 * would override each step's own `define({batchSize})` default.
 */
async function startMigrationSeries(
  ctx: MutationCtx,
  first: ScheduledMigration,
  next: ScheduledMigration[],
  args: {
    cursor?: string | null;
    dryRun?: boolean;
    reset?: boolean;
    oneBatchOnly?: boolean;
  },
): Promise<void> {
  try {
    await ctx.runMutation(components.migrations.lib.migrate, {
      name: first.name,
      fnHandle: first.fnHandle,
      cursor: args.reset ? null : args.cursor,
      next,
      dryRun: args.dryRun ?? false,
      reset: args.reset,
      oneBatchOnly: args.oneBatchOnly,
    });
  } catch (error) {
    if (!args.dryRun) throw error;
    if (classifyMigrationDryRun(error) !== 'succeeded') throw error;
  }
}

/**
 * Runs the guest-list migration series, letting each step use its own batch
 * size.
 *
 * The component propagates the `batchSize` given to `lib.migrate` into every
 * scheduled `next` migration (`component/lib.ts`), so passing the event-stats
 * step's one-document bound here applied it to the whole series: the `guests`
 * table would advance one document per transaction, serializing an entire
 * table into a chain of single-row transactions and stalling enablement for
 * hours. Omitting `batchSize` makes the component fall back to each
 * migration's own `define({batchSize})` default, which keeps the event-stats
 * step at one event per transaction without penalizing the row-oriented steps.
 *
 * An operator-supplied `batchSize` is still ignored, so it cannot raise the
 * event-stats bound.
 */
export const runGuestListBackfills = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    reset: v.optional(v.boolean()),
    oneBatchOnly: v.optional(v.boolean()),
    // Accepted for backwards-compatible CLI invocations, but deliberately
    // ignored so callers cannot raise any step's safe batch size.
    batchSize: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [first, ...rest] = guestListBackfills;
    await startMigrationSeries(
      ctx,
      await resolveMigration(first),
      await Promise.all(rest.map(resolveMigration)),
      args,
    );
    return null;
  },
});

/**
 * Seeds `eventBroadcastDeliveries` from historical `emailDeliveries` rows so
 * pre-feature broadcasts are not re-sent to existing holders by the catch-up
 * path. `emailDeliveries` is pruned after 30 days (see
 * `email/email_delivery.ts` cleanupOldDeliveries), so only broadcasts sent
 * within that window are covered — run promptly after deploy. Inserts into a
 * sibling table; never patches the `emailDeliveries` row itself.
 */
export const backfillEventBroadcastDeliveries = migrations.define({
  table: 'emailDeliveries',
  migrateOne: async (ctx, delivery) => {
    if (delivery.source !== 'broadcast') return {};

    const broadcastId = ctx.db.normalizeId(
      'eventBroadcasts',
      delivery.sourceId,
    );
    if (!broadcastId) return {};
    const broadcast = await ctx.db.get('eventBroadcasts', broadcastId);
    if (!broadcast) return {};

    const email = normalizeEmailOrNull(delivery.recipient);
    if (!email) return {};

    const existing = await ctx.db
      .query('eventBroadcastDeliveries')
      .withIndex('by_broadcast_and_email', (q) =>
        q.eq('broadcastId', broadcastId).eq('email', email),
      )
      .first();
    if (existing) return {};

    await ctx.db.insert('eventBroadcastDeliveries', {
      broadcastId,
      eventId: broadcast.eventId,
      email,
      sentAt: delivery.sentAt,
      origin: 'backfill',
    });
    return {};
  },
});

/**
 * Explicit runner for the recipient-key backfill.
 *
 * Running the migration function directly also works, but only via the
 * component's CLI auto-detection path. Going through this runner records the
 * component migration state under the same name
 * (`migrations:backfillEmailDeliveryRecipientKeys`) that
 * `guest_list/maintenance.enable` reads as its precondition, regardless of how
 * the operator invoked it.
 */
export const runEmailDeliveryRecipientKeyBackfill = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    reset: v.optional(v.boolean()),
    oneBatchOnly: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await startMigrationSeries(
      ctx,
      await resolveMigration(
        internal.migrations.backfillEmailDeliveryRecipientKeys,
      ),
      [],
      args,
    );
    return null;
  },
});

/**
 * Standalone runner for the ticket roster projection backfill.
 *
 * The migration also runs as the second step of
 * {@link runGuestListBackfills}; this entrypoint lets an operator run, resume,
 * or re-run it on its own, and records the component state under the name
 * `guest_list/maintenance.enable` gates on.
 */
export const runTicketRosterEmailBackfill = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    reset: v.optional(v.boolean()),
    oneBatchOnly: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await startMigrationSeries(
      ctx,
      await resolveMigration(
        internal.migrations.backfillTicketRosterEmailLower,
      ),
      [],
      args,
    );
    return null;
  },
});

export const runTokenDigestBackfills = migrations.runner([
  internal.migrations.backfillMagicLinkTokenDigests,
  internal.migrations.backfillAdminInviteTokenDigests,
  internal.migrations.backfillGuestSessionTokenDigests,
  internal.migrations.backfillUserMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillAddressMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillMarketingDeliveryTrackingTokenDigests,
  internal.migrations.clearLegacyUserEmailChangeTokens,
]);
