import {v} from 'convex/values';
import {internalMutation, internalQuery} from '../_generated/server';
import type {MutationCtx} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {normalizeEmailOrNull} from '../lib/validation';
import {internal} from '../_generated/api';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_GUESTS_PER_RECONCILIATION = 5000;
const MAX_ASSIGNMENTS_PER_RECONCILIATION = 500;
// Each event may consume the full bounded reads below, so verification advances
// one event per transaction rather than multiplying that worst case.
const MAX_EVENTS_PER_VERIFICATION_BATCH = 1;

type EventCounterFields = {
  eventId: Id<'events'>;
  selfServiceGuestCount: number;
  activeGrantedSlots: number;
  activeArtistGuestCount: number;
  activeStaffGuestCount: number;
  activeAssignmentCount: number;
  totalGuestAdmissionCount: number;
};

async function authoritativeEventCounters(
  ctx: Pick<MutationCtx, 'db'>,
  eventId: Id<'events'>,
): Promise<EventCounterFields | null> {
  const guests = await ctx.db
    .query('guests')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .take(MAX_GUESTS_PER_RECONCILIATION + 1);
  if (guests.length > MAX_GUESTS_PER_RECONCILIATION) return null;
  const assignments = await ctx.db
    .query('guestListAssignments')
    .withIndex('by_eventId_and_status', (q) => q.eq('eventId', eventId))
    .take(MAX_ASSIGNMENTS_PER_RECONCILIATION + 1);
  if (assignments.length > MAX_ASSIGNMENTS_PER_RECONCILIATION) return null;
  const active = assignments.filter((assignment) => assignment.status === 'active');
  return {
    eventId,
    selfServiceGuestCount: guests.filter((guest) => guest.sourceKind === 'self_service').length,
    activeGrantedSlots: active.reduce((sum, assignment) => sum + assignment.grantedSlots, 0),
    activeArtistGuestCount: active.filter((assignment) => assignment.role === 'artist').reduce((sum, assignment) => sum + assignment.usedSlots, 0),
    activeStaffGuestCount: active.filter((assignment) => assignment.role === 'staff').reduce((sum, assignment) => sum + assignment.usedSlots, 0),
    activeAssignmentCount: active.length,
    totalGuestAdmissionCount: guests.length,
  };
}

function countersMatch(
  stored: EventCounterFields,
  expected: EventCounterFields,
): boolean {
  return stored.selfServiceGuestCount === expected.selfServiceGuestCount &&
    stored.activeGrantedSlots === expected.activeGrantedSlots &&
    stored.activeArtistGuestCount === expected.activeArtistGuestCount &&
    stored.activeStaffGuestCount === expected.activeStaffGuestCount &&
    stored.activeAssignmentCount === expected.activeAssignmentCount &&
    stored.totalGuestAdmissionCount === expected.totalGuestAdmissionCount;
}

export const getFeatureState = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object({
    emailKeyBackfillComplete: v.boolean(),
    guestCountBackfillComplete: v.boolean(),
    verificationInProgress: v.boolean(),
    verificationStartedAt: v.optional(v.number()),
    verificationCompletedAt: v.optional(v.number()),
    enabledAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const state = await ctx.db.query('guestListFeatureState').withIndex('by_key', (q) => q.eq('key', 'singleton')).unique();
    return state ? {
      emailKeyBackfillComplete: state.emailKeyBackfillComplete,
      guestCountBackfillComplete: state.guestCountBackfillComplete,
      verificationInProgress: state.verificationInProgress ?? false,
      verificationStartedAt: state.verificationStartedAt,
      verificationCompletedAt: state.verificationCompletedAt,
      enabledAt: state.enabledAt,
    } : null;
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
    const batchSize = Math.max(1, Math.min(100, Math.floor(args.batchSize ?? 50)));
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
    if (!runId || state.verificationRunId !== runId || !state.verificationInProgress) {
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
          authoritativeEventCounters(ctx, event._id),
        ]);
        return stats !== null && expected !== null && countersMatch(stats, expected);
      }),
    );
    const valid =
      (state.guestCountVerificationValid ?? true) &&
      comparisons.every(Boolean);
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
    const state = await ctx.db.query('guestListFeatureState').withIndex('by_key', (q) => q.eq('key', 'singleton')).unique();
    if (
      !state?.emailKeyBackfillComplete ||
      !state.guestCountBackfillComplete ||
      state.verificationInProgress ||
      state.verificationCompletedAt === undefined
    ) throw new Error('Guest-list backfills are not verified');
    await ctx.db.patch('guestListFeatureState', state._id, {enabledAt: Date.now()});
    return null;
  },
});

export const disable = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db.query('guestListFeatureState').withIndex('by_key', (q) => q.eq('key', 'singleton')).unique();
    if (state) await ctx.db.patch('guestListFeatureState', state._id, {enabledAt: undefined});
    return null;
  },
});

export const reconcileEventCounters = internalMutation({
  args: {eventId: v.id('events')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const fields = await authoritativeEventCounters(ctx, args.eventId);
    if (!fields) {
      throw new Error(
        `Guest-list counter reconciliation exceeds the supported per-event limit (${MAX_GUESTS_PER_RECONCILIATION} guests or ${MAX_ASSIGNMENTS_PER_RECONCILIATION} assignments)`,
      );
    }
    const stats = await ctx.db.query('guestListEventStats').withIndex('by_eventId', (q) => q.eq('eventId', args.eventId)).unique();
    if (stats) await ctx.db.patch('guestListEventStats', stats._id, fields);
    else await ctx.db.insert('guestListEventStats', fields);
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
    const page = await ctx.db
      .query('guestListAssignments')
      .withIndex('by_eventId_and_status', (q) => q.eq('eventId', args.eventId))
      .paginate({numItems: 100, cursor: args.cursor ?? null});
    await Promise.all(
      page.page.map((assignment) =>
        ctx.db.patch('guestListAssignments', assignment._id, {
          eventDate: args.eventDate,
        }),
      ),
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.guest_list.maintenance.syncAssignmentEventDate,
        {
          eventId: args.eventId,
          eventDate: args.eventDate,
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
    const rows = await ctx.db.query('guestListAuditEvents').order('asc').take(500);
    const expired = rows.filter((row) => row._creationTime < cutoff);
    await Promise.all(expired.map((row) => ctx.db.delete('guestListAuditEvents', row._id)));
    if (rows.length === 500 && expired.length === 500) {
      await ctx.scheduler.runAfter(0, internal.guest_list.maintenance.cleanupAuditEvents, {cutoffTimestamp: cutoff});
    }
    return expired.length;
  },
});
