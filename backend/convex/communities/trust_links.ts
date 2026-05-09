import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {
  createTrustLinkHandler,
  getUserApprovalsHandler,
  listTrustLinksHandler,
  removeTrustLinkHandler,
  checkUserTrustHandler,
} from './_impl/trust_links';

const trustLinkDirectionValidator = v.union(
  v.literal('outgoing'),
  v.literal('incoming'),
);

const trustLinkRowValidator = v.object({
  direction: trustLinkDirectionValidator,
  trustingOrganizerId: v.id('organizers'),
  trustedOrganizerId: v.id('organizers'),
  trustingOrganizerName: v.string(),
  trustedOrganizerName: v.string(),
  trustedMemberCount: v.optional(v.number()),
});

const trustResolutionValidator = v.object({
  trusted: v.boolean(),
  source: v.union(v.literal('direct'), v.literal('shared'), v.null()),
  via: v.union(v.object({_id: v.id('organizers'), name: v.string()}), v.null()),
});

const userApprovalValidator = v.object({
  organizerId: v.id('organizers'),
  organizerName: v.string(),
  organizerLogoUrl: v.optional(v.string()),
  source: v.union(v.literal('direct'), v.literal('shared')),
  viaOrganizerId: v.optional(v.id('organizers')),
  viaOrganizerName: v.optional(v.string()),
});

export const create = mutation({
  args: {
    trustingOrganizerId: v.id('organizers'),
    trustedOrganizerId: v.id('organizers'),
  },
  returns: v.null(),
  handler: createTrustLinkHandler,
});

export const remove = mutation({
  args: {
    trustingOrganizerId: v.id('organizers'),
    trustedOrganizerId: v.id('organizers'),
  },
  returns: v.null(),
  handler: removeTrustLinkHandler,
});

export const list = query({
  args: {
    organizerId: v.id('organizers'),
    direction: v.optional(trustLinkDirectionValidator),
  },
  returns: v.array(trustLinkRowValidator),
  handler: listTrustLinksHandler,
});

export const checkUserTrust = query({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: trustResolutionValidator,
  handler: checkUserTrustHandler,
});

export const getUserApprovals = query({
  args: {},
  returns: v.array(userApprovalValidator),
  handler: getUserApprovalsHandler,
});
