import {paginationOptsValidator} from 'convex/server';
import {v} from 'convex/values';
import {internalMutation} from '../../_generated/server';
import {
  propagateMembershipChangeToTrustingOrganizers,
  runOrganizerDirectoryRebuild,
} from '../../lib/users/organizer_directory';

export const propagateMembershipChangeToTrustingOrganizersInternal =
  internalMutation({
    args: {
      organizerId: v.id('organizers'),
      userId: v.id('users'),
      paginationOpts: v.optional(paginationOptsValidator),
    },
    returns: v.object({
      processedOrganizers: v.number(),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
    handler: async (ctx, args) => {
      return await propagateMembershipChangeToTrustingOrganizers(ctx, args);
    },
  });

export const runOrganizerDirectoryRebuildInternal = internalMutation({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.object({
    processedUsers: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
    restarted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await runOrganizerDirectoryRebuild(ctx, args.organizerId);
  },
});
