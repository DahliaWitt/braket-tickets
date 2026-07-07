import type {Doc} from '@convex/_generated/dataModel';

/**
 * Canonical field keys the shared import pipeline can map source columns to.
 *
 * These are target-agnostic: the guest target uses a subset (name/email/type/
 * notes) and the buyer target uses the external-ticket subset. The parser maps
 * every recognized column to one of these keys; unknown columns are surfaced in
 * the preview but ignored.
 */
export type ImportFieldKey =
  | 'name'
  | 'email'
  | 'ticketTypeLabel'
  | 'externalRef'
  | 'orderRef'
  | 'purchaseDateRaw'
  | 'guestType'
  | 'notes';

/**
 * Guest type mirror. Locked to the backend `guests.type` union via the
 * assignment below — if the backend enum changes, this array stops matching the
 * `GuestType` type and the file fails to compile. Runtime values live on the
 * frontend because the parser/validation runs client-side; the backend remains
 * the security authority.
 */
export type GuestType = Doc<'guests'>['type'];

export const IMPORT_GUEST_TYPES: readonly GuestType[] = [
  'guest',
  'artist guest',
  'staff',
] as const;

/** Delimiters the parser can auto-detect. Spreadsheet paste is tab-separated. */
export type ImportDelimiter = 'tab' | 'comma' | 'semicolon';

/**
 * A single parsed source row. Cells are stored under their canonical field key
 * after header mapping; `raw` preserves the original ordered cell values so the
 * preview can show ignored columns. `sourceRowNumber` is 1-based and counts the
 * header as row 1 (so the first data row is 2), matching how a spreadsheet
 * displays rows — makes per-row error messages actionable.
 */
export interface ParsedRow {
  readonly sourceRowNumber: number;
  readonly cells: Partial<Record<ImportFieldKey, string>>;
  readonly raw: readonly string[];
}

/** A source column and the canonical field it mapped to (or null when ignored). */
export interface HeaderColumn {
  readonly index: number;
  readonly label: string;
  readonly mappedTo: ImportFieldKey | null;
  /** True when this column's label collided with another (duplicate header). */
  readonly duplicate: boolean;
}

export type ParseErrorCode =
  | 'no-rows-found'
  | 'duplicate-headers'
  | 'no-name-column';

export interface ParseError {
  readonly code: ParseErrorCode;
  readonly message: string;
}

/**
 * Result of parsing raw text into structured rows. `ok: false` carries a typed
 * error the surface translates into brand-voice copy. `requiresManualMapping`
 * is set (with `ok: true`) when auto-mapping is ambiguous (duplicate headers or
 * no name column) so the surface can route to the mapping step instead of
 * failing outright.
 */
export type ParseResult =
  | {
      readonly ok: true;
      readonly delimiter: ImportDelimiter;
      readonly columns: readonly HeaderColumn[];
      readonly rows: readonly ParsedRow[];
      readonly requiresManualMapping: boolean;
    }
  | {
      readonly ok: false;
      readonly error: ParseError;
    };
