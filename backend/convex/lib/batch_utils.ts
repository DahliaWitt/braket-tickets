/**
 * Batch utilities for efficient document fetching in Convex.
 *
 * Convex optimizes multiple db.get() calls within a single transaction,
 * so Promise.all with multiple reads is the idiomatic approach for
 * batch fetching documents by ID.
 */

import type { Doc, Id, TableNames } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * Batch fetches documents by their IDs, returning a Map for O(1) lookup.
 *
 * This is the standard pattern for efficiently fetching multiple documents
 * by ID in Convex. All reads are parallelized within the same transaction.
 *
 * @param ctx - The query context (provides ctx.db)
 * @param table - The table name to fetch from
 * @param ids - Array or Set of document IDs to fetch
 * @returns Map from document ID to document (excludes null results)
 *
 * @example
 * ```ts
 * const userIds = payments.map(p => p.userId);
 * const userMap = await batchGetDocuments(ctx, 'users', userIds);
 * const user = userMap.get(payment.userId);
 * ```
 */
export async function batchGetDocuments<T extends TableNames>(
  ctx: { db: QueryCtx['db'] },
  table: T,
  ids: Iterable<Id<T>>,
): Promise<Map<Id<T>, Doc<T>>> {
  const uniqueIds = [...new Set(ids)];
  const documents = await Promise.all(
    uniqueIds.map((id) => ctx.db.get(table, id)),
  );

  const docMap = new Map<Id<T>, Doc<T>>();
  for (let i = 0; i < uniqueIds.length; i++) {
    const doc = documents[i];
    if (doc) {
      docMap.set(uniqueIds[i], doc);
    }
  }
  return docMap;
}

/**
 * Batch fetches users by their IDs.
 * Convenience wrapper around batchGetDocuments for the common user lookup case.
 *
 * @param ctx - The query context (provides ctx.db)
 * @param userIds - Array or Set of user IDs to fetch
 * @returns Map from user ID to user document
 */
export async function batchGetUsers(
  ctx: { db: QueryCtx['db'] },
  userIds: Iterable<Id<'users'>>,
): Promise<Map<Id<'users'>, Doc<'users'>>> {
  return batchGetDocuments(ctx, 'users', userIds);
}
