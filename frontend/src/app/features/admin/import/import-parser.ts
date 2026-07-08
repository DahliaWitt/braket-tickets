import {
  normalizeHeaderLabel,
  resolveHeaderField,
} from './import-header-synonyms';
import type {
  HeaderColumn,
  ImportDelimiter,
  ImportFieldKey,
  ParsedRow,
  ParseResult,
} from './import.types';

const DELIMITER_CHAR: Readonly<Record<ImportDelimiter, string>> = {
  tab: '\t',
  comma: ',',
  semicolon: ';',
};

/** Strip a single leading UTF-8 BOM (RA exports commonly carry one). */
function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/**
 * Auto-detect the delimiter from the FIRST physical line (the header). We count
 * unquoted occurrences of each candidate and pick the most frequent, preferring
 * tab (spreadsheet paste) then comma then semicolon on ties. Counting only the
 * header line avoids being fooled by delimiters embedded in quoted body cells.
 */
function detectDelimiter(input: string): ImportDelimiter {
  const firstLine = extractFirstLogicalLine(input);
  const counts: Record<ImportDelimiter, number> = {
    tab: 0,
    comma: 0,
    semicolon: 0,
  };

  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === '\t') counts.tab++;
    else if (ch === ',') counts.comma++;
    else if (ch === ';') counts.semicolon++;
  }

  const order: ImportDelimiter[] = ['tab', 'comma', 'semicolon'];
  let best: ImportDelimiter = 'comma';
  let bestCount = -1;
  for (const candidate of order) {
    if (counts[candidate] > bestCount) {
      best = candidate;
      bestCount = counts[candidate];
    }
  }
  return best;
}

/**
 * Extract the first logical (record) line respecting quotes — a quoted embedded
 * newline does not terminate the record. Used only for delimiter detection.
 */
function extractFirstLogicalLine(input: string): string {
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      return input.slice(0, i);
    }
  }
  return input;
}

/**
 * Full RFC-4180-style tokenizer: splits input into records of fields honoring
 * quoted fields, escaped quotes (`""`), embedded newlines inside quotes, and
 * CRLF or LF record separators. Cells are whitespace-trimmed AFTER unquoting so
 * quoted values keep any intentional interior padding removed consistently with
 * unquoted ones (the spec calls for trimming cells).
 */
/**
 * Tokenize CSV/paste text into records. When `maxRecords` is set, parsing stops
 * once that many records are collected — so a pathologically large paste never
 * tokenizes end-to-end just to be rejected by the row cap later.
 */
function tokenize(
  input: string,
  delimiter: string,
  maxRecords?: number,
): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;

  const atCap = (): boolean =>
    maxRecords !== undefined && records.length >= maxRecords;

  const pushField = (): void => {
    // Trim outer whitespace of every cell (quoted or not) per parsing rules.
    record.push(field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < input.length && !atCap()) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field.trim().length === 0) {
      // Opening quote of a field (allow leading whitespace before the quote).
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
      i++;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }

    if (ch === '\r') {
      // Normalize CRLF and lone CR to a record break.
      pushRecord();
      if (input[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }

    if (ch === '\n') {
      pushRecord();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Flush trailing field/record unless input ended exactly on a record break or
  // we already hit the record cap.
  if (!atCap() && (field.length > 0 || fieldWasQuoted || record.length > 0)) {
    pushRecord();
  }

  return records;
}

/** True when a record is entirely empty cells (blank line). */
function isBlankRecord(record: readonly string[]): boolean {
  return record.every((cell) => cell.length === 0);
}

export interface ParseOptions {
  /**
   * Field keys the active target accepts. Constrains header resolution so a
   * guest "type" column maps to `guestType`, not the buyer-only ticket label.
   */
  readonly acceptedFields: ReadonlySet<ImportFieldKey>;
  /**
   * Optional manual column-index → field mapping. When provided it OVERRIDES
   * auto-detected header synonyms for those indexes (the mapping step feeds this
   * after an admin resolves ambiguity). A field of null forces a column ignored.
   */
  readonly manualMapping?: ReadonlyMap<number, ImportFieldKey | null>;
  /**
   * Max data rows the target accepts. When set, tokenization stops at
   * `maxRows + 1` data rows (enough to still flag over-cap) instead of parsing a
   * huge paste in full. Omit to parse without a bound.
   */
  readonly maxRows?: number;
}

/**
 * Parse pasted text or file contents into structured, header-mapped rows.
 *
 * Pipeline: strip BOM → detect delimiter → tokenize (RFC quoting) → drop blank
 * lines → map headers to canonical fields → build typed rows. Returns a typed
 * error for empty/header-only input, duplicate headers, or (unless a manual
 * mapping supplies a name) no mappable name column. Duplicate headers and a
 * missing name column set `requiresManualMapping` when a manual mapping was NOT
 * supplied, letting the surface route to the mapping step.
 */
export function parseImportText(
  input: string,
  options: ParseOptions,
): ParseResult {
  const cleaned = stripBom(input);
  if (cleaned.trim().length === 0) {
    return {
      ok: false,
      error: {code: 'no-rows-found', message: 'no rows found'},
    };
  }

  const delimiterName = detectDelimiter(cleaned);
  const delimiter = DELIMITER_CHAR[delimiterName];
  // Cap tokenization at header + maxRows + 1 rows: enough to still detect an
  // over-cap paste, without tokenizing a huge input end-to-end.
  const maxRecords =
    options.maxRows !== undefined ? options.maxRows + 2 : undefined;
  const records = tokenize(cleaned, delimiter, maxRecords).filter(
    (record) => !isBlankRecord(record),
  );

  if (records.length === 0) {
    return {
      ok: false,
      error: {code: 'no-rows-found', message: 'no rows found'},
    };
  }

  const headerRecord = records[0];
  const dataRecords = records.slice(1);

  // Detect duplicate header labels (normalized). Duplicates make auto-mapping
  // ambiguous — route to manual mapping rather than guessing.
  const seen = new Map<string, number>();
  const duplicateIndexes = new Set<number>();
  headerRecord.forEach((label, index) => {
    const normalized = normalizeHeaderLabel(label);
    if (normalized.length === 0) return;
    if (seen.has(normalized)) {
      duplicateIndexes.add(index);
      const firstIndex = seen.get(normalized);
      if (firstIndex !== undefined) duplicateIndexes.add(firstIndex);
    } else {
      seen.set(normalized, index);
    }
  });
  const hasDuplicateHeaders = duplicateIndexes.size > 0;

  const manualMapping = options.manualMapping;

  const columns: HeaderColumn[] = headerRecord.map((label, index) => {
    let mappedTo: ImportFieldKey | null;
    if (manualMapping && manualMapping.has(index)) {
      mappedTo = manualMapping.get(index) ?? null;
    } else if (hasDuplicateHeaders && duplicateIndexes.has(index)) {
      // Ambiguous duplicate columns are left unmapped until manually resolved.
      mappedTo = null;
    } else {
      mappedTo = resolveHeaderField(label, options.acceptedFields);
    }
    return {
      index,
      label,
      mappedTo,
      duplicate: duplicateIndexes.has(index),
    };
  });

  if (dataRecords.length === 0) {
    // Header present but no data rows.
    return {
      ok: false,
      error: {code: 'no-rows-found', message: 'no rows found'},
    };
  }

  const hasNameColumn = columns.some((column) => column.mappedTo === 'name');

  // Without a manual mapping, unresolved ambiguity routes to the mapping step
  // rather than erroring, so the admin can fix it in place.
  if (!manualMapping) {
    if (hasDuplicateHeaders) {
      return buildResult(delimiterName, columns, dataRecords, true);
    }
    if (!hasNameColumn) {
      return buildResult(delimiterName, columns, dataRecords, true);
    }
  } else if (!hasNameColumn) {
    // Manual mapping was applied but still lacks a name column — hard error.
    return {
      ok: false,
      error: {
        code: 'no-name-column',
        message: 'no column maps to name',
      },
    };
  }

  return buildResult(delimiterName, columns, dataRecords, false);
}

function buildResult(
  delimiter: ImportDelimiter,
  columns: readonly HeaderColumn[],
  dataRecords: readonly (readonly string[])[],
  requiresManualMapping: boolean,
): ParseResult {
  const rows: ParsedRow[] = dataRecords.map((record, dataIndex) => {
    const cells: Partial<Record<ImportFieldKey, string>> = {};
    for (const column of columns) {
      if (column.mappedTo === null) continue;
      const value = record[column.index] ?? '';
      // First non-empty wins if two columns somehow map to the same field.
      if (
        cells[column.mappedTo] === undefined ||
        cells[column.mappedTo] === ''
      ) {
        cells[column.mappedTo] = value;
      }
    }
    return {
      // +2: header is row 1, first data record is row 2.
      sourceRowNumber: dataIndex + 2,
      cells,
      raw: record,
    };
  });

  return {
    ok: true,
    delimiter,
    columns,
    rows,
    requiresManualMapping,
  };
}
