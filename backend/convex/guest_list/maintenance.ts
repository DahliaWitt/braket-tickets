import {v} from 'convex/values';
import {internalMutation, internalQuery} from '../_generated/server';
import {normalizeEmailOrNull} from '../lib/validation';
import {internal} from '../_generated/api';
import {
  loadAuthoritativeGuestListEventCounters,
  MAX_ASSIGNMENTS_PER_EVENT_STATS,
  MAX_GUESTS_PER_EVENT_STATS,
  replaceGuestListEventStats,
  type GuestListEventCounterFields,
} from '../lib/guest_list/event_stats';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
// Each event may consume the full bounded reads below, so verification advances
// one event per transaction rather than multiplying that worst case.
const MAX_EVENTS_PER_VERIFICATION_BATCH = 1;

function countersMatch(
  stored: GuestListEventCounterFields,
  expected: GuestListEventCounterFields,
): boolean {
  return (
    stored.selfServiceGuestCount === expected.selfServiceGuestCount &&
    stored.activeGrantedSlots === expected.activeGrantedSlots &&
    stored.activeArtistGuestCount === expected.activeArtistGuestCount &&
    stored.activeStaffGuestCount === expected.activeStaffGuestCount &&
    stored.activeAssignmentCount === expected.activeAssignmentCount &&
    stored.totalGuestAdmissionCount === expected.totalGuestAdmissionCount
  );
}

export const getFeatureState = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      emailKeyBackfillComplete: v.boolean(),
      guestCountBackfillComplete: v.boolean(),
      verificationInProgress: v.boolean(),
      verificationStartedAt: v.optional(v.number()),
      verificationCompletedAt: v.optional(v.number()),
      enabledAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    return state
      ? {
          emailKeyBackfillComplete: state.emailKeyBackfillComplete,
          guestCountBackfillComplete: state.guestCountBackfillComplete,
          verificationInProgress: state.verificationInProgress ?? false,
          verificationStartedAt: state.verificationStartedAt,
          verificationCompletedAt: state.verificationCompletedAt,
          enabledAt: state.enabledAt,
        }
      : null;
  },
});

export const recordBackfillVerification = internalMutation({
  args: {
    runId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    emailKeyBackfillComplete: v.boolean(),
    guestCountBackfillComplete: v.boolean(),
    inProgress: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(100, Math.floor(args.batchSize ?? 50)),
    );
    let state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    const requestedRunId = args.runId;
    if (!requestedRunId) {
      const runId = String(Date.now());
      const reset = {
        emailKeyBackfillComplete: false,
        guestCountBackfillComplete: false,
        verificationInProgress: true,
        verificationRunId: runId,
        emailKeyVerificationCursor: undefined,
        guestCountVerificationCursor: undefined,
        emailKeyVerificationValid: true,
        emailKeyVerificationFinished: false,
        guestCountVerificationValid: true,
        verificationStartedAt: Date.now(),
        verificationCompletedAt: undefined,
        enabledAt: undefined,
      };
      if (state) {
        await ctx.db.patch('guestListFeatureState', state._id, reset);
        state = {...state, ...reset};
      } else {
        const id = await ctx.db.insert('guestListFeatureState', {
          key: 'singleton',
          ...reset,
        });
        state = await ctx.db.get('guestListFeatureState', id);
      }
    }
    if (!state) throw new Error('Failed to initialize guest-list verification');
    const runId = requestedRunId ?? state.verificationRunId;
    if (
      !runId ||
      state.verificationRunId !== runId ||
      !state.verificationInProgress
    ) {
      return {
        emailKeyBackfillComplete: state.emailKeyBackfillComplete,
        guestCountBackfillComplete: state.guestCountBackfillComplete,
        inProgress: state.verificationInProgress ?? false,
      };
    }

    if (!state.emailKeyVerificationFinished) {
      const page = await ctx.db.query('guests').paginate({
        numItems: batchSize,
        cursor: state.emailKeyVerificationCursor ?? null,
      });
      const valid =
        (state.emailKeyVerificationValid ?? true) &&
        page.page.every(
          (guest) =>
            guest.emailKey === (normalizeEmailOrNull(guest.email) ?? undefined),
        );
      await ctx.db.patch('guestListFeatureState', state._id, {
        emailKeyVerificationValid: valid,
        emailKeyVerificationCursor: page.continueCursor,
        ...(page.isDone ? {emailKeyVerificationFinished: true} : {}),
        ...(page.isDone ? {emailKeyBackfillComplete: valid} : {}),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.guest_list.maintenance.recordBackfillVerification,
        {runId, batchSize},
      );
      return {
        emailKeyBackfillComplete: page.isDone && valid,
        guestCountBackfillComplete: false,
        inProgress: true,
      };
    }

    const page = await ctx.db.query('events').paginate({
      numItems: Math.min(batchSize, MAX_EVENTS_PER_VERIFICATION_BATCH),
      cursor: state.guestCountVerificationCursor ?? null,
    });
    const comparisons = await Promise.all(
      page.page.map(async (event) => {
        const [stats, expected] = await Promise.all([
          ctx.db
            .query('guestListEventStats')
            .withIndex('by_eventId', (q) => q.eq('eventId', event._id))
            .unique(),
          loadAuthoritativeGuestListEventCounters(ctx, event._id),
        ]);
        return (
          stats !== null && expected !== null && countersMatch(stats, expected)
        );
      }),
    );
    const valid =
      (state.guestCountVerificationValid ?? true) && comparisons.every(Boolean);
    if (!page.isDone) {
      await ctx.db.patch('guestListFeatureState', state._id, {
        guestCountVerificationValid: valid,
        guestCountVerificationCursor: page.continueCursor,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.guest_list.maintenance.recordBackfillVerification,
        {runId, batchSize},
      );
      return {
        emailKeyBackfillComplete: state.emailKeyBackfillComplete,
        guestCountBackfillComplete: false,
        inProgress: true,
      };
    }
    await ctx.db.patch('guestListFeatureState', state._id, {
      guestCountVerificationValid: valid,
      guestCountVerificationCursor: page.continueCursor,
      guestCountBackfillComplete: valid,
      verificationInProgress: false,
      verificationCompletedAt: Date.now(),
    });
    return {
      emailKeyBackfillComplete: state.emailKeyBackfillComplete,
      guestCountBackfillComplete: valid,
      inProgress: false,
    };
  },
});

export const enable = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    if (
      !state?.emailKeyBackfillComplete ||
      !state.guestCountBackfillComplete ||
      state.verificationInProgress ||
      state.verificationCompletedAt === undefined
    )
      throw new Error('Guest-list backfills are not verified');
    await ctx.db.patch('guestListFeatureState', state._id, {
      enabledAt: Date.now(),
    });
    return null;
  },
});

export const disable = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    if (state)
      await ctx.db.patch('guestListFeatureState', state._id, {
        enabledAt: undefined,
      });
    return null;
  },
});

export const reconcileEventCounters = internalMutation({
  args: {eventId: v.id('events')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const fields = await loadAuthoritativeGuestListEventCounters(
      ctx,
      args.eventId,
    );
    if (!fields) {
      throw new Error(
        `Guest-list counter reconciliation exceeds the supported per-event limit (${MAX_GUESTS_PER_EVENT_STATS} guests or ${MAX_ASSIGNMENTS_PER_EVENT_STATS} assignments)`,
      );
    }
    await replaceGuestListEventStats(ctx, fields);
    return null;
  },
});

export const syncAssignmentEventDate = internalMutation({
  args: {
    eventId: v.id('events'),
    eventDate: v.string(),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('events', args.eventId);
    if (!event || event.date !== args.eventDate) return null;
    const page = await ctx.db
      .query('guestListAssignments')
      .withIndex('by_eventId_and_status', (q) => q.eq('eventId', args.eventId))
      .paginate({numItems: 100, cursor: args.cursor ?? null});
    await Promise.all(
      page.page.map((assignment) =>
        ctx.db.patch('guestListAssignments', assignment._id, {
          eventDate: event.date,
        }),
      ),
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.guest_list.maintenance.syncAssignmentEventDate,
        {
          eventId: args.eventId,
          eventDate: event.date,
          cursor: page.continueCursor,
        },
      );
    }
    return null;
  },
});

export const cleanupAuditEvents = internalMutation({
  args: {cutoffTimestamp: v.optional(v.number())},
  returns: v.number(),
  handler: async (ctx, args) => {
    const cutoff = args.cutoffTimestamp ?? Date.now() - AUDIT_RETENTION_MS;
    const rows = await ctx.db
      .query('guestListAuditEvents')
      .order('asc')
      .take(500);
    const expired = rows.filter((row) => row._creationTime < cutoff);
    await Promise.all(
      expired.map((row) => ctx.db.delete('guestListAuditEvents', row._id)),
    );
    if (rows.length === 500 && expired.length === 500) {
      await ctx.scheduler.runAfter(
        0,
        internal.guest_list.maintenance.cleanupAuditEvents,
        {cutoffTimestamp: cutoff},
      );
    }
    return expired.length;
  },
});
