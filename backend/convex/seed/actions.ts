'use node';

import {v} from 'convex/values';
import {action} from '../_generated/server';
import {requireSeedAuthorization} from '../lib/environment';
import {clearBetterAuthSeedUsers} from '../testing/utilities';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/actions.ts.
import {
  seedUserAndGetTokensArgsValidator,
  seedUserAndGetTokensImpl,
} from '../testing/users_node';
import {seedUserAndGetTokensResultValidator} from '../testing/wrappers';

const seedTokenArgs = {
  seedToken: v.string(),
};

export const clearBetterAuthUsers = action({
  args: {
    ...seedTokenArgs,
    emails: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, {seedToken, emails}) => {
    requireSeedAuthorization(seedToken);
    return await clearBetterAuthSeedUsers(ctx, {emails});
  },
});

export const seedUserAndGetTokens = action({
  args: {
    ...seedTokenArgs,
    ...seedUserAndGetTokensArgsValidator,
  },
  returns: seedUserAndGetTokensResultValidator,
  handler: async (ctx, {seedToken, ...args}) => {
    requireSeedAuthorization(seedToken);
    return await seedUserAndGetTokensImpl(ctx, args);
  },
});
