import {v} from 'convex/values';
import {internalQuery, mutation, query} from '../_generated/server';
import {
  communityAdminDocValidator,
  organizerDocValidator,
  vettingQuestionValidator,
} from '../lib/communities/validators';
import {communityPublicationStatusValidator} from '../lib/validators/communities';
import {
  createCommunity,
  getAdminCommunity,
  removeCommunity,
  setPlatformOrganizer as setPlatformOrganizerImpl,
  updateCommunity,
} from './_impl/profile';

export const getAdmin = query({
  args: {id: v.id('organizers')},
  returns: v.union(communityAdminDocValidator, v.null()),
  handler: async (ctx, args) => getAdminCommunity(ctx, args),
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    contactInfo: v.optional(v.string()),
    vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
    status: communityPublicationStatusValidator,
    description: v.optional(v.string()),
    isPublicDirectory: v.optional(v.boolean()),
    slug: v.optional(v.string()),
    codeOfConduct: v.optional(v.string()),
  },
  returns: v.id('organizers'),
  handler: async (ctx, args) => createCommunity(ctx, args),
});

export const update = mutation({
  args: {
    id: v.id('organizers'),
    name: v.optional(v.string()),
    // `null` explicitly clears these optional fields (an omitted key means
    // "leave unchanged" and cannot express a clear across the wire).
    email: v.optional(v.union(v.string(), v.null())),
    contactInfo: v.optional(v.union(v.string(), v.null())),
    vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
    status: communityPublicationStatusValidator,
    description: v.optional(v.union(v.string(), v.null())),
    website: v.optional(v.union(v.string(), v.null())),
    isPublicDirectory: v.optional(v.boolean()),
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    // slug is intentionally NOT clearable: it is the community's public URL key
    // (organizers.by_slug drives public pages, the directory, and event
    // lookups) and create always assigns one. A blank slug is a no-op, not a
    // clear. Reassigning to a new slug is still supported.
    slug: v.optional(v.string()),
    codeOfConduct: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => updateCommunity(ctx, args),
});

export const remove = mutation({
  args: {id: v.id('organizers')},
  returns: v.null(),
  handler: async (ctx, args) => removeCommunity(ctx, args),
});

export const getInternal = internalQuery({
  args: {id: v.id('organizers')},
  returns: v.union(organizerDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get('organizers', args.id);
  },
});

export const setPlatformOrganizer = mutation({
  args: {
    organizerId: v.id('organizers'),
    isPlatformOrganizer: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => setPlatformOrganizerImpl(ctx, args),
});
