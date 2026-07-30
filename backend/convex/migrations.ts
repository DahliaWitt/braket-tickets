import {Migrations} from '@convex-dev/migrations';
import {createFunctionHandle, getFunctionName} from 'convex/server';
import {ConvexError, v} from 'convex/values';
import {components, internal} from './_generated/api';
import type {DataModel} from './_generated/dataModel';
import {internalMutation} from './_generated/server';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';
import {normalizeEmailOrNull} from './lib/validation';
import {
  loadAuthoritativeGuestListEventCounters,
  MAX_ASSIGNMENTS_PER_EVENT_STATS,
  MAX_GUESTS_PER_EVENT_STATS,
  replaceGuestListEventStats,
} from './lib/guest_list/event_stats';

export const migrations = new Migrations<DataModel>(components.migrations);
const GUEST_LIST_EVENT_STATS_BATCH_SIZE = 1;

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

export const backfillGuestEmailKeys = migrations.define({
  table: 'guests',
  migrateOne: (_ctx, guest) => ({
    emailKey: normalizeEmailOrNull(guest.email) ?? undefined,
  }),
});

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
    const counters = await loadAuthoritativeGuestListEventCounters(
      ctx,
      event._id,
    );
    if (!counters) {
      throw new Error(
        `Guest-list event stats backfill exceeds the supported per-event limit (${MAX_GUESTS_PER_EVENT_STATS} guests or ${MAX_ASSIGNMENTS_PER_EVENT_STATS} assignments)`,
      );
    }
    await replaceGuestListEventStats(ctx, counters);
    return {};
  },
});

export const backfillGuestListAssignmentEventDates = migrations.define({
  table: 'guestListAssignments',
  migrateOne: async (ctx, assignment) => {
    if (assignment.eventDate !== undefined) return {};
    const event = await ctx.db.get('events', assignment.eventId);
    return event ? {eventDate: event.date} : {};
  },
});

export function emailDeliveryRecipientKeyPatch(delivery: {
  recipient: string;
  recipientKey?: string;
}): {recipientKey?: string} {
  if (delivery.recipientKey !== undefined) return {};
  const recipientKey = normalizeEmailOrNull(delivery.recipient);
  return recipientKey ? {recipientKey} : {};
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

const guestListBackfills = [
  internal.migrations.backfillGuestEmailKeys,
  internal.migrations.backfillGuestListEventStats,
  internal.migrations.backfillGuestListAssignmentEventDates,
] as const;

function isSuccessfulMigrationDryRun(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return false;
  }
  if (data.kind !== 'DRY RUN' || !('status' in data)) return false;
  const status: unknown = data.status;
  return (
    typeof status === 'object' &&
    status !== null &&
    'state' in status &&
    (status.state === 'success' || status.state === 'inProgress')
  );
}

/**
 * Runs the guest-list migration series with a non-overridable one-document
 * batch. The event-stats step can read a dense event's full bounded roster, so
 * allowing an operator-supplied larger batch would combine several dense
 * events in one transaction.
 */
export const runGuestListBackfills = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    reset: v.optional(v.boolean()),
    oneBatchOnly: v.optional(v.boolean()),
    // Accepted for backwards-compatible CLI invocations, but deliberately
    // ignored so callers cannot raise the safe batch size.
    batchSize: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [first, ...rest] = guestListBackfills;
    const next = await Promise.all(
      rest.map(async (migration) => ({
        name: getFunctionName(migration),
        fnHandle: await createFunctionHandle(migration),
      })),
    );
    try {
      await ctx.runMutation(components.migrations.lib.migrate, {
        name: getFunctionName(first),
        fnHandle: await createFunctionHandle(first),
        cursor: args.reset ? null : args.cursor,
        batchSize: GUEST_LIST_EVENT_STATS_BATCH_SIZE,
        next,
        dryRun: args.dryRun ?? false,
        reset: args.reset,
        oneBatchOnly: args.oneBatchOnly,
      });
    } catch (error) {
      if (!args.dryRun || !isSuccessfulMigrationDryRun(error)) throw error;
    }
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

export const runTokenDigestBackfills = migrations.runner([
  internal.migrations.backfillMagicLinkTokenDigests,
  internal.migrations.backfillAdminInviteTokenDigests,
  internal.migrations.backfillGuestSessionTokenDigests,
  internal.migrations.backfillUserMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillAddressMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillMarketingDeliveryTrackingTokenDigests,
  internal.migrations.clearLegacyUserEmailChangeTokens,
]);
