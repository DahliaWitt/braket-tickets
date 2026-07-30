import {v} from 'convex/values';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from '../_generated/server';
import {internal} from '../_generated/api';
import {getAuthUserId, requireUser} from '../lib/auth_identity';
import {getAppErrorMessage, throwUnauthenticated} from '../lib/errors';
import {rateLimiter} from '../lib/rate_limits';
import {findPublishedEmailImage} from '../lib/email/rich_text_images';

// Allowed MIME types for file uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const ALLOWED_FORMATS_LABEL = 'JPG, PNG, GIF, WEBP';

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPES.some(
    (allowedMimeType) => allowedMimeType === mimeType,
  );
}

// Maximum file size: 10MB
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const FILE_TOO_LARGE_ERROR = `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`;

// Number of header bytes to read for magic byte validation.
// 256 covers all supported types (PNG needs 8, WebP needs 12, SVG needs up to ~20 for leading whitespace).
export const MAGIC_BYTES_HEADER_SIZE = 256;

/** Returns true when every byte in `signature` matches the corresponding byte in `buf`. */
function matchesSignature(
  buf: Uint8Array,
  signature: readonly number[],
): boolean {
  if (buf.length < signature.length) return false;
  return signature.every((byte, i) => buf[i] === byte);
}

// Per-type magic byte signatures (null = use custom validator)
const MAGIC_SIGNATURES: Record<string, readonly number[][]> = {
  // JPEG: FF D8 FF
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // GIF87a: 47 49 46 38 37 61 or GIF89a: 47 49 46 38 39 61
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  // WebP: RIFF at 0-3, WEBP at 8-11 — non-contiguous, validated directly in checkMagicBytes
};

// WebP has a non-contiguous signature (RIFF at 0, WEBP at 8), checked separately.
const WEBP_RIFF: readonly number[] = [0x52, 0x49, 0x46, 0x46];
const WEBP_FOURCC: readonly number[] = [0x57, 0x45, 0x42, 0x50];

/**
 * Validate file content by checking magic bytes (file header signatures).
 *
 * Each image format has a unique byte sequence at the start of the file
 * that identifies its true type, regardless of what the client declares.
 *
 * Exported for unit testing.
 */
export function checkMagicBytes(
  bytes: Uint8Array,
  mimeType: string,
): {valid: boolean; error?: string} {
  if (bytes.length === 0) {
    return {valid: false, error: 'File content is empty'};
  }

  if (mimeType === 'image/webp') {
    const valid =
      bytes.length >= 12 &&
      matchesSignature(bytes, WEBP_RIFF) &&
      matchesSignature(bytes.subarray(8), WEBP_FOURCC);
    return valid
      ? {valid: true}
      : {valid: false, error: 'File magic bytes do not match image/webp'};
  }

  const signatures = MAGIC_SIGNATURES[mimeType];
  if (signatures === undefined) {
    return {
      valid: false,
      error: `Unsupported MIME type for validation: ${mimeType}`,
    };
  }

  const matched = signatures.some((sig) => matchesSignature(bytes, sig));
  return matched
    ? {valid: true}
    : {valid: false, error: `File magic bytes do not match ${mimeType}`};
}

/**
 * Generate a pre-signed upload URL for authenticated users.
 *
 * Security Notes:
 * - Only authenticated users can upload files
 * - Pre-upload metadata is validated via validateUpload (MIME type, size)
 * - REQUIRED: call confirmUpload(storageId, mimeType) after upload to
 *   validate the file content via magic bytes; discard storageId if it
 *   returns { valid: false }
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const {_id: userId} = await requireUser(ctx);
    await rateLimiter.limit(ctx, 'generateUpload', {key: userId, throws: true});
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Validate a file before upload (called from frontend)
 * Returns validation result without generating URL
 */
export const validateUpload = mutation({
  args: {
    fileName: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
  },
  returns: v.object({
    valid: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {valid: false, error: 'Unauthenticated'};
    }

    // Check file size
    if (args.fileSize > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: FILE_TOO_LARGE_ERROR,
      };
    }

    // Check MIME type
    if (!isAllowedMimeType(args.mimeType)) {
      return {
        valid: false,
        error: `Invalid file type. Accepted formats: ${ALLOWED_FORMATS_LABEL}.`,
      };
    }

    return {valid: true};
  },
});

/**
 * Internal mutation: delete a file from Convex storage.
 *
 * Called by confirmUpload when magic byte validation fails.
 * Prevents malicious files from persisting in storage.
 */
export const _deleteStoredFile = internalMutation({
  args: {
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
    return null;
  },
});

/**
 * Validate a file's content after it has been uploaded to Convex storage.
 *
 * Reads the first 256 bytes of the stored file and checks magic byte signatures
 * to verify the actual file type matches the declared MIME type.
 *
 * Security model:
 * - Client reports MIME type; we verify the file header independently.
 * - Mismatched or unknown files are deleted from storage immediately.
 * - Rate-limited to the same bucket as generateUploadUrl (10/min per user).
 *
 * Call this immediately after a successful file upload with the storageId
 * returned by the Convex upload endpoint. Discard the storageId if this
 * returns { valid: false }.
 */
export const confirmUpload = action({
  args: {
    storageId: v.id('_storage'),
    mimeType: v.string(),
  },
  returns: v.object({
    valid: v.boolean(),
    storageId: v.optional(v.id('_storage')),
    // SIGNED, short-lived storage URL for the confirmed file. PREVIEW ONLY —
    // used to display the image in the composer immediately after upload. It is
    // NOT persisted or emailed: signed URLs expire, so emails embed the durable
    // server-owned route (/api/images/{storageId}) instead, resolved at send
    // time from the storageId. Present only on the success path.
    url: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Auth: only authenticated users may confirm uploads.
    // Use the internal query so this works in both production (Better Auth session)
    // and test environments (convex-test withIdentity).
    const userId = await ctx.runQuery(
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
    if (!userId) {
      throwUnauthenticated();
    }

    // Rate limit: dedicated bucket for confirmUpload (separate from generateUpload)
    await rateLimiter.limit(ctx, 'confirmUpload', {key: userId, throws: true});

    // MIME type must be in the allow-list before reading storage
    if (!isAllowedMimeType(args.mimeType)) {
      return {
        valid: false,
        error: `Invalid file type. Accepted formats: ${ALLOWED_FORMATS_LABEL}.`,
      };
    }

    // Read file from storage
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      return {valid: false, error: 'File does not exist in storage'};
    }

    // Enforce size limit against the actual stored blob, not client-reported metadata.
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      try {
        await ctx.runMutation(internal.storage.files._deleteStoredFile, {
          storageId: args.storageId,
        });
      } catch {
        // File may have already been deleted
      }
      return {
        valid: false,
        error: FILE_TOO_LARGE_ERROR,
      };
    }

    // Read the full blob then view the header — blob.slice().arrayBuffer()
    // triggers RangeError in the Convex V8 isolate on certain file sizes.
    const buffer = await blob.arrayBuffer();
    const headerLength = Math.min(MAGIC_BYTES_HEADER_SIZE, buffer.byteLength);
    const bytes = new Uint8Array(buffer, 0, headerLength);

    // Validate magic bytes
    const validation = checkMagicBytes(bytes, args.mimeType);
    if (!validation.valid) {
      // Best-effort deletion — ignore errors if the file was already removed
      try {
        await ctx.runMutation(internal.storage.files._deleteStoredFile, {
          storageId: args.storageId,
        });
      } catch {
        // File may have already been deleted; the validation result stands
      }
      return {valid: false, error: validation.error};
    }

    // Record that this file passed magic-byte validation.
    // Mutations accepting storageIds (events.create, communities.update)
    // check this table to enforce the confirmUpload gate.
    try {
      await ctx.runMutation(internal.storage.files._markUploadConfirmed, {
        storageId: args.storageId,
        uploaderUserId: userId,
      });
    } catch (error) {
      return {
        valid: false,
        error: getAppErrorMessage(error) ?? 'File upload confirmation failed',
      };
    }

    // Resolve a SIGNED preview URL for the confirmed file so the composer can
    // display it immediately. This is preview-only: it is never persisted or
    // emailed (signed URLs expire). Emails embed the durable server-owned route
    // /api/images/{storageId} instead. Null coalesces to undefined to satisfy
    // the optional return validator.
    const url = (await ctx.storage.getUrl(args.storageId)) ?? undefined;

    return {valid: true, storageId: args.storageId, url};
  },
});

/**
 * Records a storageId as having passed magic-byte validation.
 * Called by confirmUpload after successful validation. Idempotent.
 */
export const _markUploadConfirmed = internalMutation({
  args: {
    storageId: v.id('_storage'),
    uploaderUserId: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('confirmedUploads')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      if (
        existing.uploaderUserId !== undefined &&
        existing.uploaderUserId !== args.uploaderUserId
      ) {
        throw new Error(
          'File upload is already confirmed for a different user.',
        );
      }
      if (existing.uploaderUserId === undefined) {
        throw new Error(
          'File upload confirmation is missing uploader ownership. Upload the file again.',
        );
      }
      return null;
    }

    await ctx.db.insert('confirmedUploads', {
      storageId: args.storageId,
      uploaderUserId: args.uploaderUserId,
      confirmedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Resolves a PUBLISHED EMAIL image for the public image route.
 *
 * The gate is `richEmailImages` membership ALONE. A registry row is only ever
 * written by a send handler AFTER the confirmed-upload + sender-ownership
 * checks passed, so membership proves the file was magic-byte validated at
 * send time. Deliberately NO live `confirmedUploads` requirement: sent emails
 * embed durable `/api/images` URLs, and upload-lifecycle cleanup (e.g. a
 * poster being replaced via `cleanupReplacedUpload`) must never retroactively
 * break an already-delivered email. Published blobs are likewise pinned
 * against deletion by that cleanup.
 *
 * Unpublished ids — event posters, community logos, abandoned composer drafts,
 * any future upload category — return null and 404 on the route.
 *
 * The content type is read from the `_storage` system metadata and clamped to
 * the image allowlist (see the clamp comment below).
 */
export const getPublishedEmailImage = internalQuery({
  args: {storageId: v.string()},
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.id('_storage'),
      contentType: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    // The published-image gate is centralized in `findPublishedEmailImage` so
    // this serve route, upload-cleanup pinning, and the send path can never
    // diverge on what counts as "published". A malformed id string can make the
    // index comparison throw; treat any throw as "not found" so a forged id
    // fails closed (404) rather than 500s.
    let published;
    try {
      published = await findPublishedEmailImage(ctx, args.storageId);
    } catch {
      return null;
    }
    if (published === null) {
      return null;
    }

    // published.storageId is a real stored id, so system.get is safe here.
    const metadata = await ctx.db.system.get('_storage', published.storageId);
    if (metadata === null) {
      return null;
    }

    // Clamp to the validated image allowlist. `_storage` contentType is set by
    // the client at upload time, so serving it verbatim would let a magic-byte-
    // valid polyglot be served as e.g. text/html. Anything outside the image
    // allowlist becomes a non-renderable octet-stream (paired with `nosniff` on
    // the public route) so it can never execute as HTML.
    const metaType = metadata.contentType ?? '';
    return {
      storageId: published.storageId,
      contentType: isAllowedMimeType(metaType)
        ? metaType
        : 'application/octet-stream',
    };
  },
});

const ORPHAN_AGE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
// Files examined per transaction. Bounds reads (~2x this, counting the
// per-file confirmedUploads lookup) and writes (at most this many deletes)
// so a single mutation stays well within Convex transaction limits.
const ORPHAN_SCAN_PAGE_SIZE = 200;

/**
 * Deletes stored files that were never confirmed via confirmUpload.
 *
 * Walks _storage entries older than 1 hour in ascending creation order.
 * Files without a matching confirmedUploads record are orphans — uploaded
 * but never confirmed (abandoned uploads, client crashes, failed flows).
 *
 * Forward-progress design: confirmed files (event posters, community logos)
 * are permanent and accumulate at the head of the creation-time ordering.
 * A fixed from-the-head scan budget would be exhausted by that confirmed
 * backlog and never reach newer orphans. Instead this scans a bounded page
 * via the `by_creation_time` index starting strictly after `afterCreationTime`
 * and, when a full page of aged files is consumed, reschedules itself with the
 * cursor advanced to the last scanned file. The cursor is monotonically
 * increasing (Convex `_creationTime` is unique and ordered within a table), so
 * the sweep advances past any confirmed backlog and provably reaches every
 * aged orphan. It terminates because the set of files older than `cutoff` is
 * finite and fixed at sweep start — newly uploaded files have `_creationTime`
 * at/after `now`, which is beyond `cutoff`, so they cannot extend the sweep.
 *
 * The initial (hourly cron) invocation passes no args: `afterCreationTime`
 * defaults to 0 (scan from the head) and `nowMs` defaults to `Date.now()`.
 */
export const _cleanupOrphanedUploads = internalMutation({
  args: {
    // Creation-time cursor. Only files created strictly after this timestamp
    // are scanned. Threaded across self-rescheduled continuations so the sweep
    // advances instead of restarting from the head each run. Absent on the
    // initial cron-triggered invocation (defaults to 0 = scan from the head).
    afterCreationTime: v.optional(v.number()),
    // Fixed "now" reference so every batch of a sweep shares one stable
    // cutoff. The initial cron invocation omits it (resolves to Date.now());
    // that resolved value is then threaded through every self-rescheduled
    // continuation so the cutoff cannot drift forward mid-sweep. Tests pass it
    // to age stored files deterministically.
    nowMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    const cutoff = now - ORPHAN_AGE_THRESHOLD_MS;
    const afterCreationTime = args.afterCreationTime ?? 0;

    const files = await ctx.db.system
      .query('_storage')
      .withIndex('by_creation_time', (q) =>
        q.gt('_creationTime', afterCreationTime),
      )
      .take(ORPHAN_SCAN_PAGE_SIZE);

    let lastScannedCreationTime = afterCreationTime;
    let reachedYoungFile = false;

    for (const file of files) {
      // Ascending creation order: the first file at/after the cutoff means
      // every remaining file is also too young. Stop the sweep here.
      if (file._creationTime >= cutoff) {
        reachedYoungFile = true;
        break;
      }

      const confirmed = await ctx.db
        .query('confirmedUploads')
        .withIndex('by_storageId', (q) => q.eq('storageId', file._id))
        .first();

      if (!confirmed) {
        await ctx.storage.delete(file._id);
      }

      lastScannedCreationTime = file._creationTime;
    }

    // Continue only when this page was full of aged files: more aged
    // candidates may remain past the cursor. Advancing the cursor guarantees
    // the next run makes forward progress instead of rescanning the head.
    const shouldContinue =
      !reachedYoungFile && files.length === ORPHAN_SCAN_PAGE_SIZE;

    if (shouldContinue) {
      await ctx.scheduler.runAfter(
        0,
        internal.storage.files._cleanupOrphanedUploads,
        // Thread the resolved `now`, not `args.nowMs`, so a cron-started sweep
        // (which omits nowMs) freezes its cutoff at the first batch instead of
        // recomputing Date.now() and drifting forward across continuations.
        {afterCreationTime: lastScannedCreationTime, nowMs: now},
      );
    }

    return null;
  },
});

// Export constants for frontend validation
export const UPLOAD_LIMITS = {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
};
