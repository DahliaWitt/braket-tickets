import type {
  ImportRowValues,
  ImportTargetConfig,
  RowPartition,
  ValidatedRow,
} from './import-config';
import type {ParsedRow} from './import.types';

export interface PreviewCounts {
  readonly valid: number;
  readonly invalid: number;
  readonly duplicate: number;
  readonly total: number;
}

export interface PreviewResult {
  readonly rows: readonly ValidatedRow[];
  readonly counts: PreviewCounts;
  /** True when the row count exceeds the target cap — import must be blocked. */
  readonly overCap: boolean;
}

export interface BuildPreviewOptions {
  /**
   * Dedup mode. 'skip' (default) auto-skips strong-key duplicates into the
   * duplicate partition; 'include' keeps them valid (buyer target's include
   * mode). The guest target always behaves as 'skip'.
   */
  readonly dedupMode: 'skip' | 'include';
  /**
   * Strong dedup keys already present (e.g. prior imports / existing guests),
   * lowercased. A row whose strong key is in this set is a cross-import
   * duplicate.
   */
  readonly existingStrongKeys?: ReadonlySet<string>;
  /**
   * Weak dedup keys already present (buyer target name+email hints). Matches are
   * flagged "possible duplicate" but never auto-skipped.
   */
  readonly existingWeakKeys?: ReadonlySet<string>;
}

/**
 * Partition parsed rows into valid / invalid / duplicate with per-row reasons.
 *
 * Order of precedence for a row's partition:
 *   1. invalid — any validation reason (missing name, bad email, bad type, ...)
 *   2. duplicate — strong-key match (within batch or against existing) in a
 *      mode that skips duplicates; the guest target always skips
 *   3. valid
 *
 * Weak (name+email) matches never move a row out of valid; they attach a
 * "possible duplicate" hint reason so the admin can eyeball them.
 */
export function buildPreview(
  parsedRows: readonly ParsedRow[],
  config: ImportTargetConfig,
  options: BuildPreviewOptions,
): PreviewResult {
  const skipDuplicates = config.dedupModeSelectable
    ? options.dedupMode === 'skip'
    : true; // guest target always skips

  const existingStrong = options.existingStrongKeys ?? new Set<string>();
  const existingWeak = options.existingWeakKeys ?? new Set<string>();

  const seenStrong = new Set<string>();
  const seenWeak = new Set<string>();

  const rows: ValidatedRow[] = parsedRows.map((parsed) => {
    const validation = config.validateRow(parsed);
    const values = validation.values;
    const reasons = [...validation.reasons];

    let partition: RowPartition = reasons.length > 0 ? 'invalid' : 'valid';

    const strongKey = config.dedupKey(values);
    const weakKey = config.weakDedupKey?.(values) ?? null;

    if (partition === 'valid' && strongKey !== null) {
      const isDuplicate =
        existingStrong.has(strongKey) || seenStrong.has(strongKey);
      if (isDuplicate) {
        if (skipDuplicates) {
          partition = 'duplicate';
          reasons.push(config.copy.duplicateSkippedReason);
        } else {
          reasons.push(config.copy.duplicateIncludedReason);
        }
      }
    }

    // Weak name+email hint (buyer target only): informational, never skips.
    if (partition === 'valid' && weakKey !== null && strongKey === null) {
      if (existingWeak.has(weakKey) || seenWeak.has(weakKey)) {
        reasons.push('possible duplicate — same name and email');
      }
    }

    // Only track keys for rows that actually count as present. An invalid row
    // was never submitted, so it must not make a later valid row with the same
    // key look like a duplicate.
    if (partition !== 'invalid') {
      if (strongKey !== null) seenStrong.add(strongKey);
      if (weakKey !== null) seenWeak.add(weakKey);
    }

    return {
      sourceRowNumber: parsed.sourceRowNumber,
      partition,
      reasons,
      values,
      raw: parsed.raw,
    };
  });

  const counts = countPartitions(rows);
  return {
    rows,
    counts,
    overCap: rows.length > config.maxRows,
  };
}

function countPartitions(rows: readonly ValidatedRow[]): PreviewCounts {
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  for (const row of rows) {
    if (row.partition === 'valid') valid++;
    else if (row.partition === 'invalid') invalid++;
    else duplicate++;
  }
  return {valid, invalid, duplicate, total: rows.length};
}

/** The valid rows' normalized values — what the surface emits on confirm. */
export function extractValidValues(
  rows: readonly ValidatedRow[],
): readonly ImportRowValues[] {
  return rows.filter((r) => r.partition === 'valid').map((r) => r.values);
}
