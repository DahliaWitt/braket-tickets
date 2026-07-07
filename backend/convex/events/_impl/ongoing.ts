import type {Doc} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {
  hasEventEnded,
  nowInstantIso,
  startOfTodayInEventTimeZone,
} from '../../lib/timezone';

/**
 * Upper bound on rows read from the endDate index in one query. The index is
 * ordered by endDate ascending, so in-progress events (which end soonest) sort
 * first. This bound is only reached on a platform with hundreds of events
 * ending in the near future; running multi-day events stay near the front.
 */
const RUNNING_EVENT_SCAN_LIMIT = 200;

/**
 * Published events that started before today but have not ended yet — i.e.
 * multi-day events currently in progress. These are exactly the rows a
 * `date >= today` query misses, so a caller can union them with that source
 * without overlap.
 *
 * Read via the `by_status_endDate` index (`endDate > now`) so discovery never
 * scans past events. Rows without an `endDate` sort before any string and are
 * excluded by the range; the `date < startOfToday` filter drops events that
 * are already covered by the date source, and hasEventEnded drops the boundary
 * case (endDate === now).
 */
export async function loadRunningPublishedEvents(
  db: Pick<QueryCtx['db'], 'query'>,
): Promise<Doc<'events'>[]> {
  const nowIso = nowInstantIso();
  const startOfToday = startOfTodayInEventTimeZone();
  const rows = await db
    .query('events')
    .withIndex('by_status_endDate', (q) =>
      q.eq('status', 'published').gt('endDate', nowIso),
    )
    .take(RUNNING_EVENT_SCAN_LIMIT);
  return rows.filter(
    (event) => event.date < startOfToday && !hasEventEnded(event),
  );
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
