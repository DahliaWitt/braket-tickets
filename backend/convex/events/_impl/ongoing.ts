import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {nowInstantIso, startOfTodayInEventTimeZone} from '../../lib/timezone';

/**
 * Upper bound on rows read from an endDate index in one query. The index is
 * ordered by endDate ascending, so in-progress events (which end soonest) sort
 * first. Every not-yet-ended event with an explicit end counts toward this
 * bound, so on a platform with hundreds of such events ending in the near
 * future a running event ending later could be truncated; the organizer-scoped
 * variant keeps this per-community.
 */
const RUNNING_EVENT_SCAN_LIMIT = 200;

/**
 * Keeps only events that started before today — exactly the rows a
 * `date >= today` query misses. `event.date` here is always a full ISO instant
 * (endDate is only set on events created through the ISO-validated write path),
 * so the lexical comparison is chronological.
 */
function startedBeforeToday(
  rows: ReadonlyArray<Doc<'events'>>,
  startOfToday: string,
): Doc<'events'>[] {
  return rows.filter((event) => event.date < startOfToday);
}

/**
 * Published events that started before today but have not ended yet — i.e.
 * multi-day events currently in progress across all communities. These are
 * exactly the rows a `date >= today` query misses, so a caller can union them
 * with that source without overlap.
 *
 * Read via the `by_status_endDate` index (`endDate > now`) so discovery never
 * scans past events. Rows without an `endDate` sort before any string and are
 * excluded by the range, which is the authoritative not-ended cutoff for this
 * source (it shares one `now` with the caller's date boundary).
 */
export async function loadRunningPublishedEvents(
  db: Pick<QueryCtx['db'], 'query'>,
): Promise<Doc<'events'>[]> {
  const startOfToday = startOfTodayInEventTimeZone();
  const rows = await db
    .query('events')
    .withIndex('by_status_endDate', (q) =>
      q.eq('status', 'published').gt('endDate', nowInstantIso()),
    )
    .take(RUNNING_EVENT_SCAN_LIMIT);
  return startedBeforeToday(rows, startOfToday);
}

/**
 * Organizer-scoped version of {@link loadRunningPublishedEvents}: a community
 * page reads only its own running events, so completeness never depends on
 * other communities' event volume under the shared scan limit.
 */
export async function loadRunningPublishedEventsForOrganizer(
  db: Pick<QueryCtx['db'], 'query'>,
  organizerId: Id<'organizers'>,
): Promise<Doc<'events'>[]> {
  const startOfToday = startOfTodayInEventTimeZone();
  const rows = await db
    .query('events')
    .withIndex('by_organizer_status_endDate', (q) =>
      q
        .eq('organizerId', organizerId)
        .eq('status', 'published')
        .gt('endDate', nowInstantIso()),
    )
    .take(RUNNING_EVENT_SCAN_LIMIT);
  return startedBeforeToday(rows, startOfToday);
}

/**
 * Stable ascending order by event start (`date`), tie-broken by creation time.
 * Currently-running events (start in the past) naturally sort ahead of
 * not-yet-started events.
 */
export function compareEventsByStartAscending(
  left: Doc<'events'>,
  right: Doc<'events'>,
): number {
  return left.date === right.date
    ? left._creationTime - right._creationTime
    : left.date.localeCompare(right.date);
}
