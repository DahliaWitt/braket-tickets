/**
 * Upload validation and lifecycle helpers.
 * Kept in lib/ to avoid circular imports (storage/files.ts ↔ _generated/api ↔ events.ts).
 */
import type {MutationCtx} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {throwAppError} from './errors';
import {logger} from './logger';
import {findPublishedEmailImage} from './email/rich_text_images';

/**
 * Verifies that a storageId was validated by confirmUpload.
 * @throws ConvexError if the storageId was never confirmed
 */
export async function assertUploadConfirmed(
  db: MutationCtx['db'],
  storageId: string,
  fieldName: string,
  uploaderUserId: Id<'users'>,
): Promise<void> {
  // Storage IDs currently flow through event arguments as strings.
  // Narrow here at the boundary used for confirmedUploads index lookup.
  const typedStorageId = storageId as Id<'_storage'>;

  const confirmed = await db
    .query('confirmedUploads')
    .withIndex('by_storageId_and_uploaderUserId', (q) =>
      q.eq('storageId', typedStorageId).eq('uploaderUserId', uploaderUserId),
    )
    .first();
  if (!confirmed) {
    throwAppError(
      'UPLOAD_NOT_CONFIRMED',
      `${fieldName}: file was not validated by the current user. Upload and confirm it again.`,
      {fieldName},
    );
  }
}

/**
 * Narrows a string that may be a Convex storage ID or a legacy external URL
 * into a typed Id<'_storage'>, returning null for URLs. The events.poster
 * field is `v.optional(v.string())` and historically held both.
 */
export function asStorageId(value: string): Id<'_storage'> | null {
  return value.includes('://') ? null : (value as Id<'_storage'>);
}

/**
 * Deletes a stored file and its confirmedUploads record when an entity's
 * file reference is replaced or removed. Best-effort: logs and continues
 * if either operation fails (file may already be gone).
 *
 * PINNED EXCEPTION: files published in a sent rich email (`richEmailImages`)
 * are never deleted here. Sent emails embed durable `/api/images/{storageId}`
 * URLs, so replacing an entity asset that was also emailed must not
 * retroactively break delivered emails. Published-image lifecycle is owned by
 * the email-image GC, never by entity cleanup.
 */
export async function cleanupReplacedUpload(
  ctx: MutationCtx,
  oldStorageId: Id<'_storage'>,
): Promise<void> {
  try {
    const published = await findPublishedEmailImage(ctx, oldStorageId);
    if (published !== null) {
      logger.info(
        'storage',
        'Skipping cleanup of an email-published image (pinned by sent emails)',
        {storageId: oldStorageId},
      );
      return;
    }
  } catch (e) {
    // Fail toward leaking a file, never toward breaking a sent email.
    logger.warn(
      'storage',
      'Failed to check email-image pin during cleanup; skipping deletion',
      {storageId: oldStorageId, error: e},
    );
    return;
  }

  try {
    const confirmed = await ctx.db
      .query('confirmedUploads')
      .withIndex('by_storageId', (q) => q.eq('storageId', oldStorageId))
      .first();
    if (confirmed) {
      await ctx.db.delete('confirmedUploads', confirmed._id);
    }
  } catch (e) {
    logger.warn(
      'storage',
      'Failed to delete confirmedUploads record during cleanup',
      {storageId: oldStorageId, error: e},
    );
  }

  try {
    await ctx.storage.delete(oldStorageId);
  } catch (e) {
    logger.warn('storage', 'Failed to delete stored file during cleanup', {
      storageId: oldStorageId,
      error: e,
    });
  }
}
