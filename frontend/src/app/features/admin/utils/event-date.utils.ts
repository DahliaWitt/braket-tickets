/**
 * Parses various date string formats into a local-midnight Date.
 * Handles YYYY-MM-DD, ISO strings, and raw Date strings.
 * Returns null for invalid/empty input.
 */
export function parseEventDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const monthIndex = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    const date = new Date(year, monthIndex, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Try to extract YYYY-MM-DD from ISO string (e.g., "2025-01-17T12:34:56.789Z")
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const monthIndex = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const date = new Date(year, monthIndex, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Fallback to parsing as Date
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // Normalize to local date (remove time component) to avoid timezone issues
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Compare two event dates for descending sort order.
 * Invalid values are sorted last.
 */
export function compareEventDatesDescending(a: string, b: string): number {
  const left = parseEventDate(a)?.getTime();
  const right = parseEventDate(b)?.getTime();

  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

/** Formats a Date to ISO string for the API. */
export function formatDateYmd(date: Date): string {
  return date.toISOString();
}

/** Compare two nullable Date values by time value (avoids reference equality pitfall). */
export function isDateDirty(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a.getTime() !== b.getTime();
}
