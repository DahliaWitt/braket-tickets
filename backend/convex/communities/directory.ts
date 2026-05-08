import {v} from 'convex/values';
import {publicCommunityValidator} from '@shared/contracts/public-community';
import {internalQuery, query} from '../_generated/server';
import {getAuthUserId} from '../lib/auth_identity';
import {isPlatformAdmin} from '../lib/access';
import {getUserCommunities} from '../lib/authz';
import {
  loadEventsDirectoryCommunities,
  loadPublicCommunityBySlug,
  loadPublicDirectoryCommunities,
} from './directory/_impl/projection';

/**
 * Events directory: public communities + communities visible to the authenticated user.
 * Works for both authenticated and unauthenticated callers.
 */
export const listEventsDirectory = query({
  args: {},
  returns: v.array(publicCommunityValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return loadPublicDirectoryCommunities(ctx);

    const isAdmin = await isPlatformAdmin(ctx, userId);
    const managedIds = isAdmin ? [] : await getUserCommunities(ctx, userId);

    return loadEventsDirectoryCommunities(ctx, {isAdmin, managedIds});
  },
});

/**
 * Public community reads must stay behind the HTTP layer so the app consistently
 * applies cache headers and IP-based rate limiting.
 */
export const listPublicDirectoryInternal = internalQuery({
  args: {},
  returns: v.array(publicCommunityValidator),
  handler: async (ctx) => loadPublicDirectoryCommunities(ctx),
});

export const getBySlugInternal = internalQuery({
  args: {slug: v.string()},
  returns: v.union(publicCommunityValidator, v.null()),
  handler: async (ctx, args) => loadPublicCommunityBySlug(ctx, args.slug),
});
