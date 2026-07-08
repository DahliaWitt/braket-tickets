/**
 * Escapes a single cell for CSV output.
 *
 * Two concerns, applied to EVERY cell:
 * 1. Formula injection — a cell beginning with `=`, `+`, `-`, or `@` is treated
 *    as a formula by Excel/Sheets/LibreOffice. External ticket-holder names come
 *    from an outside platform and are attacker-controllable (e.g.
 *    `=HYPERLINK(...)`); a native buyer name could also start with one of those
 *    characters. A leading apostrophe forces the app to render the cell as text.
 *    We apply this before quote-wrapping so the apostrophe lands inside quotes.
 * 2. Structural escaping — cells containing a comma, quote, or newline are
 *    wrapped in double quotes with internal quotes doubled.
 */
export function escapeCsvValue(value: string): string {
  const formulaSafe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (
    formulaSafe.includes(',') ||
    formulaSafe.includes('"') ||
    formulaSafe.includes('\n')
  ) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

export function formatExportDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function sanitizeFilenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateDatedExportFilename(
  title: string,
  suffix: string,
  extension: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFilenamePart(title)}-${suffix}-${date}.${extension}`;
}
