import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {
  magicLinkStatusValidator,
  magicLinkValidationErrorValidator,
} from '../lib/validators/magic_links';
import {
  createMagicLinkHandler,
  listMyLinksHandler,
  listPastMyLinksHandler,
  redeemMagicLinkHandler,
  updateMagicLinkStatusHandler,
  validateTokenHandler,
} from './_impl/invite_links';

export const validateToken = query({
  args: {
    token: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.object({
    valid: v.boolean(),
    error: v.optional(magicLinkValidationErrorValidator),
    communityName: v.optional(v.string()),
  }),
  handler: validateTokenHandler,
});

export const create = mutation({
  args: {
    organizerId: v.id('organizers'),
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    maxRedemptions: v.optional(v.number()),
  },
  returns: v.object({
    linkId: v.id('magic_links'),
    token: v.string(),
    url: v.string(),
  }),
  handler: createMagicLinkHandler,
});

export const redeem = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    alreadyRedeemed: v.boolean(),
    alreadyMember: v.boolean(),
    message: v.string(),
  }),
  handler: redeemMagicLinkHandler,
});

export const updateStatus = mutation({
  args: {
    linkId: v.id('magic_links'),
    action: v.union(
      v.literal('pause'),
      v.literal('resume'),
      v.literal('disable'),
      v.literal('delete'),
    ),
  },
  returns: v.object({success: v.boolean()}),
  handler: updateMagicLinkStatusHandler,
});

// TODO: Rename listMyLinks/listPastMyLinks to community-scoped names.
// These queries now return links for the selected community, not just the caller.
export const listMyLinks = query({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.array(
    v.object({
      _id: v.id('magic_links'),
      _creationTime: v.number(),
      tokenPrefix: v.optional(v.string()),
      label: v.optional(v.string()),
      status: magicLinkStatusValidator,
      expiresAt: v.optional(v.number()),
      maxRedemptions: v.optional(v.number()),
      redemptionCount: v.number(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: listMyLinksHandler,
});

export const listPastMyLinks = query({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.array(
    v.object({
      _id: v.id('magic_links'),
      _creationTime: v.number(),
      tokenPrefix: v.optional(v.string()),
      label: v.optional(v.string()),
      status: magicLinkStatusValidator,
      expiresAt: v.optional(v.number()),
      maxRedemptions: v.optional(v.number()),
      redemptionCount: v.number(),
      lastUsedAt: v.optional(v.number()),
      deletedAt: v.number(),
    }),
  ),
  handler: listPastMyLinksHandler,
});
