import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {eventWithPosterUrlValidator} from '../lib/events/validators';
import {
  grantCommunityScanner,
  hasAnyAssignment as hasAnyScannerAssignment,
  listCommunityScanners,
  listMyScannerEvents,
  revokeCommunityScanner,
} from './_impl/scanners';

export const grant = mutation({
  args: {userId: v.id('users'), organizerId: v.id('organizers')},
  returns: v.null(),
  handler: async (ctx, args) => grantCommunityScanner(ctx, args),
});

export const revoke = mutation({
  args: {userId: v.id('users'), organizerId: v.id('organizers')},
  returns: v.null(),
  handler: async (ctx, args) => revokeCommunityScanner(ctx, args),
});

export const listByCommunity = query({
  args: {organizerId: v.id('organizers')},
  returns: v.array(
    v.object({
      _id: v.id('users'),
      userId: v.id('users'),
      organizerId: v.id('organizers'),
      displayName: v.string(),
      email: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => listCommunityScanners(ctx, args),
});

export const hasAnyAssignment = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => hasAnyScannerAssignment(ctx),
});

export const myScannerEvents = query({
  args: {},
  returns: v.array(eventWithPosterUrlValidator),
  handler: async (ctx) => listMyScannerEvents(ctx),
});
