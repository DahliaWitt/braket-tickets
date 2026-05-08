import type {Doc, Id} from '../../../_generated/dataModel';
import type {QueryCtx} from '../../../_generated/server';
import type {PublicCommunity} from '../../../../../shared/contracts/public-community';
import {batchGetStorageUrls} from '../../../lib/storage_urls';
import {isPubliclyVisible} from '../../../lib/access';
import {resolveCommunityLogoUrl} from '../../../lib/communities/read_models';
import {isEligibleForPublicDirectory} from '../../../lib/communities/public';
import {derivePublicationStatus} from '../../../lib/community_status';
import {throwAppError} from '../../../lib/errors';

const MAX_PUBLIC_DIRECTORY_OPTED_IN_COMMUNITIES = 100;
const MAX_PUBLIC_DIRECTORY_PUBLISHED_EVENTS = 500;
/** Upper bound for the admin-path full organizer scan in the events directory query. */
const MAX_EVENTS_DIRECTORY_ALL_COMMUNITIES = 500;
const MAX_PUBLIC_COMMUNITY_SLUG_EVENT_SCAN = 500;

export type {PublicCommunity} from '../../../../../shared/contracts/public-community';

function assertExplicitQueryLimit<T>(
  items: T[],
  limit: number,
  scope: string,
): T[] {
  if (items.length > limit) {
    throwAppError(
      'QUERY_LIMIT_EXCEEDED',
      `${scope} exceeded the explicit limit of ${limit}; paginate or narrow the query before increasing this cap`,
      {scope, limit},
    );
  }

  return items;
}

async function loadOrganizerPublicPublishedEvents(
  db: QueryCtx['db'],
  organizerId: Id<'organizers'>,
): Promise<Doc<'events'>[]> {
  return assertExplicitQueryLimit(
    await db
      .query('events')
      .withIndex('by_organizer_status', (q) =>
        q.eq('organizerId', organizerId).eq('status', 'published'),
      )
      .take(MAX_PUBLIC_COMMUNITY_SLUG_EVENT_SCAN + 1),
    MAX_PUBLIC_COMMUNITY_SLUG_EVENT_SCAN,
    'Public community slug event scan',
  );
}

async function hasPublicPublishedEvent(
  db: QueryCtx['db'],
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  const publishedEvents = await loadOrganizerPublicPublishedEvents(
    db,
    organizerId,
  );
  return publishedEvents.some((event) => isPubliclyVisible(event));
}

async function hasAnyPublishedEvent(
  db: QueryCtx['db'],
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  const publishedEvents = await db
    .query('events')
    .withIndex('by_organizer_status', (q) =>
      q.eq('organizerId', organizerId).eq('status', 'published'),
    )
    .take(1);
  return publishedEvents.length > 0;
}

function toPublicCommunity(
  doc: Doc<'organizers'>,
  logoUrl: string | undefined,
): PublicCommunity {
  return {
    _id: doc._id,
    name: doc.name,
    status: derivePublicationStatus(doc),
    description: doc.description,
    website: doc.website,
    slug: doc.slug,
    logoUrl,
    codeOfConduct: doc.codeOfConduct,
  };
}

export async function loadPublicDirectoryCommunities(ctx: {
  db: QueryCtx['db'];
  storage: QueryCtx['storage'];
}): Promise<PublicCommunity[]> {
  const optedIn = assertExplicitQueryLimit(
    await ctx.db
      .query('organizers')
      .withIndex('by_isPublicDirectory', (q) => q.eq('isPublicDirectory', true))
      .take(MAX_PUBLIC_DIRECTORY_OPTED_IN_COMMUNITIES + 1),
    MAX_PUBLIC_DIRECTORY_OPTED_IN_COMMUNITIES,
    'Public directory opted-in community scan',
  );

  const publishedEvents = assertExplicitQueryLimit(
    await ctx.db
      .query('events')
      .withIndex('by_status', (q) => q.eq('status', 'published'))
      .take(MAX_PUBLIC_DIRECTORY_PUBLISHED_EVENTS + 1),
    MAX_PUBLIC_DIRECTORY_PUBLISHED_EVENTS,
    'Public directory published event scan',
  );

  const publicOrganizerIds = new Set<Id<'organizers'>>(
    publishedEvents
      .filter((event) => isPubliclyVisible(event))
      .map((event) => event.organizerId),
  );

  const eligibleOptedIn = optedIn.filter((community) =>
    isEligibleForPublicDirectory(community),
  );
  const optedInIds = new Set(eligibleOptedIn.map((community) => community._id));
  const additionalIds = [...publicOrganizerIds].filter(
    (id) => !optedInIds.has(id),
  );

  const additional = (
    await Promise.all(additionalIds.map((id) => ctx.db.get('organizers', id)))
  ).filter(
    (community): community is NonNullable<typeof community> =>
      community !== null && isEligibleForPublicDirectory(community),
  );

  const communities = [...eligibleOptedIn, ...additional];
  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    communities.map((community) => community.logoStorageId),
  );

  return communities.map((community) =>
    toPublicCommunity(
      community,
      community.logoStorageId
        ? (logoUrlMap.get(community.logoStorageId) ?? undefined)
        : undefined,
    ),
  );
}

/**
 * Load the events directory: public directory communities merged with communities
 * visible to the authenticated user. Platform admins additionally see
 * admin-only communities that actually have published events.
 * Regular authenticated users additionally see non-draft communities they manage.
 */
export async function loadEventsDirectoryCommunities(
  ctx: {db: QueryCtx['db']; storage: QueryCtx['storage']},
  auth: {isAdmin: boolean; managedIds: Id<'organizers'>[]},
): Promise<PublicCommunity[]> {
  const publicCommunities = await loadPublicDirectoryCommunities(ctx);
  const existingIds = new Set(publicCommunities.map((c) => c._id));

  let additionalDocs: Doc<'organizers'>[];

  if (auth.isAdmin) {
    // Platform admins can see organizer-scoped communities outside the public
    // directory, but only if those communities have published events to show.
    const all = assertExplicitQueryLimit(
      await ctx.db
        .query('organizers')
        .take(MAX_EVENTS_DIRECTORY_ALL_COMMUNITIES + 1),
      MAX_EVENTS_DIRECTORY_ALL_COMMUNITIES,
      'Events directory admin community scan',
    );
    const unpublishedIds = all
      .filter((community) => !existingIds.has(community._id))
      .map(async (community) =>
        (await hasAnyPublishedEvent(ctx.db, community._id)) ? community : null,
      );
    additionalDocs = (await Promise.all(unpublishedIds)).filter(
      (community): community is NonNullable<typeof community> =>
        community !== null,
    );
  } else {
    const managed = await Promise.all(
      auth.managedIds.map((id) => ctx.db.get('organizers', id)),
    );
    additionalDocs = managed.filter(
      (c): c is NonNullable<typeof c> =>
        c !== null &&
        !existingIds.has(c._id) &&
        isEligibleForPublicDirectory(c),
    );
  }

  if (additionalDocs.length === 0) return publicCommunities;

  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    additionalDocs.map((c) => c.logoStorageId),
  );

  const mapped = additionalDocs.map((c) =>
    toPublicCommunity(
      c,
      c.logoStorageId
        ? (logoUrlMap.get(c.logoStorageId) ?? undefined)
        : undefined,
    ),
  );

  return [...publicCommunities, ...mapped];
}

export async function loadPublicCommunityBySlug(
  ctx: {db: QueryCtx['db']; storage: QueryCtx['storage']},
  slug: string,
): Promise<PublicCommunity | null> {
  const doc = await ctx.db
    .query('organizers')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();

  if (!doc || !isEligibleForPublicDirectory(doc)) return null;
  if (
    doc.isPublicDirectory !== true &&
    !(await hasPublicPublishedEvent(ctx.db, doc._id))
  ) {
    return null;
  }

  return toPublicCommunity(
    doc,
    await resolveCommunityLogoUrl(ctx, doc.logoStorageId),
  );
}
