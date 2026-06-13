import {describe, expect, it} from 'vitest';
import {
  DEFAULT_EVENT_TIME_ZONE,
  assertIanaTimeZone,
  dateKeyToLocalDate,
  eventStartInstantMs,
  eventLocalDateTimeToUtc,
  formatEventDateKey,
  hasEventDatePassed,
  isDateKey,
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
