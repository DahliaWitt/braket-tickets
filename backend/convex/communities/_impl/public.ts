import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {requireUser} from '../../lib/auth_identity';
import {canViewCommunity, canViewCommunityForVetting} from '../../lib/access';
import {logger} from '../../lib/logger';
import {
  mapCommunitiesWithLogoUrls,
  resolveCommunityLogoUrl,
} from '../../lib/communities/read_models';

export async function getCommunity(
  ctx: QueryCtx,
  args: {id: Id<'organizers'>},
): Promise<
  Awaited<ReturnType<typeof mapCommunitiesWithLogoUrls>>[number] | null
> {
  const {_id: userId} = await requireUser(ctx);

  const organizer = await ctx.db.get('organizers', args.id);
  if (!organizer) return null;

  if (!(await canViewCommunity(ctx, userId, organizer))) {
    return null;
  }

  const [communityWithLogoUrl] = await mapCommunitiesWithLogoUrls(ctx, [
    organizer,
  ]);
  return communityWithLogoUrl ?? null;
}

export async function getCommunityBySlugOrId(
  ctx: QueryCtx,
  args: {slugOrId: string},
) {
  const {_id: userId} = await requireUser(ctx);

  let organizer = await ctx.db
    .query('organizers')
    .withIndex('by_slug', (q) => q.eq('slug', args.slugOrId))
    .first();

  if (!organizer) {
    try {
      organizer = await ctx.db.get(
        'organizers',
        args.slugOrId as Id<'organizers'>,
      );
    } catch (error: unknown) {
      logger.warn(
        'communities',
        'slugOrId is not a valid document ID, treating as not found',
        {
          slugOrId: args.slugOrId,
          error,
        },
      );
      return null;
    }
  }

  if (!organizer) return null;

  if (await canViewCommunity(ctx, userId, organizer)) {
    const [communityWithLogoUrl] = await mapCommunitiesWithLogoUrls(ctx, [
      organizer,
    ]);
    return communityWithLogoUrl ?? null;
  }

  if (!(await canViewCommunityForVetting(ctx, userId, organizer))) {
    return null;
  }

  const logoUrl = await resolveCommunityLogoUrl(ctx, organizer.logoStorageId);
  return {
    _id: organizer._id,
    _creationTime: organizer._creationTime,
    name: organizer.name,
    isPublicDirectory: organizer.isPublicDirectory,
    slug: organizer.slug,
    status: organizer.status,
    vettingQuestions: organizer.vettingQuestions,
    codeOfConduct: organizer.codeOfConduct,
    ...(logoUrl ? {logoUrl} : {}),
  };
}
