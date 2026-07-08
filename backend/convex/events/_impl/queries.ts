import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {EVENT_VISIBILITIES} from '@shared/domain/event-visibility';
import {throwInvalidInput, throwUnauthorized} from '../../lib/errors';
import {isPlatformAdmin, requireManageCommunity} from '../../lib/access';
import {getUserCommunities} from '../../lib/authz';
import {hasEventEnded, ongoingEventStartLowerBound} from '../../lib/timezone';
import {logger} from '../../lib/logger';

const ORGANIZER_EVENT_LIST_LIMIT = 500;

/**
 * Safety valve on the organizer discovery scan. Pagination walks past ended
 * lookback rows to reach live events, so read cost is data-dependent; this
 * caps rows read per visibility well below the Convex per-query document
 * budget (leaving room for the 3 visibility scans plus downstream availability
 * reads). No realistic organizer approaches it — past this many events in the
 * lookback window the scan degrades (with a logged warning) instead of
 * throwing at the budget.
 */
const ORGANIZER_EVENT_MAX_SCAN_ROWS = 2_000;

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

/**
 * Collect up to `limit` not-yet-ended published events for one visibility,
 * scanning past already-ended lookback rows. A fixed `.take()` from the
 * lookback boundary could be entirely consumed by a burst of recently-ended
 * events, hiding later running/upcoming ones — async iteration keeps scanning
 * until `limit` live events are found, the scan cap is hit, or the query is
 * exhausted.
 *
 * Uses async iteration rather than `.paginate()` on purpose: this helper runs
 * once per visibility, and Convex allows only ONE `.paginate()` call per
 * function invocation ("ran multiple paginated queries"). Async iteration has
 * no such limit and streams the same index range lazily. (convex-test does not
 * enforce the paginate limit, so a paginate-based loop here passes unit tests
 * but throws on the real backend — see the community-filter E2E specs.)
 */
async function collectOngoingEventsForVisibility(
  db: Pick<QueryCtx['db'], 'query'>,
  organizerId: Id<'organizers'>,
  visibility: (typeof EVENT_VISIBILITIES)[number],
  minDate: string,
  limit: number,
): Promise<Doc<'events'>[]> {
  const collected: Doc<'events'>[] = [];
  let scanned = 0;

  for await (const event of db
    .query('events')
    .withIndex('by_organizer_status_visibility_date', (q) =>
      q
        .eq('organizerId', organizerId)
        .eq('status', 'published')
        .eq('visibility', visibility)
        .gte('date', minDate),
    )) {
    scanned += 1;
    if (!hasEventEnded(event)) {
      collected.push(event);
      if (collected.length >= limit) break;
    }
    if (scanned >= ORGANIZER_EVENT_MAX_SCAN_ROWS) {
      // Degrade instead of risking a per-query document-budget failure. Not
      // silent: an organizer with this many ended lookback rows is anomalous
      // and worth investigating.
      logger.warn(
        'events',
        'Organizer discovery scan hit the row cap; result may omit some events',
        {organizerId, visibility, scanned, collected: collected.length},
      );
      break;
    }
  }

  return collected;
}

export async function loadUpcomingPublishedEventsForOrganizer(
  db: Pick<QueryCtx['db'], 'query'>,
  organizerId: Id<'organizers'>,
): Promise<Doc<'events'>[]> {
  // Look back MAX_EVENT_DURATION on the organizer-scoped date index so running
  // multi-day events (started before today, not yet ended) are reached in
  // start-date order; each visibility scans past ended rows so they cannot
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
