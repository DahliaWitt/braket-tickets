import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {communityUserRowValidator} from '../lib/users/validators';
import {
  grantCommunityAdmin,
  isCommunityMemberOf,
  listCommunityAdmins,
  listMyCommunityIds,
  revokeCommunityAdmin,
} from './_impl/admins';

export const grant = mutation({
  args: {userId: v.id('users'), organizerId: v.optional(v.id('organizers'))},
  returns: v.null(),
  handler: async (ctx, args) => grantCommunityAdmin(ctx, args),
});

export const revoke = mutation({
  args: {userId: v.id('users'), organizerId: v.optional(v.id('organizers'))},
  returns: v.null(),
  handler: async (ctx, args) => revokeCommunityAdmin(ctx, args),
});

export const listByCommunity = query({
  args: {organizerId: v.id('organizers')},
  returns: v.array(communityUserRowValidator),
  handler: async (ctx, args) => listCommunityAdmins(ctx, args),
});

export const listMyCommunities = query({
  args: {},
  returns: v.array(v.id('organizers')),
  handler: async (ctx) => listMyCommunityIds(ctx),
});

export const isMemberOf = query({
  args: {organizerId: v.id('organizers')},
  returns: v.boolean(),
  handler: async (ctx, args) => isCommunityMemberOf(ctx, args),
});
