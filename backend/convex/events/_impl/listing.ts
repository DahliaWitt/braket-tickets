import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {canViewEvent} from '../../lib/access';
import {calculateEventInventory} from '../../lib/inventory';
import {hasEventEnded, ongoingEventStartLowerBound} from '../../lib/timezone';
import {isEligibleForPublicDirectory} from '../../lib/communities/public';
import {logger} from '../../lib/logger';
import {
  mapPublicEventCards,
  type PublicEventAvailabilitySummary,
} from '../../lib/events/read_models';

const PUBLIC_UPCOMING_CARD_LIMIT = 12;
const PUBLIC_UPCOMING_SCAN_PAGE_SIZE = 60;

/**
 * Safety valve on the landing-page discovery scan. Pagination walks past ended
 * lookback rows to reach live events, so read cost is data-dependent; this
 * caps rows read well below the Convex per-query document budget (leaving room
 * for the downstream organizer and availability reads). Past this many events
 * in the lookback window the scan degrades (with a logged warning) instead of
 * throwing at the budget.
 */
const PUBLIC_UPCOMING_MAX_SCAN_ROWS = 2_000;

export async function loadCanonicalListAvailability(
  db: QueryCtx['db'],
  events: ReadonlyArray<Doc<'events'>>,
): Promise<Map<Id<'events'>, PublicEventAvailabilitySummary>> {
  const results = await Promise.all(
    events.map(async (event) => {
      const inventory = await calculateEventInventory(
        db,
        event._id,
        event.totalTickets,
      );
      return [
        event._id,
        {soldCount: inventory.soldCount, isSoldOut: inventory.remaining === 0},
      ] as const;
    }),
  );

  return new Map(results);
}

async function filterLandingPageEvents(
  ctx: QueryCtx,
  events: ReadonlyArray<Doc<'events'>>,
): Promise<Doc<'events'>[]> {
  const uniqueOrganizerIds = [
    ...new Set(events.map((event) => event.organizerId)),
  ];
  const organizers = await Promise.all(
    uniqueOrganizerIds.map((organizerId) =>
      ctx.db.get('organizers', organizerId),
    ),
  );
  const organizerById = new Map(
    uniqueOrganizerIds.map((organizerId, index) => [
      organizerId,
      organizers[index] ?? null,
    ]),
  );

  const decisions = await Promise.all(
    events.map(async (event) => {
      const organizer = organizerById.get(event.organizerId);
      return (
        organizer !== null &&
        organizer !== undefined &&
        (await canViewEvent(ctx, null, event, {organizer})) &&
        isEligibleForPublicDirectory(organizer)
      );
    }),
  );

  return events.filter((_, index) => decisions[index]);
}

export async function listPublicUpcomingCards(ctx: QueryCtx) {
  // Look back MAX_EVENT_DURATION on the date index so events that started
  // before today but have not yet ended (running multi-day events) are still
  // reached in start-date order; ended rows are dropped with hasEventEnded.
  // The bounded window keeps the scan complete — no running event can be
  // crowded out of a fixed take.
  const minDate = ongoingEventStartLowerBound();
  const publicEvents: Doc<'events'>[] = [];
  let cursor: string | null = null;
  let scanned = 0;

  while (publicEvents.length < PUBLIC_UPCOMING_CARD_LIMIT) {
    const result = await ctx.db
      .query('events')
      .withIndex('by_status_date', (q) =>
        q.eq('status', 'published').gte('date', minDate),
      )
      .paginate({
        cursor,
        numItems: PUBLIC_UPCOMING_SCAN_PAGE_SIZE,
      });

    const ongoingPage = result.page.filter((event) => !hasEventEnded(event));
    const eligibleEvents = await filterLandingPageEvents(ctx, ongoingPage);
    publicEvents.push(
      ...eligibleEvents.slice(
        0,
        PUBLIC_UPCOMING_CARD_LIMIT - publicEvents.length,
      ),
    );

    scanned += result.page.length;
    if (result.isDone) {
      break;
    }
    if (scanned >= PUBLIC_UPCOMING_MAX_SCAN_ROWS) {
      // Degrade instead of risking a per-query document-budget failure. Not
      // silent: this many ended lookback rows platform-wide is anomalous and
      // worth investigating.
      logger.warn(
        'events',
        'Landing-page discovery scan hit the row cap; result may omit some events',
        {scanned, collected: publicEvents.length},
      );
      break;
    }

    cursor = result.continueCursor;
  }

  const availabilityByEventId = await loadCanonicalListAvailability(
    ctx.db,
    publicEvents,
  );

  return await mapPublicEventCards(ctx, publicEvents, availabilityByEventId);
}
