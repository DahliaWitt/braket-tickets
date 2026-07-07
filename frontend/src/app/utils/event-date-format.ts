import {
  DEFAULT_EVENT_TIME_ZONE,
  dateKeyToLocalDate as sharedDateKeyToLocalDate,
  eventLocalDayDiff,
  eventStartInstantMs,
  formatEventDateKey as sharedFormatEventDateKey,
  isEventOvernightWrap,
  parseUtcInstant,
  todayDateKey,
} from '@shared/event-time';

export const EVENT_DATE_TIME_ZONE = DEFAULT_EVENT_TIME_ZONE;
export const EVENT_DATE_LOCALE = 'en-US';

const eventDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getEventDateFormatter(
  format: string,
): Intl.DateTimeFormat | undefined {
  const cached = eventDateFormatters.get(format);
  if (cached) return cached;

  const options = eventDateFormatOptions(format);
  if (!options) return undefined;

  const formatter = new Intl.DateTimeFormat(EVENT_DATE_LOCALE, {
    timeZone: EVENT_DATE_TIME_ZONE,
    ...options,
  });
  eventDateFormatters.set(format, formatter);
  return formatter;
}

function eventDateFormatOptions(
  format: string,
): Intl.DateTimeFormatOptions | undefined {
  switch (format) {
    case 'mediumDate':
      return {year: 'numeric', month: 'short', day: 'numeric'};
    case 'longDate':
      return {year: 'numeric', month: 'long', day: 'numeric'};
    case 'fullDate':
      return {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      };
    case 'shortTime':
      return {hour: 'numeric', minute: '2-digit'};
    case 'HH:mm':
      return {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};
    case 'HH:mm:ss':
      return {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      };
    default:
      return undefined;
  }
}

export function formatEventDate(
  value: string | number | Date | null | undefined,
  format = 'mediumDate',
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    const normalizedValue =
      typeof value === 'string' ? eventStartInstantMs(value) : value;
    if (normalizedValue === null) return null;
    return getEventDateFormatter(format)?.format(normalizedValue) ?? null;
  } catch {
    return null;
  }
}

/**
 * Suffix appended after an event's rendered start time to show its end.
 * Same day or a genuine overnight wrap (next calendar day at an earlier clock
 * time, like 9pm–3am) shows only the end time — e.g. ' – 3:00 AM'. Multi-day
 * events — including a next-day end at a later clock time (a 24h+ span) —
 * include the end date — e.g. ' – Aug 3, 2:00 AM' — so the span is
 * unambiguous. Returns '' when endDate is missing, unparseable, or not after
 * the start, so templates can append it unconditionally.
 */
export function formatEventEndTimeSuffix(
  endDate: string | null | undefined,
  startDate: string | number | Date | null | undefined,
): string {
  if (!endDate || startDate === null || startDate === undefined) return '';

  const startMs =
    typeof startDate === 'string'
      ? eventStartInstantMs(startDate)
      : new Date(startDate).getTime();
  const endMs = parseUtcInstant(endDate)?.getTime() ?? null;
  if (
    startMs === null ||
    Number.isNaN(startMs) ||
    endMs === null ||
    endMs <= startMs
  ) {
    return '';
  }

  const endTime = formatEventDate(endMs, 'shortTime');
  if (!endTime) return '';

  if (
    eventLocalDayDiff(startMs, endMs) === 0 ||
    isEventOvernightWrap(startMs, endMs)
  ) {
    return ` – ${endTime}`;
  }

  const endDay = formatEventDate(endMs, 'mediumDate');
  return endDay ? ` – ${endDay}, ${endTime}` : ` – ${endTime}`;
}

export function formatEventDateKey(
  value: string | number | Date | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  return sharedFormatEventDateKey(value);
}

export function dateKeyToLocalDate(dateKey: string): Date | null {
  return sharedDateKeyToLocalDate(dateKey);
}

export function getTodayInEventTimeZone(now: Date = new Date()): Date {
  const date = dateKeyToLocalDate(todayDateKey({now}));
  if (!date) {
    throw new Error(
      `Could not resolve current date in ${EVENT_DATE_TIME_ZONE}`,
    );
  }
  return date;
}
