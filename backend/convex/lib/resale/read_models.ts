import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';

type QueryableDb = Pick<QueryCtx['db'], 'query'>;

export async function getGroupedResaleListingsByEvent(
  db: QueryableDb,
  sellerId: Id<'users'>,
  eventIds: Id<'events'>[],
): Promise<Record<string, Doc<'resale_listings'>[]>> {
  if (eventIds.length === 0) {
    return {};
  }

  const requestedEventIds = new Set<Id<'events'>>(eventIds);
  const listings = await db
    .query('resale_listings')
    .withIndex('by_seller_event', (q) => q.eq('sellerId', sellerId))
    .take(1000);

  const groupedByEvent: Record<string, Doc<'resale_listings'>[]> = {};
  for (const eventId of eventIds) {
    groupedByEvent[eventId] = [];
  }

  for (const listing of listings) {
    if (!requestedEventIds.has(listing.eventId)) continue;
    groupedByEvent[listing.eventId].push(listing);
  }

  for (const eventId of eventIds) {
    groupedByEvent[eventId].sort((a, b) => b._creationTime - a._creationTime);
  }

  return groupedByEvent;
}
