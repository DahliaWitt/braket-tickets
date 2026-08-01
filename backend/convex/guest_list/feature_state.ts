import {v} from 'convex/values';
import {query} from '../_generated/server';

export const get = query({
  args: {},
  returns: v.object({enabled: v.boolean()}),
  handler: async (ctx) => {
    const state = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    return {enabled: state?.enabledAt !== undefined};
  },
});
