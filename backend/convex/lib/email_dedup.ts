import {internalMutation} from '../_generated/server';
import type {MutationCtx} from '../_generated/server';
import {internal} from '../_generated/api';
import {v} from 'convex/values';

/**
 * Checks if an email fan-out with the given idempotency key has already been
 * processed. If not, inserts the key so subsequent calls (e.g. client retries
 * after a successful-but-unacknowledged mutation) are no-ops.
 *
 * Because Convex mutations are transactional, two concurrent mutations racing
 * on the same key will be serialised via OCC — only one will commit.
 *
 * Failure semantics: if the enclosing mutation throws after calling
 * `guardEmailDedup` but before Convex commits, the transaction rolls back and
 * the dedup row is never persisted. A subsequent retry therefore sees no row
 * and correctly re-runs the fan-out. The dedup row only survives when the
 * mutation commits, which means every committed fan-out is guarded exactly
 * once.
 *
 * @returns `true` if the key was already seen (caller should skip fan-out).
 */
export async function guardEmailDedup(
  ctx: MutationCtx,
  idempotencyKey: string,
): Promise<boolean> {
  const existing = await hasEmailDedup(ctx, idempotencyKey);
  if (existing) return true;

  await ctx.db.insert('emailDedup', {
    key: idempotencyKey,
    createdAt: Date.now(),
  });
  return false;
}

/**
 * Compensating delete for a dedup key inserted by `guardEmailDedup` earlier
 * in the SAME transaction. Use when the guarded fan-out fails after the
 * guard but the caller intends to swallow the error instead of aborting the
 * transaction: without this, the swallowed error would commit the key with
 * no email behind it, permanently burning the slot (guardEmailDedup's
 * rollback contract only heals when the whole transaction aborts).
 */
export async function releaseEmailDedup(
  ctx: MutationCtx,
  idempotencyKey: string,
): Promise<void> {
  const existing = await ctx.db
    .query('emailDedup')
    .withIndex('by_key', (q) => q.eq('key', idempotencyKey))
    .first();
  if (existing) {
    await ctx.db.delete('emailDedup', existing._id);
  }
}

export async function hasEmailDedup(
  ctx: Pick<MutationCtx, 'db'>,
  idempotencyKey: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('emailDedup')
    .withIndex('by_key', (q) => q.eq('key', idempotencyKey))
    .first();

  return existing !== null;
}

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_BATCH_SIZE = 200;

/**
 * Deletes emailDedup records older than 24 hours.
 * Processes in batches to stay within Convex transaction limits.
 */
export const cleanupStaleEmailDedup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    const stale = await ctx.db
      .query('emailDedup')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(CLEANUP_BATCH_SIZE);

    await Promise.all(
      stale.map((record) => ctx.db.delete('emailDedup', record._id)),
    );

    if (stale.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.email_dedup.cleanupStaleEmailDedup,
        {},
      );
    }

    return null;
  },
});
