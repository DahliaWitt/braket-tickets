import {v, type Infer} from 'convex/values';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {throwAppError} from '../errors';
import type {AssertEqual} from '../type_utils';

type GuestListEventStatsCtx = Pick<MutationCtx, 'db'>;

export const MAX_GUESTS_PER_EVENT_STATS = 5000;
export const MAX_ASSIGNMENTS_PER_EVENT_STATS = 500;
export const GUEST_ADMISSION_CAP_EXCEEDED = 'GUEST_ADMISSION_CAP_EXCEEDED';
export const ACTIVE_ASSIGNMENT_CAP_EXCEEDED = 'ACTIVE_ASSIGNMENT_CAP_EXCEEDED';
export const GUEST_LIST_EVENT_CAP_EXCEEDED = 'GUEST_LIST_EVENT_CAP_EXCEEDED';

export type GuestListEventCounterFields = Omit<
  Doc<'guestListEventStats'>,
  '_id' | '_creationTime'
>;

type GuestListEventCounterPatch = Partial<
  Omit<GuestListEventCounterFields, 'eventId'>
>;

export function assertGuestAdmissionCapacity(
  stats: Pick<GuestListEventCounterFields, 'totalGuestAdmissionCount'>,
  additionalCount: number,
  options?: {errorCode?: string; operation?: string},
): void {
  if (
    stats.totalGuestAdmissionCount + additionalCount <=
    MAX_GUESTS_PER_EVENT_STATS
  ) {
    return;
  }
  throwAppError(
    options?.errorCode ?? GUEST_ADMISSION_CAP_EXCEEDED,
    `This event already holds ${stats.totalGuestAdmissionCount} guest admissions; ` +
      `${options?.operation ?? 'adding'} ${additionalCount} more would exceed the ` +
      `per-event limit of ${MAX_GUESTS_PER_EVENT_STATS}. Remove some and retry.`,
    {
      existingCount: stats.totalGuestAdmissionCount,
      insertCount: additionalCount,
      maxPerEvent: MAX_GUESTS_PER_EVENT_STATS,
    },
  );
}

export function assertActiveAssignmentCapacity(
  stats: Pick<GuestListEventCounterFields, 'activeAssignmentCount'>,
  additionalCount = 1,
): void {
  if (
    stats.activeAssignmentCount + additionalCount <=
    MAX_ASSIGNMENTS_PER_EVENT_STATS
  ) {
    return;
  }
  throwAppError(
    ACTIVE_ASSIGNMENT_CAP_EXCEEDED,
    `This event already has ${stats.activeAssignmentCount} active guest-list assignments; ` +
      `adding ${additionalCount} more would exceed the per-event limit of ` +
      `${MAX_ASSIGNMENTS_PER_EVENT_STATS}. Revoke an assignment and retry.`,
    {
      existingCount: stats.activeAssignmentCount,
      insertCount: additionalCount,
      maxPerEvent: MAX_ASSIGNMENTS_PER_EVENT_STATS,
    },
  );
}

/**
 * Bounded description of an event whose roster is too large to snapshot.
 *
 * Counts are read with a `take(limit + 1)` bound, so a saturated value is
 * reported as "at least" rather than an exact total: an operator reading the
 * report knows the event is over the cap and by how much it is known to
 * exceed it, without the report itself performing an unbounded scan.
 */
export type GuestListEventOverage = {
  eventId: Id<'events'>;
  guestCount: number;
  guestCountAtLeast: boolean;
  activeAssignmentCount: number;
  activeAssignmentCountAtLeast: boolean;
  maxGuestsPerEvent: number;
  maxActiveAssignmentsPerEvent: number;
};

export const guestListEventOverageValidator = v.object({
  eventId: v.id('events'),
  guestCount: v.number(),
  guestCountAtLeast: v.boolean(),
  activeAssignmentCount: v.number(),
  activeAssignmentCountAtLeast: v.boolean(),
  maxGuestsPerEvent: v.number(),
  maxActiveAssignmentsPerEvent: v.number(),
});

const _guestListEventOverageValidatorMatchesType: AssertEqual<
  Infer<typeof guestListEventOverageValidator>,
  GuestListEventOverage
> = true;

/**
 * Result of one bounded roster read: either the authoritative counters, or the
 * reason the event cannot be counted. Callers that need both answers must use
 * this rather than calling the counter loader twice — a single oversized event
 * already reads up to `MAX_GUESTS_PER_EVENT_STATS + MAX_ASSIGNMENTS_PER_EVENT_STATS + 2`
 * documents, and a second pass would risk the per-transaction read limit.
 */
export type GuestListEventCounterOutcome =
  | {kind: 'counted'; counters: GuestListEventCounterFields}
  | {kind: 'oversized'; overage: GuestListEventOverage};

type CountableGuest = Pick<Doc<'guests'>, 'sourceKind'>;
type CountableAssignment = Pick<
  Doc<'guestListAssignments'>,
  'role' | 'grantedSlots' | 'usedSlots'
>;

function deriveGuestListEventCounters(
  eventId: Id<'events'>,
  guests: readonly CountableGuest[],
  assignments: readonly CountableAssignment[],
): GuestListEventCounterFields {
  return {
    eventId,
    selfServiceGuestCount: guests.filter(
      (guest) => guest.sourceKind === 'self_service',
    ).length,
    activeGrantedSlots: assignments.reduce(
      (sum, assignment) => sum + assignment.grantedSlots,
      0,
    ),
    activeArtistGuestCount: assignments
      .filter((assignment) => assignment.role === 'artist')
      .reduce((sum, assignment) => sum + assignment.usedSlots, 0),
    activeStaffGuestCount: assignments
      .filter((assignment) => assignment.role === 'staff')
      .reduce((sum, assignment) => sum + assignment.usedSlots, 0),
    activeAssignmentCount: assignments.length,
    totalGuestAdmissionCount: guests.length,
  };
}

async function loadActiveAssignmentsBounded(
  ctx: Pick<QueryCtx, 'db'>,
  eventId: Id<'events'>,
): Promise<Doc<'guestListAssignments'>[]> {
  return await ctx.db
    .query('guestListAssignments')
    .withIndex('by_eventId_and_status', (q) =>
      q.eq('eventId', eventId).eq('status', 'active'),
    )
    .take(MAX_ASSIGNMENTS_PER_EVENT_STATS + 1);
}

export async function loadGuestListEventCounterOutcome(
  ctx: Pick<QueryCtx, 'db'>,
  eventId: Id<'events'>,
): Promise<GuestListEventCounterOutcome> {
  const [guests, assignments] = await Promise.all([
    ctx.db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .take(MAX_GUESTS_PER_EVENT_STATS + 1),
    loadActiveAssignmentsBounded(ctx, eventId),
  ]);
  const guestCountAtLeast = guests.length > MAX_GUESTS_PER_EVENT_STATS;
  const activeAssignmentCountAtLeast =
    assignments.length > MAX_ASSIGNMENTS_PER_EVENT_STATS;
  if (guestCountAtLeast || activeAssignmentCountAtLeast) {
    return {
      kind: 'oversized',
      overage: {
        eventId,
        guestCount: guests.length,
        guestCountAtLeast,
        activeAssignmentCount: assignments.length,
        activeAssignmentCountAtLeast,
        maxGuestsPerEvent: MAX_GUESTS_PER_EVENT_STATS,
        maxActiveAssignmentsPerEvent: MAX_ASSIGNMENTS_PER_EVENT_STATS,
      },
    };
  }
  return {
    kind: 'counted',
    counters: deriveGuestListEventCounters(eventId, guests, assignments),
  };
}

export async function loadAuthoritativeGuestListEventCounters(
  ctx: Pick<QueryCtx, 'db'>,
  eventId: Id<'events'>,
): Promise<GuestListEventCounterFields | null> {
  const outcome = await loadGuestListEventCounterOutcome(ctx, eventId);
  return outcome.kind === 'counted' ? outcome.counters : null;
}

/**
 * Renders a bounded overage for logs and operator-facing error messages.
 */
export function describeGuestListEventOverage(
  overage: GuestListEventOverage,
): string {
  const guests = `${overage.guestCountAtLeast ? 'at least ' : ''}${overage.guestCount}`;
  const assignments = `${overage.activeAssignmentCountAtLeast ? 'at least ' : ''}${overage.activeAssignmentCount}`;
  return (
    `event ${overage.eventId} holds ${guests} guest admissions and ${assignments} ` +
    `active assignments, above the supported per-event limit of ` +
    `${overage.maxGuestsPerEvent} guests / ${overage.maxActiveAssignmentsPerEvent} active assignments`
  );
}

export async function getOrCreateGuestListEventStats(
  ctx: GuestListEventStatsCtx,
  eventId: Id<'events'>,
): Promise<Doc<'guestListEventStats'>> {
  const existing = await getExistingGuestListEventStats(ctx, eventId);
  if (existing) return existing;

  const created = await tryInitializeGuestListEventStats(ctx, eventId);
  if (created) return created;
  throwAppError(
    GUEST_LIST_EVENT_CAP_EXCEEDED,
    `Guest-list event stats initialization exceeds the supported per-event limit ` +
      `(${MAX_GUESTS_PER_EVENT_STATS} guests or ${MAX_ASSIGNMENTS_PER_EVENT_STATS} active assignments)`,
    {
      maxGuestsPerEvent: MAX_GUESTS_PER_EVENT_STATS,
      maxActiveAssignmentsPerEvent: MAX_ASSIGNMENTS_PER_EVENT_STATS,
    },
  );
}

/**
 * Variant of {@link getOrCreateGuestListEventStats} for callers that already
 * performed the bounded roster read (e.g. bulk import dedup). Seeding from the
 * supplied roster avoids repeating a take(MAX_GUESTS_PER_EVENT_STATS + 1) read
 * in the same transaction. `roster.complete` must be true only when the array
 * is known to contain every guest row for the event; otherwise this falls back
 * to the self-reading initializer.
 */
export async function getOrCreateGuestListEventStatsFromRoster(
  ctx: GuestListEventStatsCtx,
  eventId: Id<'events'>,
  roster: {guests: readonly CountableGuest[]; complete: boolean},
): Promise<Doc<'guestListEventStats'>> {
  const existing = await getExistingGuestListEventStats(ctx, eventId);
  if (existing) return existing;
  if (!roster.complete || roster.guests.length > MAX_GUESTS_PER_EVENT_STATS) {
    return await getOrCreateGuestListEventStats(ctx, eventId);
  }
  const assignments = await loadActiveAssignmentsBounded(ctx, eventId);
  if (assignments.length > MAX_ASSIGNMENTS_PER_EVENT_STATS) {
    throwAppError(
      GUEST_LIST_EVENT_CAP_EXCEEDED,
      `Guest-list event stats initialization exceeds the supported per-event limit ` +
        `(${MAX_GUESTS_PER_EVENT_STATS} guests or ${MAX_ASSIGNMENTS_PER_EVENT_STATS} active assignments)`,
      {
        maxGuestsPerEvent: MAX_GUESTS_PER_EVENT_STATS,
        maxActiveAssignmentsPerEvent: MAX_ASSIGNMENTS_PER_EVENT_STATS,
      },
    );
  }
  const counters = deriveGuestListEventCounters(
    eventId,
    roster.guests,
    assignments,
  );
  const statsId = await ctx.db.insert('guestListEventStats', counters);
  const created = await ctx.db.get('guestListEventStats', statsId);
  if (!created) throw new Error('Failed to create guest-list event stats');
  return created;
}

export async function getExistingGuestListEventStats(
  ctx: GuestListEventStatsCtx,
  eventId: Id<'events'>,
): Promise<Doc<'guestListEventStats'> | null> {
  return await ctx.db
    .query('guestListEventStats')
    .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
    .unique();
}

/**
 * Initializes stats only when the post-mutation authoritative roster is within
 * both supported limits. Reduction paths call this after deleting a guest or
 * revoking an assignment so legacy oversized events remain cleanable; while
 * they are still over cap no partial/truncated snapshot is written.
 */
export async function tryInitializeGuestListEventStats(
  ctx: GuestListEventStatsCtx,
  eventId: Id<'events'>,
): Promise<Doc<'guestListEventStats'> | null> {
  const existing = await getExistingGuestListEventStats(ctx, eventId);
  if (existing) return existing;

  const counters = await loadAuthoritativeGuestListEventCounters(ctx, eventId);
  if (!counters) return null;
  const statsId = await ctx.db.insert('guestListEventStats', counters);
  const created = await ctx.db.get('guestListEventStats', statsId);
  if (!created) throw new Error('Failed to create guest-list event stats');
  return created;
}

export async function updateGuestListEventStats(
  ctx: GuestListEventStatsCtx,
  stats: Doc<'guestListEventStats'>,
  update: (current: Doc<'guestListEventStats'>) => GuestListEventCounterPatch,
): Promise<void> {
  await ctx.db.patch('guestListEventStats', stats._id, update(stats));
}

export async function updateGuestListEventStatsAfterReduction(
  ctx: GuestListEventStatsCtx,
  eventId: Id<'events'>,
  existingStats: Doc<'guestListEventStats'> | null,
  update: (current: Doc<'guestListEventStats'>) => GuestListEventCounterPatch,
): Promise<void> {
  if (existingStats) {
    await updateGuestListEventStats(ctx, existingStats, update);
    return;
  }
  await tryInitializeGuestListEventStats(ctx, eventId);
}

export async function replaceGuestListEventStats(
  ctx: GuestListEventStatsCtx,
  counters: GuestListEventCounterFields,
): Promise<void> {
  const existing = await ctx.db
    .query('guestListEventStats')
    .withIndex('by_eventId', (q) => q.eq('eventId', counters.eventId))
    .unique();
  if (existing) {
    await ctx.db.patch('guestListEventStats', existing._id, counters);
    return;
  }
  await ctx.db.insert('guestListEventStats', counters);
}
