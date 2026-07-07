import type {ImportFieldKey} from './import.types';

/**
 * Case-insensitive header synonym table shared by the parser AND the template
 * generator. The parser matches source column labels against these synonyms;
 * the template generator emits the FIRST synonym of each field as its canonical
 * header. Because both derive from this one constant, template headers can never
 * drift from what the parser recognizes.
 *
 * Keys are canonical field keys; values are the accepted header labels (first =
 * canonical). Matching is done on a normalized form (trimmed, lowercased,
 * internal whitespace collapsed) so "Billing Name", "billing name", and
 * " billing  name " all resolve to `name`.
 */
export const IMPORT_HEADER_SYNONYMS: Readonly<
  Record<ImportFieldKey, readonly string[]>
> = {
  name: ['name', 'billing name', 'full name', 'attendee', 'guest name'],
  email: ['email', 'email address', 'e-mail'],
  ticketTypeLabel: ['ticket type', 'type', 'ticket', 'tier'],
  externalRef: ['barcode', 'external reference', 'ticket reference', 'qr'],
  orderRef: ['order number', 'order reference', 'order', 'order id'],
  purchaseDateRaw: ['date purchased', 'purchase date', 'date', 'purchased'],
  // Bare "type" also lives on ticketTypeLabel; the per-target acceptedFields set
  // disambiguates (guest target accepts guestType not ticketTypeLabel, and vice
  // versa), so a guest CSV's "type" column maps to the guest type here.
  guestType: ['guest type', 'attendee type', 'type'],
  notes: ['notes', 'note', 'comment', 'comments'],
} as const;

/** Normalize a header label for case-insensitive, whitespace-tolerant matching. */
export function normalizeHeaderLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a source column label to a canonical field key, or null when no
 * synonym matches (unrecognized column — surfaced in preview, ignored on import).
 *
 * `guestType` and `ticketTypeLabel` share the surface concept of a "type"
 * column. To avoid a guest CSV's "type" mapping to the buyer-only ticket label
 * (or vice versa), the caller passes the set of field keys the active target
 * actually accepts; synonyms for fields outside that set are skipped.
 */
export function resolveHeaderField(
  label: string,
  acceptedFields: ReadonlySet<ImportFieldKey>,
): ImportFieldKey | null {
  const normalized = normalizeHeaderLabel(label);
  if (normalized.length === 0) return null;

  for (const key of Object.keys(IMPORT_HEADER_SYNONYMS) as ImportFieldKey[]) {
    if (!acceptedFields.has(key)) continue;
    const synonyms = IMPORT_HEADER_SYNONYMS[key];
    for (const synonym of synonyms) {
      if (normalizeHeaderLabel(synonym) === normalized) {
        return key;
      }
    }
  }
  return null;
}

/** The canonical header label for a field (first synonym), used by templates. */
export function canonicalHeaderFor(field: ImportFieldKey): string {
  return IMPORT_HEADER_SYNONYMS[field][0];
}
