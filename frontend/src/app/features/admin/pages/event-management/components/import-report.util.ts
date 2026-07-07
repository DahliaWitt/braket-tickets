import {ConvexError} from 'convex/values';
import {type ImportBatchResult} from '@/features/admin/models/event-management.model';
import {
  type ImportReport,
  type ImportReportOutcome,
} from '@/features/admin/import';

/**
 * Maps the server-authoritative bulk-import result (`ImportBatchResult`, shared
 * by both the guest and buyer targets) into the import surface's `ImportReport`.
 *
 * The two vocabularies differ by one term: the backend reports a failed row as
 * `invalid`, while the surface's report uses `failed`. We translate `invalid` →
 * `failed` and surface a `failed` count so the report step can show all three
 * outcome buckets. Per-row `reason` strings carry counts/indexes only (no PII),
 * so they are safe to display verbatim.
 */
export function buildImportReport(result: ImportBatchResult): ImportReport {
  const outcomes: ImportReportOutcome[] = result.outcomes.map((outcome) => ({
    // The backend `rowIndex` is 0-based into the submitted (valid) rows; present
    // it 1-based for humans. This is the submitted-row position, not the CSV
    // source line — the two diverge because invalid/duplicate rows were never
    // submitted.
    submittedRowNumber: outcome.rowIndex + 1,
    status: outcome.status === 'invalid' ? 'failed' : outcome.status,
    reason: outcome.reason,
  }));

  const failed = outcomes.filter((o) => o.status === 'failed').length;

  return {
    inserted: result.insertedCount,
    skipped: result.skippedCount,
    failed,
    outcomes,
  };
}

/**
 * Builds a terminal-error `ImportReport` from a thrown import error. User-facing
 * `ConvexError`s (batch too large, no access, unknown event) carry a
 * machine-readable code and a human message; we surface the message. Anything
 * else falls back to a brand-voice generic string.
 */
export function buildImportErrorReport(
  error: unknown,
  fallback: string,
): ImportReport {
  const message = extractConvexErrorMessage(error) ?? fallback;
  return {inserted: 0, skipped: 0, errorMessage: message};
}

function extractConvexErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as {message: unknown}).message;
    if (typeof message === 'string') return message;
  }
  return null;
}
