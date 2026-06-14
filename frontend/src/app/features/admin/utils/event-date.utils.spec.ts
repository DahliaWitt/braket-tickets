import {describe, expect, it} from 'vitest';
import {
  combineLocalEventDateTime,
  compareEventDatesDescending,
  formatEventTimeInput,
  isLocalEventDateTimeValid,
  parseEventDate,
  parseEventDateInEventTimeZone,
} from './event-date.utils';

describe('event date utilities', () => {
  it('parses ISO event dates using the platform event timezone', () => {
    expect(parseEventDate('2026-02-27T07:30:00.000Z')).toEqual(
      new Date(2026, 1, 26),
    );
  });

  it('sorts event dates by platform calendar day', () => {
    expect(
      compareEventDatesDescending(
        '2026-02-27T07:30:00.000Z',
        '2026-02-27T20:00:00.000Z',
      ),
    ).toBeGreaterThan(0);
  });

  it('keeps date-only values as literal local calendar dates', () => {
    expect(parseEventDate('2026-02-27')).toEqual(new Date(2026, 1, 27));
  });

  it('rejects invalid date-only values instead of normalizing them', () => {
    expect(parseEventDate('2026-02-31')).toBeNull();
    expect(parseEventDateInEventTimeZone('2026-02-31')).toBeNull();
    expect(formatEventTimeInput('2026-02-31')).toBe('20:00');
  });

  it('rejects raw Date strings so event sorting cannot use browser-local parsing', () => {
    expect(parseEventDate('Dec 15, 2030')).toBeNull();
  });

  it('formats UTC instants as event-local time inputs', () => {
    expect(formatEventTimeInput('2026-02-27T07:30:00.000Z')).toBe('23:30');
  });

  it('parses UTC instants as event-local calendar dates for forms', () => {
    expect(parseEventDateInEventTimeZone('2026-02-27T07:30:00.000Z')).toEqual(
      new Date(2026, 1, 26),
    );
  });

  it('combines event-local form date and time into a UTC instant', () => {
    expect(
      combineLocalEventDateTime(new Date(2026, 1, 26), '23:30').toISOString(),
    ).toBe('2026-02-27T07:30:00.000Z');
  });

  it('rejects nonexistent event-local times during spring-forward DST', () => {
    expect(isLocalEventDateTimeValid(new Date(2027, 2, 14), '02:30')).toBe(
      false,
    );
    expect(isLocalEventDateTimeValid(new Date(2027, 2, 14), '03:30')).toBe(
      true,
    );
  });
});
