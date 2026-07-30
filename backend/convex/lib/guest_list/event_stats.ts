import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {throwAppError} from '../errors';

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

export async function loadAuthoritativeGuestListEventCounters(
  ctx: Pick<MutationCtx, 'db'>,
  eventId: Id<'events'>,
): Promise<GuestListEventCounterFields | null> {
  const [guests, assignments] = await Promise.all([
    ctx.db
      .query('guests')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .take(MAX_GUESTS_PER_EVENT_STATS + 1),
    ctx.db
      .query('guestListAssignments')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'active'),
      )
      .take(MAX_ASSIGNMENTS_PER_EVENT_STATS + 1),
  ]);
  if (
    guests.length > MAX_GUESTS_PER_EVENT_STATS ||
    assignments.length > MAX_ASSIGNMENTS_PER_EVENT_STATS
  ) {
    return null;
  }
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
