/**
 * Inline-image storage-id helpers for rich email bodies.
 *
 * Image nodes in a validated rich body reference an uploaded file by its Convex
 * storage id (never a client URL). These helpers:
 *
 *  - collect the referenced storage ids from a validated document,
 *  - verify (ctx-aware) that every referenced id is one of OUR confirmed uploads
 *    (the security gate that blocks arbitrary remote hosts and forged ids), and
 *  - build the durable, server-owned image URLs the renderer injects as `src`.
 *
 * The collection step is pure (no ctx); the confirmation check is the separate
 * ctx step the security spine (`rich_text_validator.ts`) deliberately keeps out
 * of the structural validator.
 */
import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import type {RichBodyDoc, RichTextNode} from './rich_text_validator';

/**
 * Collects every image-node `storageId` (in document order, may contain
 * duplicates) from a validated rich body document.
 */
export function collectImageStorageIds(doc: RichBodyDoc): string[] {
  const ids: string[] = [];
  const visit = (node: RichTextNode): void => {
    if (node.type === 'image') {
      const storageId = node.attrs?.['storageId'];
      if (typeof storageId === 'string') {
        ids.push(storageId);
      }
    }
    for (const child of node.content ?? []) {
      visit(child);
    }
  };
  visit(doc);
  return ids;
}

/**
 * Returns true only when EVERY supplied storage id resolves to a real
 * `_storage` id AND has a matching `confirmedUploads` record (i.e. it passed
 * magic-byte validation on upload). Any id that is malformed, unknown, or
 * unconfirmed fails the whole check — fail closed.
 *
 * This is the ctx-aware security gate: a client can forge `bodyJson`, but it
 * cannot forge a confirmed upload OWNED BY THE SENDER. Ownership matters — a
 * bare "is it confirmed by anyone" check would let an event admin republish
 * another user's confirmed upload (whose opaque id they somehow learned)
 * through the unauthenticated `/api/images` route. The compose flow always
 * uploads + sends as the same user, so requiring sender ownership never
 * rejects a legitimate send.
 */
export async function areAllImagesConfirmed(
  ctx: QueryCtx,
  uploaderUserId: Id<'users'>,
  storageIds: readonly string[],
): Promise<boolean> {
  // Bounded fan-out: unique ids are capped (~360 worst case) by the bodyJson
  // byte cap; each check is an indexed point read, run concurrently.
  const checks = [...new Set(storageIds)].map(async (raw) => {
    // A malformed id string can make the index comparison throw; treat any
    // throw as "not confirmed" so a forged id fails closed rather than 500s.
    try {
      const confirmed = await ctx.db
        .query('confirmedUploads')
        .withIndex('by_storageId_and_uploaderUserId', (q) =>
          q
            .eq('storageId', raw as Id<'_storage'>)
            .eq('uploaderUserId', uploaderUserId),
        )
        .first();
      return confirmed !== null;
    } catch {
      return false;
    }
  });
  return (await Promise.all(checks)).every(Boolean);
}

/**
 * Records the given image storage ids as PUBLISHED in a sent rich email.
 * Called inside the send mutation (same transaction as the send bookkeeping and
 * email enqueue), so the public `/api/images/{storageId}` route — which serves
 * ONLY registered images — can never race a delivered email. Idempotent: an
 * image published by an earlier send keeps its original `firstPublishedAt` row.
 */
export async function recordPublishedEmailImages(
  ctx: MutationCtx,
  storageIds: readonly string[],
): Promise<void> {
  // Bounded fan-out (see areAllImagesConfirmed); the Set dedupe also makes the
  // concurrent existence-check-then-insert safe within this transaction.
  await Promise.all(
    [...new Set(storageIds)].map(async (raw) => {
      const storageId = raw as Id<'_storage'>;
      const existing = await ctx.db
        .query('richEmailImages')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (existing === null) {
        await ctx.db.insert('richEmailImages', {
          storageId,
          firstPublishedAt: Date.now(),
        });
      }
    }),
  );
}

/**
 * Builds a `storageId -> durable image URL` map for the renderer. The URL is
 * the public, server-owned image route on the Convex site domain
 * (`{apiSiteBase}/api/images/{storageId}`); it is NOT signed and does not
 * expire, so sent emails keep their images indefinitely.
 */
export function buildImageUrlMap(
  storageIds: readonly string[],
  apiSiteBase: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const storageId of storageIds) {
    map.set(
      storageId,
      `${apiSiteBase}/api/images/${encodeURIComponent(storageId)}`,
    );
  }
  return map;
}
