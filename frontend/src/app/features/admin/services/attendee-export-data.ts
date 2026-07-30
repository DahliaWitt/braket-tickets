import {
  type EventManagementPurchase,
  type Guest,
  type ImportedTicketHolder,
} from '../models/event-management.model';
import {formatExportDateTime, formatUsdCents} from '../utils/export-formatting';

export type ExportFieldKey =
  | Extract<Exclude<keyof EventManagementPurchase, 'tickets'>, string>
  | 'formattedAmount'
  | 'formattedDate'
  | 'source';

/** Source label used for Braket-native rows in the export source column. */
export const NATIVE_SOURCE_LABEL = 'braket tickets';

export type ExportRow = Partial<Record<ExportFieldKey | 'status', string>>;

/**
 * Configuration for a single export field.
 *
 * @property key - The data key to extract from a purchase record. Can be a direct property
 *                 of `EventManagementPurchase` or a computed field like 'formattedAmount'.
 * @property label - Human-readable column header for this field.
 * @property enabled - Whether to include this field in the export. Allows users to customize
 *                     which columns appear in their exported files.
 */
export interface ExportField {
  key: ExportFieldKey;
  label: string;
  enabled: boolean;
}

/**
 * Configuration object for attendee list exports.
 *
 * @property fields - Array of field configurations determining which columns to export.
 * @property format - Output format: 'csv' for spreadsheet-compatible, 'pdf' for printable documents.
 * @property eventTitle - Event name used in headers and filename generation.
 * @property eventDate - Optional event date displayed in PDF header.
 * @property includeRefunded - When true, refunded tickets appear in a separate section/page.
 *                             Default: false (only active tickets exported).
 */
export interface ExportConfig {
  fields: ExportField[];
  format: 'csv' | 'pdf';
  eventTitle: string;
  eventDate?: string;
  /** Whether to include refunded tickets in the export. Default: false */
  includeRefunded?: boolean;
}

/**
 * Default field configuration for attendee exports.
 * Includes the most commonly needed columns: name, email, tier, quantity, amount, and date.
 */
export const DEFAULT_EXPORT_FIELDS: ExportField[] = [
  {key: 'userName', label: 'Name', enabled: true},
  {key: 'userEmail', label: 'Email', enabled: true},
  {key: 'tier', label: 'Tier', enabled: true},
  {key: 'quantity', label: 'Quantity', enabled: true},
  {key: 'formattedAmount', label: 'Amount', enabled: true},
  {key: 'formattedDate', label: 'Purchase Date', enabled: true},
  {key: 'source', label: 'Source', enabled: true},
];

function purchaseFieldValue(
  purchase: EventManagementPurchase,
  field: ExportField,
): string {
  switch (field.key) {
    case 'formattedAmount':
      return formatUsdCents(purchase.amount);
    case 'formattedDate':
      return formatExportDateTime(purchase.createdAt);
    case 'userEmail':
      return purchase.userEmail ?? '—';
    case 'tier':
      return purchase.tier.toUpperCase();
    case 'source':
      return NATIVE_SOURCE_LABEL;
    case 'id':
    case 'status':
    case 'userId':
    case 'amount':
    case 'refundedAmountCents':
    case 'quantity':
    case 'createdAt':
    case 'userName':
      return String(purchase[field.key] ?? '');
    default:
      throw new Error('Unsupported export field');
  }
}

function guestFieldValue(guest: Guest, field: ExportField): string {
  switch (field.key) {
    case 'userName':
      return guest.name;
    case 'userEmail':
      return guest.email ?? '—';
    case 'tier':
      return `GUEST (${guest.type.toUpperCase()})`;
    case 'quantity':
      return '1';
    case 'formattedAmount':
      return '—';
    case 'formattedDate':
      return guest.emailedAt ? formatExportDateTime(guest.emailedAt) : '—';
    case 'source':
      return NATIVE_SOURCE_LABEL;
    case 'id':
    case 'status':
    case 'userId':
    case 'amount':
    case 'refundedAmountCents':
    case 'createdAt':
      return '—';
    default:
      throw new Error('Unsupported export field');
  }
}

/**
 * Field value for an imported external ticket-holder. Imported entries carry no
 * financial data, so tier / quantity / amount / refund-status columns emit BLANK
 * (empty string, not zero) — a zero would read as a real free-of-charge sale.
 * The raw purchase-date string passes through UNFORMATTED (external exports
 * carry no timezone, so parsing to a timestamp would encode a guess as fact).
 */
function importedFieldValue(
  entry: ImportedTicketHolder,
  field: ExportField,
): string {
  switch (field.key) {
    case 'userName':
      return entry.name;
    case 'userEmail':
      return entry.email ?? '—';
    case 'formattedDate':
      // Raw source string, never re-formatted.
      return entry.purchaseDateRaw ?? '';
    case 'source':
      return entry.sourceLabel;
    // Financial columns are intentionally blank for imported entries.
    case 'tier':
    case 'quantity':
    case 'formattedAmount':
    case 'status':
    case 'amount':
    case 'refundedAmountCents':
      return '';
    case 'id':
    case 'userId':
    case 'createdAt':
      return '';
    default:
      throw new Error('Unsupported export field');
  }
}

export function prepareAttendeeExportData(
  purchases: EventManagementPurchase[],
  fields: ExportField[],
  guests: Guest[] = [],
  includeStatus = false,
  importedEntries: ImportedTicketHolder[] = [],
): ExportRow[] {
  const purchaseRows = purchases.map((purchase) => {
    const row: ExportRow = {};

    for (const field of fields) {
      row[field.key] = purchaseFieldValue(purchase, field);
    }

    if (includeStatus) {
      row['status'] = purchase.status === 'refunded' ? 'REFUNDED' : 'ACTIVE';
    }

    return row;
  });

  const guestRows = guests.map((guest) => {
    const row: ExportRow = {};

    for (const field of fields) {
      row[field.key] = guestFieldValue(guest, field);
    }

    if (includeStatus) {
      row['status'] = 'GUEST';
    }

    return row;
  });

  const importedRows = importedEntries.map((entry) => {
    const row: ExportRow = {};

    for (const field of fields) {
      row[field.key] = importedFieldValue(entry, field);
    }

    // Imported entries have no refund state — the status column stays blank
    // (never 'ACTIVE'/'REFUNDED', which would imply a native financial record).
    if (includeStatus) {
      row['status'] = '';
    }

    return row;
  });

  return [...purchaseRows, ...guestRows, ...importedRows];
}
