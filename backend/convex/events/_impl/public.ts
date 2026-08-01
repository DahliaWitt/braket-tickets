import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import type {PublicEventPreview} from '@shared/contracts/public-event';
import {
  canViewCommunity,
  canViewEvent,
  filterViewableEvents,
  isPlatformAdmin,
} from '../../lib/access';
import {countMatchingInQuery} from '../../lib/query_scan';
import {
  formatEventDateTime,
  hasEventEnded,
  ongoingEventStartLowerBound,
} from '../../lib/timezone';
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

// No schema cap exists on `description`; truncate server-side so the edge
// never ships (and discards) up to 1MB of text for an OG meta tag.
const PUBLIC_EVENT_PREVIEW_DESCRIPTION_MAX_LENGTH = 300;

/**
 * Public, unauthenticated single-event preview for OG/social-card
 * unfurling. Backs the `/api/events/:id` HTTP route.
 *
 * `args.id` is a raw URL path segment, not a validated `Id<'events'>` — it
 * may be garbage from a bot or a stale link, so normalization and every
 * downstream lookup must fail closed to `null` (no existence oracle: a
 * missing event and a denied event both return `null`).
 *
 * Past/ended events remain previewable by design — a shared link should
 * keep unfurling correctly after the event has ended.
 */
export async function getPublicEventPreview(
  ctx: QueryCtx,
  args: {id: string},
): Promise<PublicEventPreview | null> {
  const eventId = ctx.db.normalizeId('events', args.id);
  if (!eventId) return null;

  const event = await ctx.db.get('events', eventId);
  if (!event) return null;

  // Preload the organizer once and pass it into canViewEvent's options so
  // the access check does not repeat this read internally.
  const organizer = await ctx.db.get('organizers', event.organizerId);

  if (!(await canViewEvent(ctx, null, event, {organizer}))) {
    return null;
  }

  // The anonymous grant path in canViewEvent requires a published event in a
  // published community — which in turn requires a non-null organizer — so
  // organizer is guaranteed live here. The explicit null check keeps this
  // invariant enforced by the type system rather than an unchecked assertion.
  if (!organizer) return null;

  const rawPosterUrl = await getPosterUrl(ctx, event.poster);
  // http:// og:image values are rejected by unfurlers and arbitrary schemes
  // must never reach the OG card — only pass through https:// URLs. Convex
  // storage URLs are always https, so this only affects legacy http poster
  // values (e.g. seed data or external sources).
  const posterUrl =
    rawPosterUrl !== null && rawPosterUrl.startsWith('https://')
      ? rawPosterUrl
      : null;

  return {
    _id: event._id,
    title: event.title,
    description: event.description?.slice(
      0,
      PUBLIC_EVENT_PREVIEW_DESCRIPTION_MAX_LENGTH,
    ),
    date: event.date,
    dateLabel: formatEventDateTime({
      date: event.date,
      endDate: event.endDate,
    }),
    location: event.location,
    posterUrl,
    organizerName: organizer.name,
  };
}
