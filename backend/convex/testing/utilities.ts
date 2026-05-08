import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import {adapterDeleteOne} from '../lib/better_auth_adapter';
import {collectAllQueryUnsafe} from '../lib/query_scan';
import {rateLimiter} from '../lib/rate_limits';
import schema from '../schema';
import {testingAction, testingMutation, testingQuery} from './wrappers';
import type {ActionCtx, MutationCtx, QueryCtx} from '../_generated/server';

/**
 * Clears all data from all tables, cancels scheduled functions, and deletes storage.
 * This is used to reset the database between tests.
 */
export async function clearAllSeedData(
  {db, scheduler, storage}: MutationCtx,
  {keepUsers}: {keepUsers?: boolean},
): Promise<null> {
  // Note: With Better Auth, auth tables are in the component namespace
  // We cannot directly clear component tables, so tests should use unique emails
  // or restart the local backend to get a fresh state
  const userTables = new Set(['users']);

  const clearTable = async <T extends keyof typeof schema.tables>(table: T) => {
    const docs = await collectAllQueryUnsafe(db.query(table));
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test cleanup: must delete all records directly */
    await Promise.all(docs.map((doc) => db.delete(table, doc._id as Id<T>)));
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  };

  const isSchemaTable = (table: string): table is keyof typeof schema.tables =>
    Object.prototype.hasOwnProperty.call(schema.tables, table);

  await Promise.all(
    Object.keys(schema.tables).map(async (table) => {
      if (!isSchemaTable(table)) return;
      if (keepUsers && userTables.has(table)) {
        return;
      }
      await clearTable(table);
    }),
  );
  const scheduled = await collectAllQueryUnsafe(
    db.system.query('_scheduled_functions'),
  );
  await Promise.all(scheduled.map((s) => scheduler.cancel(s._id)));
  const storedFiles = await collectAllQueryUnsafe(db.system.query('_storage'));
  await Promise.all(storedFiles.map((s) => storage.delete(s._id)));

  return null;
}

export async function clearBetterAuthSeedUsers(
  ctx: ActionCtx,
  {emails}: {emails: string[]},
): Promise<null> {
  await Promise.allSettled(
    emails.map((email) =>
      adapterDeleteOne(ctx, {
        model: 'user',
        where: [{field: 'email', value: email}],
      }),
    ),
  );
  return null;
}

export async function seedExists({db}: QueryCtx): Promise<boolean> {
  const sentinel = await db
    .query('organizers')
    .withIndex('by_slug', (q) => q.eq('slug', 'anfangszeit'))
    .first();
  return sentinel !== null;
}

export async function generateSeedStorageUploadUrl(
  ctx: MutationCtx,
): Promise<string> {
  return await ctx.storage.generateUploadUrl();
}

export const clearAll = testingMutation({
  args: {
    keepUsers: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: clearAllSeedData,
});

/**
 * Clears all Better Auth component users. Component tables are isolated
 * and cannot be cleared by clearAll (which only touches app tables).
 * Must be an action because component adapter calls require action context.
 */
export const clearBetterAuthUsers = testingAction({
  args: {
    emails: v.array(v.string()),
  },
  returns: v.null(),
  handler: clearBetterAuthSeedUsers,
});

export const resetRateLimit = testingMutation({
  args: {
    name: v.union(
      v.literal('requestEmailChange'),
      v.literal('cancelEmailChange'),
    ),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimiter.reset(ctx, args.name, {key: args.key});
    return null;
  },
});

export const checkSeedExists = testingQuery({
  args: {},
  returns: v.boolean(),
  handler: seedExists,
});

export const generateSeedUploadUrl = testingMutation({
  args: {},
  returns: v.string(),
  handler: generateSeedStorageUploadUrl,
});
