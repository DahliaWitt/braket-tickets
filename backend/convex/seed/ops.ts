import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {requireSeedAuthorization} from '../lib/environment';
import {
  clearAllSeedData,
  generateSeedStorageUploadUrl,
  seedExists,
} from '../testing/utilities';
import {insertSeedDemoData, seedDemoDataArgsValidator} from '../testing/demo';
import {seedDemoDataValidator} from '../testing/wrappers';
import {
  seedSandboxPurchaseFixtureArgsValidator,
  seedSandboxPurchaseFixtureImpl,
  seedSandboxPurchaseFixtureResultValidator,
} from '../testing/orders';

const seedTokenArgs = {
  seedToken: v.string(),
};

export const checkSeedExists = query({
  args: seedTokenArgs,
  returns: v.boolean(),
  handler: async (ctx, {seedToken}) => {
    requireSeedAuthorization(seedToken);
    return await seedExists(ctx);
  },
});

export const generateUploadUrl = mutation({
  args: seedTokenArgs,
  returns: v.string(),
  handler: async (ctx, {seedToken}) => {
    requireSeedAuthorization(seedToken);
    return await generateSeedStorageUploadUrl(ctx);
  },
});

export const clearAll = mutation({
  args: {
    ...seedTokenArgs,
    keepUsers: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, {seedToken, keepUsers}) => {
    requireSeedAuthorization(seedToken);
    return await clearAllSeedData(ctx, {keepUsers});
  },
});

export const seedDemoData = mutation({
  args: {
    ...seedTokenArgs,
    ...seedDemoDataArgsValidator,
  },
  returns: seedDemoDataValidator,
  handler: async (ctx, {seedToken, ...args}) => {
    requireSeedAuthorization(seedToken);
    return await insertSeedDemoData(ctx, args);
  },
});

export const seedSandboxPurchaseFixture = mutation({
  args: {
    ...seedTokenArgs,
    ...seedSandboxPurchaseFixtureArgsValidator,
  },
  returns: seedSandboxPurchaseFixtureResultValidator,
  handler: async (ctx, {seedToken, ...args}) => {
    requireSeedAuthorization(seedToken);
    return await seedSandboxPurchaseFixtureImpl(ctx, args);
  },
});
