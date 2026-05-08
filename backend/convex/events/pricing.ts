import {v} from 'convex/values';

import {query} from '../_generated/server';
import {getEventTierPricingStats as loadEventTierPricingStats} from './_impl/pricing';
import {tierValidator} from '../lib/validators/ticketing';

export const getEventTierPricingStats = query({
  args: {
    eventId: v.id('events'),
  },
  returns: v.object({
    tiers: v.array(
      v.object({
        tier: tierValidator,
        count: v.number(),
        min: v.number(),
        max: v.number(),
        mean: v.number(),
        median: v.number(),
        mode: v.array(v.number()),
      }),
    ),
  }),
  handler: async (ctx, args) => await loadEventTierPricingStats(ctx, args),
});
