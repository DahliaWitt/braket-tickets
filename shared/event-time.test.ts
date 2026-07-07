import {describe, expect, it} from 'vitest';
import {
  DEFAULT_EVENT_TIME_ZONE,
  assertIanaTimeZone,
  dateKeyToLocalDate,
  eventEndInstantMs,
  eventStartInstantMs,
  eventLocalDateTimeToUtc,
  formatEventDateKey,
  hasEventDatePassed,
  hasEventEnded,
  isDateKey,
  isEventHappeningNow,
  parseUtcInstant,
  startOfDateKeyInEventTimeZone,
  todayDateKey,
  utcToEventLocalParts,
} from './event-time';

describe('event-time', () => {
  it('uses Los Angeles as the default event timezone', () => {
    expect(DEFAULT_EVENT_TIME_ZONE).toBe('America/Los_Angeles');
  });

  it('validates IANA timezone names', () => {
    expect(assertIanaTimeZone('America/New_York')).toBe('America/New_York');
    expect(() => assertIanaTimeZone('Pacific Time')).toThrow(
      'Invalid IANA time zone',
    );
  });

  it('identifies date keys', () => {
    expect(isDateKey('2026-02-26')).toBe(true);
    expect(isDateKey('2026-02-26T08:00:00.000Z')).toBe(false);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-00-01')).toBe(false);
  });

  it('rejects date-only strings as UTC instants', () => {
    expect(parseUtcInstant('2026-02-26')).toBeNull();
    expect(parseUtcInstant('2026-02-31')).toBeNull();
    expect(parseUtcInstant('2026-02-26T08:00:00')).toBeNull();
    expect(parseUtcInstant('2026-02-26T08:00:00+00:00')).toBeNull();
    expect(parseUtcInstant('2026-02-31T08:00:00.000Z')).toBeNull();
    expect(parseUtcInstant('2026-02-26T08:00:00.000Z')?.toISOString()).toBe(
      '2026-02-26T08:00:00.000Z',
    );
  });

  it('formats date keys in the default event timezone', () => {
    expect(formatEventDateKey('2026-02-27T07:30:00.000Z')).toBe('2026-02-26');
    expect(formatEventDateKey('2026-02-26')).toBe('2026-02-26');
    expect(formatEventDateKey('2026-02-31')).toBeNull();
  });

  it('supports future per-event timezone options', () => {
    expect(
      formatEventDateKey('2026-02-27T07:30:00.000Z', {
        timeZone: 'America/New_York',
      }),
    ).toBe('2026-02-27');
  });

  it('converts UTC instants to event-local date and time parts', () => {
    expect(utcToEventLocalParts('2026-02-27T07:30:15.000Z')).toMatchObject({
      dateKey: '2026-02-26',
      time: '23:30',
      hour: '23',
      minute: '30',
      second: '15',
    });
  });

  it('normalizes event start instants without UTC-shifting date-only legacy rows', () => {
    expect(eventStartInstantMs('2026-02-27T07:30:00.000Z')).toBe(
      new Date('2026-02-27T07:30:00.000Z').getTime(),
    );
    expect(eventStartInstantMs('2026-02-26')).toBe(
      new Date('2026-02-26T08:00:00.000Z').getTime(),
    );
    expect(eventStartInstantMs('2026-02-31')).toBeNull();
  });

  it('resolves the event end instant, falling back to the start when no endDate', () => {
    const start = '2026-02-27T07:30:00.000Z';
    const end = '2026-03-01T06:00:00.000Z';
    // Explicit end wins.
    expect(eventEndInstantMs(start, end)).toBe(new Date(end).getTime());
    // No end -> start instant (legacy/single-day fallback).
    expect(eventEndInstantMs(start)).toBe(new Date(start).getTime());
    expect(eventEndInstantMs(start, null)).toBe(new Date(start).getTime());
    // Unparseable end -> start fallback; unparseable start -> null.
    expect(eventEndInstantMs(start, 'not-a-date')).toBe(
      new Date(start).getTime(),
    );
    expect(eventEndInstantMs('not-a-date')).toBeNull();
  });

  it('rejects date-only strings as UTC local-part inputs', () => {
    expect(utcToEventLocalParts('2026-02-26')).toBeNull();
    expect(utcToEventLocalParts('2026-02-31')).toBeNull();
  });

  it('parses date keys into local calendar Date objects', () => {
    expect(dateKeyToLocalDate('2026-02-26')).toEqual(new Date(2026, 1, 26));
    expect(dateKeyToLocalDate('not-a-date')).toBeNull();
    expect(dateKeyToLocalDate('2026-02-31')).toBeNull();
    expect(dateKeyToLocalDate('2024-02-29')).toEqual(new Date(2024, 1, 29));
    expect(dateKeyToLocalDate('2026-02-29')).toBeNull();
  });

  it('computes today in the event timezone', () => {
    expect(todayDateKey({now: new Date('2026-02-27T06:30:00.000Z')})).toBe(
      '2026-02-26',
    );
  });

  it('resolves event-local midnight to UTC across DST', () => {
    expect(startOfDateKeyInEventTimeZone('2026-06-01')).toBe(
      '2026-06-01T07:00:00.000Z',
    );
    expect(startOfDateKeyInEventTimeZone('2026-01-01')).toBe(
      '2026-01-01T08:00:00.000Z',
    );
  });

  it('rejects invalid date keys instead of normalizing them', () => {
    expect(() => startOfDateKeyInEventTimeZone('2026-02-31')).toThrow(
      'Invalid date key',
    );
    expect(() => eventLocalDateTimeToUtc('2026-02-31', '20:00')).toThrow(
      'Invalid event date key',
    );
  });

  it('checks whether an event date has passed by event-local day', () => {
    expect(
      hasEventDatePassed('2026-02-27T07:30:00.000Z', {
        now: new Date('2026-02-27T07:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      hasEventDatePassed('2026-02-27T07:30:00.000Z', {
        now: new Date('2026-02-28T08:01:00.000Z'),
      }),
    ).toBe(true);
  });

  it('ends events exactly at their explicit end instant', () => {
    const startsAt = '2026-02-27T06:00:00.000Z'; // 10pm Feb 26 event-local
    const endsAt = '2026-02-27T14:00:00.000Z'; // 6am Feb 27 event-local

    expect(
      hasEventEnded(startsAt, endsAt, {
        now: new Date('2026-02-27T13:59:00.000Z'),
      }),
    ).toBe(false);
    expect(
      hasEventEnded(startsAt, endsAt, {
        now: new Date('2026-02-27T14:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('falls back to event-local day granularity without an end instant', () => {
    const startsAt = '2026-02-27T06:00:00.000Z'; // 10pm Feb 26 event-local
    // Still Feb 26 event-local → not ended
    expect(
      hasEventEnded(startsAt, undefined, {
        now: new Date('2026-02-27T07:59:00.000Z'),
      }),
    ).toBe(false);
    // Past event-local midnight → ended
    expect(
      hasEventEnded(startsAt, null, {
        now: new Date('2026-02-27T08:01:00.000Z'),
      }),
    ).toBe(true);
    // Unparseable end instant also falls back
    expect(
      hasEventEnded(startsAt, 'not-a-date', {
        now: new Date('2026-02-27T07:59:00.000Z'),
      }),
    ).toBe(false);
  });

  it('reports happening-now inside the start/end window', () => {
    const startsAt = '2026-02-27T06:00:00.000Z'; // 10pm Feb 26 event-local
    const endsAt = '2026-02-27T14:00:00.000Z'; // 6am Feb 27 event-local

    expect(
      isEventHappeningNow(startsAt, endsAt, {
        now: new Date('2026-02-27T05:59:00.000Z'),
      }),
    ).toBe(false); // before doors
    expect(
      isEventHappeningNow(startsAt, endsAt, {
        now: new Date('2026-02-27T10:00:00.000Z'),
      }),
    ).toBe(true); // 2am event-local, mid-event past midnight
    expect(
      isEventHappeningNow(startsAt, endsAt, {
        now: new Date('2026-02-27T14:00:00.000Z'),
      }),
    ).toBe(false); // ended
  });

  it('reports happening-now for the rest of the start day without an end instant', () => {
    const startsAt = '2026-02-27T06:00:00.000Z'; // 10pm Feb 26 event-local

    expect(
      isEventHappeningNow(startsAt, undefined, {
        now: new Date('2026-02-27T07:00:00.000Z'),
      }),
    ).toBe(true); // 11pm event-local, same calendar day
    expect(
      isEventHappeningNow(startsAt, undefined, {
        now: new Date('2026-02-27T08:01:00.000Z'),
      }),
    ).toBe(false); // past event-local midnight fallback cutoff
  });

  it('converts event-local date and time to UTC', () => {
    expect(eventLocalDateTimeToUtc('2026-02-26', '23:30')).toBe(
      '2026-02-27T07:30:00.000Z',
    );
  });

  it('converts event-local date and time through DST boundaries', () => {
    expect(eventLocalDateTimeToUtc('2026-03-08', '03:30')).toBe(
      '2026-03-08T10:30:00.000Z',
    );
    expect(eventLocalDateTimeToUtc('2026-11-01', '01:30')).toBe(
      '2026-11-01T08:30:00.000Z',
    );
  });
});
