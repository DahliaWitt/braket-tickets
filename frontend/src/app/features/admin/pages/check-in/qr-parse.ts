export interface QRParseResult {
  ticketId: string | null;
  guestId: string | null;
}

/**
 * Parse QR scan data into a ticket or guest ID.
 *
 * Supported formats:
 * - `TICKET:<id>` — legacy prefix format
 * - `GUEST:<id>` — legacy prefix format
 * - URL with ID as last path segment (query params stripped)
 * - Raw ID string (treated as ticket ID)
 *
 * Returns null if input is empty/whitespace.
 */
export function parseQRScanData(scanData: string): QRParseResult | null {
  if (!scanData || !scanData.trim()) return null;
  const trimmed = scanData.trim();

  let ticketId: string | null = null;
  let guestId: string | null = null;

  if (trimmed.startsWith('TICKET:')) {
    ticketId = trimmed.slice('TICKET:'.length).trim();
  } else if (trimmed.startsWith('GUEST:')) {
    guestId = trimmed.slice('GUEST:'.length).trim();
  } else if (trimmed.includes('/')) {
    const parts = trimmed.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1]?.split('?')[0] ?? null;
    if (!lastPart || !lastPart.trim()) {
      return null;
    }
    ticketId = lastPart;
  } else {
    ticketId = trimmed;
  }

  return { ticketId, guestId };
}
