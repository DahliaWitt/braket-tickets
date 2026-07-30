import {Migrations} from '@convex-dev/migrations';
import {components, internal} from './_generated/api';
import type {DataModel} from './_generated/dataModel';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';
import {normalizeEmailOrNull} from './lib/validation';

export const migrations = new Migrations<DataModel>(components.migrations);

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
  migrateOne: async (ctx, event) => {
    const existing = await ctx.db
      .query('guestListEventStats')
      .withIndex('by_eventId', (q) => q.eq('eventId', event._id))
      .unique();
    if (existing) return {};
    const guests = await ctx.db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', event._id))
      .take(5001);
    const assignments = await ctx.db
      .query('guestListAssignments')
      .withIndex('by_eventId_and_status', (q) => q.eq('eventId', event._id))
      .take(501);
    if (guests.length > 5000 || assignments.length > 500) {
      throw new Error(
        'Guest-list event stats backfill exceeds the supported per-event limit (5000 guests or 500 assignments)',
      );
    }
    const active = assignments.filter(
      (assignment) => assignment.status === 'active',
    );
    await ctx.db.insert('guestListEventStats', {
      eventId: event._id,
      selfServiceGuestCount: guests.filter(
        (guest) => guest.sourceKind === 'self_service',
      ).length,
      activeGrantedSlots: active.reduce(
        (sum, assignment) => sum + assignment.grantedSlots,
        0,
      ),
      activeArtistGuestCount: active
        .filter((assignment) => assignment.role === 'artist')
        .reduce((sum, assignment) => sum + assignment.usedSlots, 0),
      activeStaffGuestCount: active
        .filter((assignment) => assignment.role === 'staff')
        .reduce((sum, assignment) => sum + assignment.usedSlots, 0),
      activeAssignmentCount: active.length,
      totalGuestAdmissionCount: guests.length,
    });
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

export const runGuestListBackfills = migrations.runner([
  internal.migrations.backfillGuestEmailKeys,
  internal.migrations.backfillGuestListEventStats,
  internal.migrations.backfillGuestListAssignmentEventDates,
]);

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
