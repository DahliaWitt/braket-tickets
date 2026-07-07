import {
  dateKeyToLocalDate,
  eventLocalDateTimeToUtc,
  formatEventDateKey,
  isDateKey,
  todayDateKey,
  utcToEventLocalParts,
} from '@shared/event-time';

/**
 * Parses various date string formats into a local-midnight Date.
 * Handles YYYY-MM-DD and ISO UTC event dates in the platform event timezone.
 * Returns null for invalid/empty input.
 */
export function parseEventDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymdMatch) {
    return dateKeyToLocalDate(value);
  }

  const eventDateKey = formatEventDateKey(value);
  if (eventDateKey) {
    return dateKeyToLocalDate(eventDateKey);
  }

  return null;
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

/**
 * Whether the event's calendar day (platform event timezone) is before today.
 * Same cutoff as the backend's `hasEventDatePassed`, but null-safe: missing or
 * unparseable dates are treated as not past.
 */
export function isEventDatePast(value: string | null | undefined): boolean {
  if (!value) return false;
  const eventDateKey = formatEventDateKey(value);
  if (!eventDateKey) return false;
  return eventDateKey < todayDateKey();
}

/** Formats a Date to ISO string for the API. */
export function formatDateYmd(date: Date): string {
  return date.toISOString();
}

export function formatLocalDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatEventTimeInput(value: string | null | undefined): string {
  if (!value) return '20:00';
  if (isDateKey(value)) return '20:00';
  return utcToEventLocalParts(value)?.time ?? '20:00';
}

export function parseEventDateInEventTimeZone(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;

  if (isDateKey(value)) {
    return dateKeyToLocalDate(value);
  }

  const parts = utcToEventLocalParts(value);
  return parts ? dateKeyToLocalDate(parts.dateKey) : null;
}

export function combineLocalEventDateTime(date: Date, time: string): Date {
  return new Date(eventLocalDateTimeToUtc(formatLocalDateKey(date), time));
}

export function isLocalEventDateTimeValid(date: Date, time: string): boolean {
  try {
    eventLocalDateTimeToUtc(formatLocalDateKey(date), time);
    return true;
  } catch {
    return false;
  }
}

/** Compare two nullable Date values by time value (avoids reference equality pitfall). */
export function isDateDirty(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a.getTime() !== b.getTime();
}
