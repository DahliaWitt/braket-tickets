/**
 * Shared bulk-import machinery for both CSV import targets.
 *
 * Responsibilities that MUST stay identical across the guest and external
 * ticket-holder targets live here: the batch-size cap, the stable
 * machine-readable error codes, idempotent-replay lookup by batch key, and the
 * name+email dedup key. Per-target field schemas and write logic diverge in the
 * respective `_impl` modules.
 *
 * Audit and error payloads carry only counts, batch keys, and row indexes —
 * never raw row contents (names / emails are PII).
 */
import {ConvexError} from 'convex/values';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {throwAppError} from '../errors';
import {normalizeEmailOrNull} from '../validation';
import type {ImportBatchResult, ImportTarget} from './validators';

/**
 * Maximum rows per import batch. One file = one batch key = one transaction;
 * files over the cap are rejected at preview with a "split the file" message so
 * the client never silently chunks a file into multiple batches.
 */
export const MAX_IMPORT_BATCH_SIZE = 500;

/**
 * Per-event cumulative cap on imported ticket holders. Aligned with the
 * management-surface dataset limit — unbounded include-duplicates re-imports
 * would otherwise break the roster / buyers views that load the full dataset.
 */
export const MAX_IMPORTED_ENTRIES_PER_EVENT = 5000;

export const IMPORT_ERROR_CODES = {
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  IMPORT_EMPTY: 'IMPORT_EMPTY',
  IMPORT_CAP_EXCEEDED: 'IMPORT_CAP_EXCEEDED',
} as const;

/**
 * Rejects a batch whose row count exceeds {@link MAX_IMPORT_BATCH_SIZE} or is
 * empty. Throws a stable `ConvexError` the client can branch on by `code`.
 */
export function assertBatchSizeWithinCap(rowCount: number): void {
  if (rowCount === 0) {
    throwAppError(IMPORT_ERROR_CODES.IMPORT_EMPTY, 'No rows to import.', {});
  }
  if (rowCount > MAX_IMPORT_BATCH_SIZE) {
    throwAppError(
      IMPORT_ERROR_CODES.BATCH_TOO_LARGE,
      `Import exceeds the maximum of ${MAX_IMPORT_BATCH_SIZE} rows per file. ` +
        'Split the file into smaller batches and import each separately.',
      {rowCount, maxBatchSize: MAX_IMPORT_BATCH_SIZE},
    );
  }
}

/**
 * Rejects an import that would push the event's cumulative imported-entry count
 * over {@link MAX_IMPORTED_ENTRIES_PER_EVENT}. `insertCount` is the number of
 * rows that would actually be written (post-dedup), so a skip-heavy re-import
 * does not trip the cap unnecessarily.
 */
export function assertEventImportCapNotExceeded(
  existingCount: number,
  insertCount: number,
  options?: {max?: number; entity?: string},
): void {
  const max = options?.max ?? MAX_IMPORTED_ENTRIES_PER_EVENT;
  const entity = options?.entity ?? 'imported entries';
  if (existingCount + insertCount > max) {
    throwAppError(
      IMPORT_ERROR_CODES.IMPORT_CAP_EXCEEDED,
      `This event already holds ${existingCount} ${entity}; importing ` +
        `${insertCount} more would exceed the per-event limit of ${max}. ` +
        `Remove some and retry.`,
      {existingCount, insertCount, maxPerEvent: max},
    );
  }
}

/**
 * Builds the case-insensitive name+email dedup key. Email is normalized (trim +
 * lowercase); name is trimmed, internal whitespace runs collapsed to a single
 * space, then lowercased — so "John  Doe" and "John Doe" key identically. A
 * missing email collapses to an empty segment so name-only rows still key
 * consistently.
 */
export function nameEmailDedupKey(name: string, email?: string): string {
  const normalizedName = name.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedEmail = normalizeEmailOrNull(email) ?? '';
  return `${normalizedName}\u0000${normalizedEmail}`;
}

/**
 * Normalizes an external ticket reference (barcode) for dedup and scanner
 * matching: trim + lowercase. A barcode is an opaque identifier whose case is
 * not semantically meaningful, so `ABC123` and `abc123` must resolve to the
 * same admission record. The verbatim `externalRef` is kept separately for
 * display; this key backs the `by_event_external_ref_key` index. The frontend
 * import preview lowercases the same way for its strong duplicate key.
 */
export function normalizeExternalRefKey(externalRef: string): string {
  return externalRef.trim().toLowerCase();
}

/**
 * Looks up an existing import batch by (event, batch key, target). Present iff
 * this batch key already committed for the event on THIS target — the caller
 * returns the stored result as a no-op replay. Scoping by target prevents a
 * batch key reused across the guest and imported-ticket targets from returning
 * the other target's result or being deleted by the wrong removal path.
 */
export async function findExistingImportBatch(
  ctx: MutationCtx,
  eventId: Id<'events'>,
  batchKey: string,
  target: ImportTarget,
): Promise<Doc<'importBatches'> | null> {
  return await ctx.db
    .query('importBatches')
    .withIndex('by_event_batch_key_target', (q) =>
      q.eq('eventId', eventId).eq('batchKey', batchKey).eq('target', target),
    )
    .unique();
}

/**
 * Persists the import-batch record. This is the durable source of the import
 * report (skipped-row outcomes cannot be reconstructed from the entries table)
 * and backs replay detection and batch removal.
 */
export async function insertImportBatch(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    batchKey: string;
    target: ImportTarget;
    result: ImportBatchResult;
  },
): Promise<Id<'importBatches'>> {
  return await ctx.db.insert('importBatches', {
    eventId: args.eventId,
    batchKey: args.batchKey,
    target: args.target,
    result: args.result,
  });
}

/**
 * Narrowing guard for the import-error `ConvexError` shape so callers / tests
 * can assert on `code` without recreating the branch.
 */
export function isImportError(
  err: unknown,
): err is ConvexError<{code: string; message: string}> {
  return (
    err instanceof ConvexError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    typeof (err.data as {code?: unknown}).code === 'string'
  );
}
