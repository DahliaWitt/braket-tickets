import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {components} from './_generated/api';

export const registerCleanupCrons = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(
      components.authz.cronSetup.ensureCleanupCronRegistered,
      {},
    );
    return null;
  },
});
