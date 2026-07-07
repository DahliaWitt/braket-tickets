import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {EVENT_VISIBILITIES} from '@shared/domain/event-visibility';
import {throwInvalidInput, throwUnauthorized} from '../../lib/errors';
import {isPlatformAdmin, requireManageCommunity} from '../../lib/access';
import {getUserCommunities} from '../../lib/authz';
import {hasEventEnded, ongoingEventStartLowerBound} from '../../lib/timezone';

const ORGANIZER_EVENT_LIST_LIMIT = 500;

type OrganizerLookupArgs = {
  organizerId?: Id<'organizers'>;
  slug?: string;
  communityParam?: string;
};

type OrganizerLookupCtx = {
  db: QueryCtx['db'];
};

export async function resolveOrganizerIdFromEventListArgs(
  ctx: OrganizerLookupCtx,
  args: OrganizerLookupArgs,
): Promise<Id<'organizers'> | undefined> {
  if (args.communityParam) {
    const normalized = ctx.db.normalizeId('organizers', args.communityParam);
    if (normalized) {
      return normalized;
    }

    const organizer = await ctx.db
      .query('organizers')
      .withIndex('by_slug', (q) => q.eq('slug', args.communityParam!))
      .first();
    return organizer?._id;
  }

  const hasId = args.organizerId !== undefined;
  const hasSlug = args.slug !== undefined && args.slug.length > 0;

  if (!hasId && !hasSlug) {
    return undefined;
  }
  if (hasId && hasSlug) {
    throwInvalidInput('Provide either organizerId or slug, not both');
  }

  if (hasSlug) {
    const organizer = await ctx.db
      .query('organizers')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug!))
      .first();
    return organizer?._id;
  }

  return args.organizerId;
}

const ORGANIZER_EVENT_SCAN_PAGE_SIZE = 100;

/**
 * Collect up to `limit` not-yet-ended published events for one visibility,
 * paginating past already-ended lookback rows. A fixed `.take()` from the
 * lookback boundary could be entirely consumed by a burst of recently-ended
 * events, hiding later running/upcoming ones — pagination keeps scanning until
 * `limit` live events are found or the query is exhausted.
 */
async function collectOngoingEventsForVisibility(
  db: Pick<QueryCtx['db'], 'query'>,
  organizerId: Id<'organizers'>,
  visibility: (typeof EVENT_VISIBILITIES)[number],
  minDate: string,
  limit: number,
): Promise<Doc<'events'>[]> {
  const collected: Doc<'events'>[] = [];
  let cursor: string | null = null;

  while (collected.length < limit) {
    const page = await db
      .query('events')
      .withIndex('by_organizer_status_visibility_date', (q) =>
        q
          .eq('organizerId', organizerId)
          .eq('status', 'published')
          .eq('visibility', visibility)
          .gte('date', minDate),
      )
      .paginate({cursor, numItems: ORGANIZER_EVENT_SCAN_PAGE_SIZE});

    for (const event of page.page) {
      if (hasEventEnded(event)) continue;
      collected.push(event);
      if (collected.length >= limit) break;
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return collected;
}

export async function loadUpcomingPublishedEventsForOrganizer(
  db: Pick<QueryCtx['db'], 'query'>,
  organizerId: Id<'organizers'>,
): Promise<Doc<'events'>[]> {
  // Look back MAX_EVENT_DURATION on the organizer-scoped date index so running
  // multi-day events (started before today, not yet ended) are reached in
  // start-date order; each visibility paginates past ended rows so they cannot
  // consume the cap.
  const minDate = ongoingEventStartLowerBound();
  const eventGroups = await Promise.all(
    EVENT_VISIBILITIES.map((visibility) =>
      collectOngoingEventsForVisibility(
        db,
        organizerId,
        visibility,
        minDate,
        ORGANIZER_EVENT_LIST_LIMIT,
      ),
    ),
  );

  return eventGroups
    .flat()
    .sort((left, right) =>
      left.date === right.date
        ? left._creationTime - right._creationTime
        : left.date.localeCompare(right.date),
    )
    .slice(0, ORGANIZER_EVENT_LIST_LIMIT);
}

export async function loadAdminVisibleEvents(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  args: {organizerId?: Id<'organizers'>} = {},
): Promise<Doc<'events'>[]> {
  if (args.organizerId !== undefined) {
    const organizerId = args.organizerId;
    await requireManageCommunity(ctx, user._id, organizerId);
    return ctx.db
      .query('events')
      .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
      .order('desc')
      .take(500);
  }

  if (await isPlatformAdmin(ctx, user._id)) {
    return ctx.db.query('events').order('desc').take(500);
  }

  const communityIds = await getUserCommunities(ctx, user._id);
  if (communityIds.length === 0) {
    throwUnauthorized();
  }

  const eventArrays = await Promise.all(
    communityIds.map((organizerId) =>
      ctx.db
        .query('events')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .order('desc')
        .take(500),
    ),
  );

  return eventArrays
    .flat()
    .sort((left, right) => right._creationTime - left._creationTime);
}
