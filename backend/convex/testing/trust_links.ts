import {v} from 'convex/values';
import {testingMutation} from './wrappers';
import {addSeedTrustLink} from './communities';

/**
 * Seeds a vetting trust link directly into the database, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedTrustLink = testingMutation({
  args: {
    trustingOrganizerId: v.id('organizers'),
    trustedOrganizerId: v.id('organizers'),
    createdBy: v.id('users'),
    status: v.optional(
      v.union(v.literal('active'), v.literal('paused'), v.literal('revoked')),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.status && args.status !== 'active') {
      return null;
    }
    await addSeedTrustLink(
      ctx,
      args.trustingOrganizerId,
      args.trustedOrganizerId,
    );
    return null;
  },
});
