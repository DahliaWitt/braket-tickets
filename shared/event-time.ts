export const DEFAULT_EVENT_TIME_ZONE = 'America/Los_Angeles';

export interface EventTimeOptions {
  timeZone?: string;
  now?: Date;
}

export interface EventLocalParts {
  dateKey: string;
  time: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

type EventTimeInput = string | number | Date;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_UTC_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function hasDateKeyShape(value: string): boolean {
  return DATE_KEY_PATTERN.test(value);
}

export function assertIanaTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone}).format(new Date(0));
    return timeZone;
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

function resolveTimeZone(options?: EventTimeOptions): string {
  return assertIanaTimeZone(options?.timeZone ?? DEFAULT_EVENT_TIME_ZONE);
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function getFormatterPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value !== undefined) return value;
  throw new Error(`Missing formatter part: ${type}`);
}

function toDate(value: EventTimeInput): Date | null {
  if (typeof value === 'string' && hasDateKeyShape(value)) {
    return null;
  }
  if (typeof value === 'string') return parseUtcInstant(value);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDateKey(value: string): boolean {
  return parseDateKey(value) !== null;
}

export function parseUtcInstant(value: string): Date | null {
  const match = ISO_UTC_INSTANT_PATTERN.exec(value);
  if (!match) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    msText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = msText === undefined ? 0 : Number(msText.padEnd(3, '0'));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  return date;
}

export function dateKeyToLocalDate(dateKey: string): Date | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

export function toDateKeyInEventTimeZone(
  value: Date,
  options?: EventTimeOptions,
): string {
  const timeZone = resolveTimeZone(options);
  const parts = getDateTimeFormatter(timeZone).formatToParts(value);
  const year = getFormatterPart(parts, 'year');
  const month = getFormatterPart(parts, 'month');
  const day = getFormatterPart(parts, 'day');
  return `${year}-${month}-${day}`;
}

export function formatEventDateKey(
  value: EventTimeInput,
  options?: EventTimeOptions,
): string | null {
  if (typeof value === 'string' && isDateKey(value)) return value;
  if (typeof value === 'string' && hasDateKeyShape(value)) return null;

  const date = toDate(value);
  if (!date) return null;
  return toDateKeyInEventTimeZone(date, options);
}

export function todayDateKey(options?: EventTimeOptions): string {
  return toDateKeyInEventTimeZone(options?.now ?? new Date(), options);
}

export function utcToEventLocalParts(
  value: EventTimeInput,
  options?: EventTimeOptions,
): EventLocalParts | null {
  const date = toDate(value);
  if (!date) return null;

  const timeZone = resolveTimeZone(options);
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const year = getFormatterPart(parts, 'year');
  const month = getFormatterPart(parts, 'month');
  const day = getFormatterPart(parts, 'day');
  const hour = getFormatterPart(parts, 'hour');
  const minute = getFormatterPart(parts, 'minute');
  const second = getFormatterPart(parts, 'second');

  return {
    dateKey: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

/**
 * Returns the event start instant in milliseconds.
 *
 * Persisted event dates should be strict ISO UTC instants. Date-only
 * `YYYY-MM-DD` input is accepted only as a deterministic legacy-data fallback
 * and resolves to midnight at the start of that calendar day in the event
 * timezone.
 */
export function eventStartInstantMs(
  value: EventTimeInput,
  options?: EventTimeOptions,
): number | null {
  if (typeof value === 'string' && isDateKey(value)) {
    return new Date(startOfDateKeyInEventTimeZone(value, options)).getTime();
  }
  if (typeof value === 'string' && hasDateKeyShape(value)) return null;

  const date = toDate(value);
  return date?.getTime() ?? null;
}

export function startOfDateKeyInEventTimeZone(
  dateKey: string,
  options?: EventTimeOptions,
): string {
  const parsedDateKey = parseDateKey(dateKey);
  if (!parsedDateKey) {
    throw new Error(
      `Invalid date key: "${dateKey}". Expected YYYY-MM-DD in ${resolveTimeZone(options)}.`,
    );
  }

  const timeZone = resolveTimeZone(options);
  const desiredUtc = Date.UTC(
    parsedDateKey.year,
    parsedDateKey.month - 1,
    parsedDateKey.day,
    0,
    0,
    0,
    0,
  );
  let candidateUtc = desiredUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const renderedParts = utcToEventLocalParts(new Date(candidateUtc), options);
    if (!renderedParts) break;

    const renderedUtc = Date.UTC(
      Number(renderedParts.year),
      Number(renderedParts.month) - 1,
      Number(renderedParts.day),
      Number(renderedParts.hour),
      Number(renderedParts.minute),
      Number(renderedParts.second),
      0,
    );
    const diff = desiredUtc - renderedUtc;
    if (diff === 0) return new Date(candidateUtc).toISOString();
    candidateUtc += diff;
  }

  throw new Error(
    `Could not resolve start of day for "${dateKey}" in ${timeZone}.`,
  );
}

export function startOfTodayInEventTimeZone(
  options?: EventTimeOptions,
): string {
  return startOfDateKeyInEventTimeZone(todayDateKey(options), options);
}

export function hasEventDatePassed(
  startsAtUtc: string,
  options?: EventTimeOptions,
): boolean {
  const eventDateKey = formatEventDateKey(startsAtUtc, options);
  if (!eventDateKey) {
    throw new Error(`Invalid event date format: "${startsAtUtc}"`);
  }
  return eventDateKey < todayDateKey(options);
}

export function eventLocalDateTimeToUtc(
  dateKey: string,
  time: string,
  options?: EventTimeOptions,
): string {
  const parsedDateKey = parseDateKey(dateKey);
  if (!parsedDateKey) {
    throw new Error(`Invalid event date key: "${dateKey}"`);
  }

  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) {
    throw new Error(`Invalid event time: "${time}". Expected HH:mm.`);
  }

  const [, hours, minutes] = timeMatch;
  const desiredUtc = Date.UTC(
    parsedDateKey.year,
    parsedDateKey.month - 1,
    parsedDateKey.day,
    Number(hours),
    Number(minutes),
    0,
    0,
  );
  let candidateUtc = desiredUtc;
  const timeZone = resolveTimeZone(options);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = utcToEventLocalParts(new Date(candidateUtc), options);
    if (!parts) break;

    const renderedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    const diff = desiredUtc - renderedUtc;
    if (diff === 0) return new Date(candidateUtc).toISOString();
    candidateUtc += diff;
  }

  throw new Error(
    `Could not resolve event time in ${timeZone}: ${dateKey} ${time}`,
  );
}

function parseDateKey(
  dateKey: string,
): {year: number; month: number; day: number} | null {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return {year, month, day};
}
