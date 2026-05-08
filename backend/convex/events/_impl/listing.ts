import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {canViewEvent} from '../../lib/access';
import {calculateEventInventory} from '../../lib/inventory';
import {startOfTodayInEventTimeZone} from '../../lib/timezone';
import {isEligibleForPublicDirectory} from '../../lib/communities/public';
import {
  mapPublicEventCards,
  type PublicEventAvailabilitySummary,
} from '../../lib/events/read_models';

const PUBLIC_UPCOMING_CARD_LIMIT = 12;
const PUBLIC_UPCOMING_SCAN_PAGE_SIZE = 60;

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
  const minDate = startOfTodayInEventTimeZone();
  const publicEvents: Doc<'events'>[] = [];
  let cursor: string | null = null;

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

    const eligibleEvents = await filterLandingPageEvents(ctx, result.page);
    publicEvents.push(
      ...eligibleEvents.slice(
        0,
        PUBLIC_UPCOMING_CARD_LIMIT - publicEvents.length,
      ),
    );

    if (result.isDone) {
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
