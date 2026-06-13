import {formatDate} from '@angular/common';
import {
  DEFAULT_EVENT_TIME_ZONE,
  dateKeyToLocalDate as sharedDateKeyToLocalDate,
  eventStartInstantMs,
  formatEventDateKey as sharedFormatEventDateKey,
  todayDateKey,
} from '@shared/event-time';

export const EVENT_DATE_TIME_ZONE = DEFAULT_EVENT_TIME_ZONE;
export const EVENT_DATE_LOCALE = 'en-US';

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
    return formatDate(
      normalizedValue,
      format,
      EVENT_DATE_LOCALE,
      EVENT_DATE_TIME_ZONE,
    );
  } catch {
    return null;
  }
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
