import type {QueryCtx} from '../../_generated/server';
import type {Id} from '../../_generated/dataModel';
import {requireUser} from '../../lib/auth_identity';
import {canViewCommunity, isPlatformAdmin} from '../../lib/access';
import {isPublishedCommunity} from '../../lib/community_status';
import {applicationsByUserQuery} from '../../lib/applications/loaders';
import {mapCommunitiesWithLogoUrls} from '../../lib/communities/read_models';

export async function listCommunities(
  ctx: QueryCtx,
): Promise<Awaited<ReturnType<typeof mapCommunitiesWithLogoUrls>>> {
  const {_id: userId} = await requireUser(ctx);

  // TODO(BRA-410): Cursor-paginate this list API; avoid all-results reads in queries.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results API until pagination is added.
  const docs = await ctx.db.query('organizers').collect();
  if (await isPlatformAdmin(ctx, userId)) {
    return mapCommunitiesWithLogoUrls(ctx, docs);
  }

  const visibleDocs: typeof docs = [];
  const visibleIds = new Set<Id<'organizers'>>();
  for (const doc of docs) {
    if (!(await canViewCommunity(ctx, userId, doc))) {
      continue;
    }
    visibleDocs.push(doc);
    visibleIds.add(doc._id);
  }

  // Directory surfaces any community the user has active interaction with:
  // include communities where the user has a non-revoked application and the
  // community is published, even if it is not public or not yet a member.
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Temporary all-results read until pagination is added (BRA-410).
  const applications = await applicationsByUserQuery(ctx.db, userId).collect();
  const extraOrgIds = [
    ...new Set(
      applications
        .filter(
          (app) =>
            app.organizerId &&
            app.status !== 'revoked' &&
            !visibleIds.has(app.organizerId),
        )
        .map((app) => app.organizerId!),
    ),
  ];
  const extraDocs = await Promise.all(
    extraOrgIds.map((id) => ctx.db.get('organizers', id)),
  );
  for (const doc of extraDocs) {
    if (doc && isPublishedCommunity(doc) && !visibleIds.has(doc._id)) {
      visibleDocs.push(doc);
      visibleIds.add(doc._id);
    }
  }

  return mapCommunitiesWithLogoUrls(ctx, visibleDocs);
}
