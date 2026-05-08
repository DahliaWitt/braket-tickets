import {v} from 'convex/values';
import {query} from '../_generated/server';
import {communityViewerDocValidator} from '../lib/communities/validators';
import {getCommunity, getCommunityBySlugOrId} from './_impl/public';

export const get = query({
  args: {id: v.id('organizers')},
  returns: v.union(communityViewerDocValidator, v.null()),
  handler: async (ctx, args) => getCommunity(ctx, args),
});

export const getBySlugOrId = query({
  args: {slugOrId: v.string()},
  returns: v.union(communityViewerDocValidator, v.null()),
  handler: async (ctx, args) => getCommunityBySlugOrId(ctx, args),
});
