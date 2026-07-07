import {
  DEFAULT_EVENT_TIME_ZONE,
  formatEventDateKey,
  hasEventDatePassed as hasEventDatePassedShared,
  hasEventEnded as hasEventEndedShared,
  isDateKey,
  startOfDateKeyInEventTimeZone as startOfDateKeyInEventTimeZoneShared,
  startOfTodayInEventTimeZone as startOfTodayInEventTimeZoneShared,
  todayDateKey as todayDateKeyShared,
  toDateKeyInEventTimeZone as toDateKeyInEventTimeZoneShared,
} from '@shared/event-time';

/**
 * Platform-wide timezone constants and date utilities.
 *
 * New event writes store ISO 8601 UTC strings with a time component
 * (e.g. `2026-12-15T20:00:00.000Z`). Runtime event-day checks also accept
 * legacy date-only `YYYY-MM-DD` rows and interpret them in the platform
 * timezone.
 * Event-day boundaries follow the platform's published timezone
 * (`America/Los_Angeles`) rather than UTC to avoid false "already occurred"
 * rejections after UTC midnight.
 */

// TODO: Support per-event or per-organizer timezones instead of a single global default.
/** Canonical timezone for interpreting event date boundaries. */
export const EVENT_DATE_TIME_ZONE = DEFAULT_EVENT_TIME_ZONE;

/** Convert a Date to a `YYYY-MM-DD` string in the platform timezone. */
export function toDateKeyInEventTimeZone(value: Date): string {
  return toDateKeyInEventTimeZoneShared(value);
}

/**
 * Normalize a full ISO-8601 UTC event date to a `YYYY-MM-DD` key in the
 * platform timezone. Date-only (`YYYY-MM-DD`) input is not supported — events
 * are required to store a time component at create time.
 *
 * @throws {Error} if the value is not a valid date string
 */
export function normalizeToDateKey(value: string): string {
  if (isDateKey(value)) {
    throw new Error(
      `Date-only input not supported: "${value}". Expected full ISO 8601 UTC (e.g. 2026-12-15T20:00:00.000Z).`,
    );
  }

  const dateKey = formatEventDateKey(value);
  if (dateKey) return dateKey;

  throw new Error(`Invalid event date format: "${value}"`);
}

/** Returns today's date key (`YYYY-MM-DD`) in the platform timezone. */
export function todayDateKey(): string {
  return todayDateKeyShared();
}

/**
 * Returns the UTC ISO timestamp for midnight at the start of the provided
 * calendar day in the platform timezone.
 */
export function startOfDateKeyInEventTimeZone(dateKey: string): string {
  return startOfDateKeyInEventTimeZoneShared(dateKey);
}

/** Returns today's midnight boundary as a full UTC ISO timestamp in the platform timezone. */
export function startOfTodayInEventTimeZone(): string {
  return startOfTodayInEventTimeZoneShared();
}

/** Returns true if the given event date is strictly before today in the platform timezone. */
export function hasEventDatePassed(eventDate: string): boolean {
  return hasEventDatePassedShared(eventDate);
}

/**
 * Returns true once the event is over: past its explicit end instant when
 * `endDate` is set, otherwise past midnight (platform timezone) after its
 * start date. Prefer this over hasEventDatePassed for purchase/resale gating
 * so overnight events stay open through their actual end time.
 */
export function hasEventEnded(event: {
  date: string;
  endDate?: string;
}): boolean {
  return hasEventEndedShared(event.date, event.endDate);
}
