/**
 * Platform-wide timezone constants and date utilities.
 *
 * Event dates are stored as ISO 8601 UTC strings with a time component
 * (e.g. `2026-12-15T20:00:00.000Z`). Date-only `YYYY-MM-DD` input is not
 * supported — `validateCreateEventInput` rejects it at create time.
 * Event-day boundaries follow the platform's published timezone
 * (`America/Los_Angeles`) rather than UTC to avoid false "already occurred"
 * rejections after UTC midnight.
 */

// TODO: Support per-event or per-organizer timezones instead of a single global default.
/** Canonical timezone for interpreting event date boundaries. */
export const EVENT_DATE_TIME_ZONE = 'America/Los_Angeles';

// Fail-loud guard: date-only input parses as UTC midnight and silently shifts
// to the prior calendar day in US timezones. Throw instead of returning a
// wrong answer so legacy rows surface loudly rather than corrupt downstream math.
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_DATE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_DATE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getFormatterPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value !== undefined) {
    return value;
  }

  throw new Error(`Missing formatter part: ${type}`);
}

/** Convert a Date to a `YYYY-MM-DD` string in the platform timezone. */
export function toDateKeyInEventTimeZone(value: Date): string {
  const parts = dateKeyFormatter.formatToParts(value);
  const year = getFormatterPart(parts, 'year');
  const month = getFormatterPart(parts, 'month');
  const day = getFormatterPart(parts, 'day');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize a full ISO-8601 UTC event date to a `YYYY-MM-DD` key in the
 * platform timezone. Date-only (`YYYY-MM-DD`) input is not supported — events
 * are required to store a time component at create time.
 *
 * @throws {Error} if the value is not a valid date string
 */
export function normalizeToDateKey(value: string): string {
  if (DATE_ONLY_REGEX.test(value)) {
    throw new Error(
      `Date-only input not supported: "${value}". Expected full ISO 8601 UTC (e.g. 2026-12-15T20:00:00.000Z).`,
    );
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return toDateKeyInEventTimeZone(parsed);

  throw new Error(`Invalid event date format: "${value}"`);
}

/** Returns today's date key (`YYYY-MM-DD`) in the platform timezone. */
export function todayDateKey(): string {
  return toDateKeyInEventTimeZone(new Date());
}

/**
 * Returns the UTC ISO timestamp for midnight at the start of the provided
 * calendar day in the platform timezone.
 */
export function startOfDateKeyInEventTimeZone(dateKey: string): string {
  if (!DATE_ONLY_REGEX.test(dateKey)) {
    throw new Error(
      `Invalid date key: "${dateKey}". Expected YYYY-MM-DD in ${EVENT_DATE_TIME_ZONE}.`,
    );
  }

  const [year, month, day] = dateKey.split('-').map(Number);
  const desiredUtc = Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0);
  let candidateUtc = desiredUtc;

  // Iteratively adjust a UTC candidate until formatting it in the platform
  // timezone lands exactly on the requested local midnight. This keeps DST
  // boundaries correct without relying on Temporal.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeFormatter.formatToParts(new Date(candidateUtc));
    const renderedUtc = Date.UTC(
      Number(getFormatterPart(parts, 'year')),
      Number(getFormatterPart(parts, 'month')) - 1,
      Number(getFormatterPart(parts, 'day')),
      Number(getFormatterPart(parts, 'hour')),
      Number(getFormatterPart(parts, 'minute')),
      Number(getFormatterPart(parts, 'second')),
      0,
    );
    const diff = desiredUtc - renderedUtc;
    if (diff === 0) {
      return new Date(candidateUtc).toISOString();
    }
    candidateUtc += diff;
  }

  throw new Error(
    `Could not resolve start of day for "${dateKey}" in ${EVENT_DATE_TIME_ZONE}.`,
  );
}

/** Returns today's midnight boundary as a full UTC ISO timestamp in the platform timezone. */
export function startOfTodayInEventTimeZone(): string {
  return startOfDateKeyInEventTimeZone(todayDateKey());
}

/** Returns true if the given event date is strictly before today in the platform timezone. */
export function hasEventDatePassed(eventDate: string): boolean {
  return normalizeToDateKey(eventDate) < todayDateKey();
}
