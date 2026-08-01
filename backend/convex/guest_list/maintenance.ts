import {getFunctionName} from 'convex/server';
import {v} from 'convex/values';
import {internalMutation, internalQuery} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {normalizeEmailOrNull} from '../lib/validation';
import {components, internal} from '../_generated/api';
import {logger} from '../lib/logger';
import {throwAppError} from '../lib/errors';
import {
  describeGuestListEventOverage,
  guestListEventOverageValidator,
  loadGuestListEventCounterOutcome,
  MAX_ASSIGNMENTS_PER_EVENT_STATS,
  MAX_GUESTS_PER_EVENT_STATS,
  replaceGuestListEventStats,
  type GuestListEventCounterFields,
} from '../lib/guest_list/event_stats';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
// Each event may consume the full bounded reads below, so verification advances
// one event per transaction rather than multiplying that worst case.
const MAX_EVENTS_PER_VERIFICATION_BATCH = 1;
const MODULE = 'guest_list_maintenance';

/**
 * Upper bound on the explicit oversized-event acknowledgement list. The list is
 * operator-typed, threaded through the verifier's own reschedules, and only
 * ever suppresses events that are genuinely uncountable, so it stays small by
 * construction; the cap keeps the scheduled args bounded regardless.
 */
export const MAX_ACKNOWLEDGED_OVERSIZED_EVENTS = 50;

/** Stable code for a rejected enablement, with the blockers in `error.data`. */
export const GUEST_LIST_ENABLE_BLOCKED = 'GUEST_LIST_ENABLE_BLOCKED';

/** Stable code for a repair attempt on an event that cannot be counted. */
export const GUEST_LIST_EVENT_UNCOUNTABLE = 'GUEST_LIST_EVENT_UNCOUNTABLE';

/**
 * Events without a stats row are the ones a completed backfill could not
 * resolve. Enumerating them is cheap (one indexed lookup per event), so this
 * scan may use a normal page size — measuring an event's roster is the
 * expensive part and is deliberately left to
 * {@link describeGuestListEventLoad}, one event per call.
 */
const DEFAULT_MISSING_STATS_SCAN_LIMIT = 200;
const MAX_MISSING_STATS_SCAN_LIMIT = 500;

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

/**
 * Cursor-batched authoritative re-check of both guest-list backfills.
 *
 * `acknowledgedOversizedEventIds` is the operator's explicit escape hatch for
 * legacy events that exceed the per-event stats limits and therefore have no
 * countable snapshot. Without it a single such event keeps
 * `guestCountBackfillComplete` false forever and blocks enablement for the
 * whole deployment. The acknowledgement is deliberately narrow:
 *
 * - it only applies to an event that is *currently* uncountable, so it can
 *   never hide a real counter mismatch on a normal event;
 * - each acknowledged event is logged at WARN on every batch that consumes it;
 * - no stats row is written for it, so every guest-list write path for that
 *   event keeps failing closed with `GUEST_LIST_EVENT_CAP_EXCEEDED` until the
 *   roster is reduced back under the cap and
 *   {@link reconcileEventCounters} is run.
 *
 * Enumerate candidates with {@link listEventsMissingGuestListStats} and confirm
 * each one with {@link describeGuestListEventLoad} before acknowledging it.
 */
export const recordBackfillVerification = internalMutation({
  args: {
    runId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    acknowledgedOversizedEventIds: v.optional(v.array(v.id('events'))),
  },
  returns: v.object({
    emailKeyBackfillComplete: v.boolean(),
    guestCountBackfillComplete: v.boolean(),
    inProgress: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const acknowledgedOversizedEventIds =
      args.acknowledgedOversizedEventIds ?? [];
    if (
      acknowledgedOversizedEventIds.length > MAX_ACKNOWLEDGED_OVERSIZED_EVENTS
    ) {
      throwAppError(
        GUEST_LIST_ENABLE_BLOCKED,
        `At most ${MAX_ACKNOWLEDGED_OVERSIZED_EVENTS} oversized events may be acknowledged in one verification run.`,
        {supplied: acknowledgedOversizedEventIds.length},
      );
    }
    const acknowledged = new Set<string>(acknowledgedOversizedEventIds);
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
        {runId, batchSize, acknowledgedOversizedEventIds},
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
        const [stats, outcome] = await Promise.all([
          ctx.db
            .query('guestListEventStats')
            .withIndex('by_eventId', (q) => q.eq('eventId', event._id))
            .unique(),
          loadGuestListEventCounterOutcome(ctx, event._id),
        ]);
        if (outcome.kind === 'oversized') {
          if (!acknowledged.has(event._id)) {
            logger.error(
              MODULE,
              'Guest-list verification cannot count an event; ' +
                `${describeGuestListEventOverage(outcome.overage)}. ` +
                'Reduce the roster and re-run, or acknowledge it explicitly ' +
                'via recordBackfillVerification.acknowledgedOversizedEventIds.',
              outcome.overage,
            );
            return false;
          }
          logger.warn(
            MODULE,
            'Guest-list verification accepted an explicitly acknowledged ' +
              `uncountable event; ${describeGuestListEventOverage(outcome.overage)}. ` +
              'No stats row exists, so guest-list writes for this event stay fail-closed.',
            outcome.overage,
          );
          return true;
        }
        return stats !== null && countersMatch(stats, outcome.counters);
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
        {runId, batchSize, acknowledgedOversizedEventIds},
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

/**
 * Enumerates events that have no `guestListEventStats` row.
 *
 * After `migrations:runGuestListBackfills` reports done, this is exactly the
 * set of events the backfill could not resolve — in practice, legacy events
 * over the per-event guest/assignment limits. Each entry costs one indexed
 * lookup, so the scan is cheap and cursor-resumable; call
 * {@link describeGuestListEventLoad} per returned id for the actual counts.
 */
export const listEventsMissingGuestListStats = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    eventIds: v.array(v.id('events')),
    scanned: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const numItems = Math.max(
      1,
      Math.min(
        MAX_MISSING_STATS_SCAN_LIMIT,
        Math.floor(args.limit ?? DEFAULT_MISSING_STATS_SCAN_LIMIT),
      ),
    );
    const page = await ctx.db.query('events').paginate({
      numItems,
      cursor: args.cursor ?? null,
    });
    const missing = await Promise.all(
      page.page.map(async (event) => {
        const stats = await ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', event._id))
          .unique();
        return stats === null ? event._id : null;
      }),
    );
    return {
      eventIds: missing.filter((id): id is Id<'events'> => id !== null),
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Measures one event's bounded roster and reports whether it can be counted.
 *
 * One event per call: an oversized event reads its full bounded roster, so
 * batching several would multiply that worst case in a single transaction.
 */
export const describeGuestListEventLoad = internalQuery({
  args: {eventId: v.id('events')},
  returns: v.object({
    hasStatsRow: v.boolean(),
    counters: v.union(
      v.null(),
      v.object({
        selfServiceGuestCount: v.number(),
        activeGrantedSlots: v.number(),
        activeArtistGuestCount: v.number(),
        activeStaffGuestCount: v.number(),
        activeAssignmentCount: v.number(),
        totalGuestAdmissionCount: v.number(),
      }),
    ),
    overage: v.union(v.null(), guestListEventOverageValidator),
  }),
  handler: async (ctx, args) => {
    const [stats, outcome] = await Promise.all([
      ctx.db
        .query('guestListEventStats')
        .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
        .unique(),
      loadGuestListEventCounterOutcome(ctx, args.eventId),
    ]);
    if (outcome.kind === 'oversized') {
      return {
        hasStatsRow: stats !== null,
        counters: null,
        overage: outcome.overage,
      };
    }
    const {eventId: _eventId, ...counters} = outcome.counters;
    return {hasStatsRow: stats !== null, counters, overage: null};
  },
});

/**
 * Migrations that must be finished before the feature may be enabled, keyed by
 * the blocker name reported in the rejection payload.
 *
 * - the recipient-key backfill is required by the spec
 *   (`docs/plans/2026-07-10-self-service-guest-list-design.md`, release step 4);
 *   without it a recipient-scoped ticket send can fail closed mid-batch.
 * - the ticket roster projection backfill feeds
 *   `by_event_and_rosterEmailLower_and_status`, which
 *   `hasValidTicketForAssignment` uses to notice that a delegate already holds
 *   a guest-checkout ticket. Enabling before it completes issues duplicate
 *   admissions and duplicate ticket emails to those holders.
 *
 * Reading the component's own status makes these gates rather than operator
 * discipline.
 */
const REQUIRED_MIGRATIONS = [
  {
    blocker: 'recipientKeyBackfillIncomplete',
    name: getFunctionName(
      internal.migrations.backfillEmailDeliveryRecipientKeys,
    ),
  },
  {
    blocker: 'ticketRosterEmailBackfillIncomplete',
    name: getFunctionName(internal.migrations.backfillTicketRosterEmailLower),
  },
] as const;

export const enable = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    const blockers: string[] = [];
    if (!state) blockers.push('verificationNeverRun');
    if (state && !state.emailKeyBackfillComplete) {
      blockers.push('emailKeyBackfillIncomplete');
    }
    if (state && !state.guestCountBackfillComplete) {
      blockers.push('guestCountBackfillIncomplete');
    }
    if (state?.verificationInProgress) blockers.push('verificationInProgress');
    if (state && state.verificationCompletedAt === undefined) {
      blockers.push('verificationNotCompleted');
    }
    const migrationStatuses = await ctx.runQuery(
      components.migrations.lib.getStatus,
      {names: REQUIRED_MIGRATIONS.map((migration) => migration.name)},
    );
    // getStatus reverses the rows it returns, so match on `name` rather than
    // assuming the response is aligned with the requested order.
    const doneByName = new Map(
      migrationStatuses.map((status) => [status.name, status.isDone]),
    );
    const incompleteMigrations: string[] = [];
    for (const migration of REQUIRED_MIGRATIONS) {
      if (doneByName.get(migration.name) !== true) {
        blockers.push(migration.blocker);
        incompleteMigrations.push(migration.name);
      }
    }
    if (blockers.length > 0) {
      throwAppError(
        GUEST_LIST_ENABLE_BLOCKED,
        'Guest-list enablement is blocked: ' +
          `${blockers.join(', ')}. Inspect guest_list/maintenance:getFeatureState, ` +
          'the migration status of ' +
          `${REQUIRED_MIGRATIONS.map((migration) => migration.name).join(', ')}, and ` +
          'guest_list/maintenance:listEventsMissingGuestListStats.',
        {blockers, incompleteMigrations},
      );
    }
    if (!state) {
      throwAppError(
        GUEST_LIST_ENABLE_BLOCKED,
        'Guest-list verification has never run.',
        {blockers: ['verificationNeverRun']},
      );
    }
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
    const outcome = await loadGuestListEventCounterOutcome(ctx, args.eventId);
    if (outcome.kind === 'oversized') {
      throwAppError(
        GUEST_LIST_EVENT_UNCOUNTABLE,
        'Guest-list counter reconciliation exceeds the supported per-event limit ' +
          `(${MAX_GUESTS_PER_EVENT_STATS} guests or ${MAX_ASSIGNMENTS_PER_EVENT_STATS} active assignments): ` +
          `${describeGuestListEventOverage(outcome.overage)}.`,
        outcome.overage,
      );
    }
    await replaceGuestListEventStats(ctx, outcome.counters);
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
