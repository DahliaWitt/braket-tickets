import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {
  canViewCommunity,
  canViewEvent,
  filterViewableEvents,
  isPlatformAdmin,
} from '../../lib/access';
import {countMatchingInQuery} from '../../lib/query_scan';
import {hasEventEnded, ongoingEventStartLowerBound} from '../../lib/timezone';
import {getAuthUserId} from '../../lib/auth_identity';
import {
  getPosterUrl,
  mapEventsWithPosterUrls,
  toEventDetail,
} from '../../lib/events/read_models';
import {resolveCommunityLogoUrl} from '../../lib/communities/read_models';
import {
  loadUpcomingPublishedEventsForOrganizer,
  resolveOrganizerIdFromEventListArgs,
} from './queries';
import {
  listPublicUpcomingCards,
  loadCanonicalListAvailability,
} from './listing';
import {
  loadBatchEventAvailability,
  loadEventAvailability,
} from './availability';

export async function listVisiblePublishedEvents(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  // TODO(BRA-410): Replace this all-results read with a real paginated API.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results API until pagination is added.
  const events = await ctx.db
    .query('events')
    .withIndex('by_status', (q) => q.eq('status', 'published'))
    .order('desc')
    .collect();
  const viewableEvents = await filterViewableEvents(ctx, userId, events);
  return await mapEventsWithPosterUrls(ctx, viewableEvents);
}

export async function listUpcomingPublishedEvents(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  // Look back MAX_EVENT_DURATION so running multi-day events (started before
  // today, not yet ended) are included; the `by_status_date` index yields
  // start-date-ascending order, honouring the "sorted by date" contract.
  const minDate = ongoingEventStartLowerBound();
  // TODO(BRA-410): Replace this all-results read with a real paginated API.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results API until pagination is added.
  const events = await ctx.db
    .query('events')
    .withIndex('by_status_date', (q) =>
      q.eq('status', 'published').gte('date', minDate),
    )
    .collect();

  const ongoingEvents = events.filter((event) => !hasEventEnded(event));
  const viewableEvents = await filterViewableEvents(ctx, userId, ongoingEvents);

  return await mapEventsWithPosterUrls(ctx, viewableEvents);
}

export async function listPublicUpcomingEvents(ctx: QueryCtx) {
  return await listPublicUpcomingCards(ctx);
}

export async function listEventsByOrganizer(
  ctx: QueryCtx,
  args: {
    organizerId?: Id<'organizers'>;
    slug?: string;
    communityParam?: string;
  },
) {
  const organizerId = await resolveOrganizerIdFromEventListArgs(ctx, args);

  if (!organizerId) {
    return null;
  }

  const organizer = await ctx.db.get('organizers', organizerId);
  if (!organizer) {
    return null;
  }

  const userId = await getAuthUserId(ctx);
  if (!(await canViewCommunity(ctx, userId, organizer))) {
    return null;
  }

  const publishedEvents = await loadUpcomingPublishedEventsForOrganizer(
    ctx.db,
    organizerId,
  );
  const events = await filterViewableEvents(ctx, userId, publishedEvents);
  const availabilityByEventId = await loadCanonicalListAvailability(
    ctx.db,
    events,
  );
  const eventsWithAvailability = await mapEventsWithPosterUrls(
    ctx,
    events,
    availabilityByEventId,
  );

  const organizerLogoUrl = await resolveCommunityLogoUrl(
    ctx,
    organizer.logoStorageId,
  );

  return {
    organizerName: organizer.name,
    organizerDescription: organizer.description,
    organizerLogoUrl,
    organizerCodeOfConduct: organizer.codeOfConduct,
    events: eventsWithAvailability,
  };
}

export async function getEventById(ctx: QueryCtx, args: {id: Id<'events'>}) {
  const userId = await getAuthUserId(ctx);

  const event = await ctx.db.get('events', args.id);
  if (!event) return null;

  if (!(await canViewEvent(ctx, userId, event))) {
    return null;
  }

  const isRootAdminUser =
    userId !== null ? await isPlatformAdmin(ctx, userId) : false;

  const [posterUrl, organizer, guestCount] = await Promise.all([
    getPosterUrl(ctx, event.poster),
    ctx.db.get('organizers', event.organizerId),
    isRootAdminUser
      ? countMatchingInQuery(
          ctx.db
            .query('guests')
            .withIndex('by_event', (q) => q.eq('eventId', event._id)),
          () => true,
        )
      : Promise.resolve(0),
  ]);

  const organizerLogoUrl = await resolveCommunityLogoUrl(
    ctx,
    organizer?.logoStorageId,
  );
  return toEventDetail(event, {
    posterUrl,
    organizer,
    organizerLogoUrl,
    guestCount,
  });
}

export async function getEventAvailability(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; now: number},
) {
  return await loadEventAvailability(ctx, args);
}

export async function getBatchEventAvailability(
  ctx: QueryCtx,
  args: {eventIds: Id<'events'>[]; now: number},
) {
  return await loadBatchEventAvailability(ctx, args);
}
