import {IMPORT_GUEST_TYPES} from './import.types';
import type {GuestType, ImportFieldKey, ParsedRow} from './import.types';

/**
 * Client-side field caps mirroring the server validators. The preview uses these
 * to surface fixable problems early; the server re-validates every row at commit
 * (the preview is UX, not the security boundary). Kept as named constants so a
 * later wave can assert they match the backend.
 */
export const IMPORT_FIELD_LIMITS = {
  name: {min: 1, max: 200},
  email: {max: 254},
  ticketTypeLabel: {max: 100},
  externalRef: {max: 100},
  orderRef: {max: 100},
  purchaseDateRaw: {max: 50},
  sourceLabel: {max: 100},
  notes: {max: 1000},
} as const;

/** Default source label shown/applied when the admin leaves the field blank. */
export const DEFAULT_SOURCE_LABEL = 'External';

/**
 * A validated import row: the normalized values the surface emits plus its
 * partition. `reasons` is empty for valid rows, populated for invalid ones.
 * `duplicate` marks rows the preview flags against prior data / within-batch.
 */
export type RowPartition = 'valid' | 'invalid' | 'duplicate';

export interface ValidatedRow {
  readonly sourceRowNumber: number;
  readonly partition: RowPartition;
  /** Per-row reasons (invalid rows) or duplicate hints. Brand-voice strings. */
  readonly reasons: readonly string[];
  /** Normalized field values (only fields the target accepts are populated). */
  readonly values: ImportRowValues;
  /** Original ordered cells, for rendering the preview including ignored columns. */
  readonly raw: readonly string[];
}

export interface ImportRowValues {
  readonly name: string;
  readonly email?: string;
  readonly guestType?: GuestType;
  readonly notes?: string;
  readonly ticketTypeLabel?: string;
  readonly externalRef?: string;
  readonly orderRef?: string;
  readonly purchaseDateRaw?: string;
}

/** Copy strings a target supplies so the shared surface stays target-agnostic. */
export interface ImportCopy {
  readonly title: string;
  readonly inputHint: string;
  readonly emptyState: string;
  readonly confirmLabel: string;
  readonly overCapMessage: (max: number) => string;
}

/**
 * Per-target import configuration. The shared parser/preview/surface are
 * parameterized entirely by this object — divergence between the guest and
 * buyer flows is limited to the values here, never duplicated components.
 */
export interface ImportTargetConfig {
  readonly target: 'guest' | 'buyer';
  /** Canonical field keys this target accepts (constrains header resolution). */
  readonly acceptedFields: readonly ImportFieldKey[];
  /** Template header labels + example rows (derived from the synonym constant). */
  readonly templateFields: readonly ImportFieldKey[];
  readonly templateExampleRows: readonly Partial<
    Record<ImportFieldKey, string>
  >[];
  /** Max rows per import (over-cap files are rejected at preview). */
  readonly maxRows: number;
  /**
   * Whether the target offers the skip/include-duplicates choice (buyer only).
   * The guest target always flags + skips duplicates.
   */
  readonly dedupModeSelectable: boolean;
  /** Whether the target asks for a source label (buyer only). */
  readonly requiresSourceLabel: boolean;
  readonly copy: ImportCopy;
  /** Row-level validator producing the normalized values + partition. */
  readonly validateRow: (row: ParsedRow) => RowValidation;
  /**
   * Strong duplicate key for a validated row, or null when the row has no strong
   * key. Rows sharing a non-null key are duplicates. Guests key on name+email;
   * buyers key on external reference (barcode) only.
   */
  readonly dedupKey: (values: ImportRowValues) => string | null;
  /**
   * Weak duplicate key (buyer target): name+email used only for "possible
   * duplicate" preview hints, never auto-skip. Null disables weak hints.
   */
  readonly weakDedupKey?: (values: ImportRowValues) => string | null;
}

export interface RowValidation {
  readonly values: ImportRowValues;
  readonly reasons: readonly string[];
}

// --- Shared field validators (mirror the server rules) ---

function validateName(raw: string | undefined, reasons: string[]): string {
  const name = (raw ?? '').trim();
  if (name.length < IMPORT_FIELD_LIMITS.name.min) {
    reasons.push('missing name');
  } else if (name.length > IMPORT_FIELD_LIMITS.name.max) {
    reasons.push(`name over ${IMPORT_FIELD_LIMITS.name.max} characters`);
  }
  return name;
}

function validateEmail(
  raw: string | undefined,
  reasons: string[],
): string | undefined {
  const email = (raw ?? '').trim();
  if (email.length === 0) return undefined;
  if (email.length > IMPORT_FIELD_LIMITS.email.max) {
    reasons.push(`email over ${IMPORT_FIELD_LIMITS.email.max} characters`);
  } else if (!email.includes('@')) {
    reasons.push('email is missing an @');
  }
  return email;
}

function validateCappedOptional(
  raw: string | undefined,
  max: number,
  fieldLabel: string,
  reasons: string[],
): string | undefined {
  const value = (raw ?? '').trim();
  if (value.length === 0) return undefined;
  if (value.length > max) {
    reasons.push(`${fieldLabel} over ${max} characters`);
  }
  return value;
}

function validateGuestType(
  raw: string | undefined,
  reasons: string[],
): GuestType {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.length === 0) return 'guest'; // missing type defaults to guest
  const match = IMPORT_GUEST_TYPES.find((t) => t === value);
  if (match === undefined) {
    // Invalid type is a per-row error — never silently coerced to guest.
    reasons.push(`"${value}" is not a valid guest type`);
    return 'guest';
  }
  return match;
}

// --- Target configs ---

export const GUEST_IMPORT_CONFIG: ImportTargetConfig = {
  target: 'guest',
  acceptedFields: ['name', 'email', 'guestType', 'notes'],
  templateFields: ['name', 'email', 'guestType', 'notes'],
  templateExampleRows: [
    {
      name: ' zoe example',
      email: 'zoe@example.test',
      guestType: 'guest',
      notes: 'plus one',
    },
    {
      name: 'sam sample',
      email: 'sam@example.test',
      guestType: 'artist guest',
      notes: '',
    },
  ],
  maxRows: 500,
  dedupModeSelectable: false,
  requiresSourceLabel: false,
  copy: {
    title: 'bulk add guests',
    inputHint: 'paste a list or upload a csv — one guest per row',
    emptyState:
      'no guests pasted yet — drop in a list from your spreadsheet, or download the template to see the shape',
    confirmLabel: 'add guests',
    overCapMessage: (max) =>
      `that's more than ${max} rows — split the file and import it in a few passes`,
  },
  validateRow: (row: ParsedRow): RowValidation => {
    const reasons: string[] = [];
    const name = validateName(row.cells.name, reasons);
    const email = validateEmail(row.cells.email, reasons);
    const guestType = validateGuestType(row.cells.guestType, reasons);
    const notes = validateCappedOptional(
      row.cells.notes,
      IMPORT_FIELD_LIMITS.notes.max,
      'notes',
      reasons,
    );
    return {values: {name, email, guestType, notes}, reasons};
  },
  // Guests dedup on name+email (case-insensitive).
  dedupKey: (values) =>
    `${values.name.toLowerCase()} ${(values.email ?? '').toLowerCase()}`,
};

export const BUYER_IMPORT_CONFIG: ImportTargetConfig = {
  target: 'buyer',
  acceptedFields: [
    'name',
    'email',
    'ticketTypeLabel',
    'externalRef',
    'orderRef',
    'purchaseDateRaw',
  ],
  templateFields: [
    'name',
    'email',
    'ticketTypeLabel',
    'externalRef',
    'orderRef',
    'purchaseDateRaw',
  ],
  templateExampleRows: [
    {
      name: 'zoe example',
      email: 'zoe@example.test',
      ticketTypeLabel: 'general admission',
      externalRef: 'EXAMPLE-0001',
      orderRef: 'ORDER-EXAMPLE',
      purchaseDateRaw: '2026-07-06 12:28',
    },
    {
      name: 'sam sample',
      email: '',
      ticketTypeLabel: 'early bird',
      externalRef: 'EXAMPLE-0002',
      orderRef: 'ORDER-EXAMPLE',
      purchaseDateRaw: '2026-07-06 12:29',
    },
  ],
  maxRows: 500,
  dedupModeSelectable: true,
  requiresSourceLabel: true,
  copy: {
    title: 'import external tickets',
    inputHint:
      'paste your ra export or upload a csv — one ticket per row, quantity columns are ignored',
    emptyState:
      'no external tickets yet — import your ra list to check them in at the door alongside braket tickets',
    confirmLabel: 'import tickets',
    overCapMessage: (max) =>
      `that's more than ${max} rows — split the file and import it in a few passes`,
  },
  validateRow: (row: ParsedRow): RowValidation => {
    const reasons: string[] = [];
    const name = validateName(row.cells.name, reasons);
    const email = validateEmail(row.cells.email, reasons);
    const ticketTypeLabel = validateCappedOptional(
      row.cells.ticketTypeLabel,
      IMPORT_FIELD_LIMITS.ticketTypeLabel.max,
      'ticket type',
      reasons,
    );
    const externalRef = validateCappedOptional(
      row.cells.externalRef,
      IMPORT_FIELD_LIMITS.externalRef.max,
      'barcode',
      reasons,
    );
    const orderRef = validateCappedOptional(
      row.cells.orderRef,
      IMPORT_FIELD_LIMITS.orderRef.max,
      'order number',
      reasons,
    );
    const purchaseDateRaw = validateCappedOptional(
      row.cells.purchaseDateRaw,
      IMPORT_FIELD_LIMITS.purchaseDateRaw.max,
      'purchase date',
      reasons,
    );
    return {
      values: {
        name,
        email,
        ticketTypeLabel,
        externalRef,
        orderRef,
        purchaseDateRaw,
      },
      reasons,
    };
  },
  // Buyers dedup on external reference (barcode) only — the sole strong key.
  dedupKey: (values) => {
    const ref = (values.externalRef ?? '').trim().toLowerCase();
    return ref.length > 0 ? ref : null;
  },
  // Barcode-less rows: name+email is a weak "possible duplicate" hint only.
  weakDedupKey: (values) => {
    const name = values.name.toLowerCase();
    const email = (values.email ?? '').toLowerCase();
    if (name.length === 0) return null;
    return `${name} ${email}`;
  },
};
