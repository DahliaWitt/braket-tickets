import type {ImportRowValues} from './import-config';
import type {ImportFieldKey} from './import.types';

/** Dedup mode the buyer target offers; guest target is always 'skip'. */
export type DedupMode = 'skip' | 'include';

/**
 * The payload the surface emits on confirm. A later wave feeds this to the
 * per-target bulk mutation via the generated API (`FunctionArgs<...>`), so the
 * shape stays intentionally plain (no Convex types leak into this feature).
 */
export interface ImportConfirmPayload {
  /** Normalized values for the valid rows only. */
  readonly rows: readonly ImportRowValues[];
  /** Chosen dedup mode (buyer target); 'skip' for the guest target. */
  readonly dedupMode: DedupMode;
  /** Source label (buyer target); trimmed, defaulting handled by the surface. */
  readonly sourceLabel?: string;
  /** Client-generated batch key for idempotent retry (buyer + guest). */
  readonly batchKey: string;
}

/**
 * Post-commit report the consumer passes back via input() after the mutation
 * returns. Mirrors the server's structured result so the report step reflects
 * what the server actually did, not the client's prediction.
 */
export interface ImportReport {
  readonly inserted: number;
  readonly skipped: number;
  readonly failed?: number;
  /** Optional per-row outcomes for a detailed report. */
  readonly outcomes?: readonly ImportReportOutcome[];
  /** Terminal error (e.g. batch too large / no access) surfaced to the admin. */
  readonly errorMessage?: string;
}

export interface ImportReportOutcome {
  /**
   * 1-based position within the SUBMITTED (valid) rows the server processed —
   * NOT the CSV source line (invalid/duplicate rows were never submitted, so the
   * two diverge). Named distinctly to avoid implying a source-line number.
   */
  readonly submittedRowNumber: number;
  readonly status: 'inserted' | 'skipped' | 'failed';
  readonly reason?: string;
}

/** Manual column mapping the admin builds on the mapping step. */
export type ManualColumnMapping = ReadonlyMap<number, ImportFieldKey | null>;

/** Stepped flow states. Mapping only appears when the parse is ambiguous. */
export type ImportStep = 'input' | 'mapping' | 'preview' | 'report';
