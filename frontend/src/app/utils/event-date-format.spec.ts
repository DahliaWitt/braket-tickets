import {describe, expect, it} from 'vitest';
import {
  dateKeyToLocalDate,
  formatEventDate,
  formatEventDateKey,
  formatEventEndTimeSuffix,
  getTodayInEventTimeZone,
} from './event-date-format';

function normalizeSpaces(value: string | null): string | null {
  return value?.replace(/\s+/g, ' ') ?? null;
}

describe('formatEventDate', () => {
  it('formats event dates in the platform Los Angeles timezone', () => {
    const eventDate = '2026-02-27T07:30:00.000Z';

    expect(formatEventDate(eventDate, 'mediumDate')).toBe('Feb 26, 2026');
    expect(normalizeSpaces(formatEventDate(eventDate, 'shortTime'))).toBe(
      '11:30 PM',
    );
    expect(formatEventDate(eventDate, 'fullDate')).toBe(
      'Thursday, February 26, 2026',
    );
  });

  it('returns null for invalid dates', () => {
    expect(formatEventDate('not-a-date', 'mediumDate')).toBeNull();
    expect(formatEventDate('2026-02-31', 'mediumDate')).toBeNull();
    expect(
      formatEventDate('2026-02-31T08:00:00.000Z', 'mediumDate'),
    ).toBeNull();
    expect(formatEventDate('2026-02-26T08:00:00', 'mediumDate')).toBeNull();
  });

  it('formats calendar date keys in the platform timezone', () => {
    expect(formatEventDateKey('2026-02-27T07:30:00.000Z')).toBe('2026-02-26');
  });

  it('returns today as a local Date for the platform timezone calendar day', () => {
    expect(
      getTodayInEventTimeZone(new Date('2026-02-27T06:30:00.000Z')),
    ).toEqual(new Date(2026, 1, 26));
  });

  it('parses date keys into local calendar dates', () => {
    expect(dateKeyToLocalDate('2026-02-26')).toEqual(new Date(2026, 1, 26));
    expect(dateKeyToLocalDate('not-a-date')).toBeNull();
  });
});

describe('formatEventEndTimeSuffix', () => {
  it('renders a same-day end as a bare time suffix', () => {
    // 8pm – 11pm Feb 26 event-local
    expect(
      normalizeSpaces(
        formatEventEndTimeSuffix(
          '2026-02-27T07:00:00.000Z',
          '2026-02-27T04:00:00.000Z',
        ),
      ),
    ).toBe(' – 11:00 PM');
  });

  it('renders a next-day overnight end as a bare time (no end date)', () => {
    // 10pm Feb 26 – 6am Feb 27 event-local (an overnight party)
    expect(
      normalizeSpaces(
        formatEventEndTimeSuffix(
          '2026-02-27T14:00:00.000Z',
          '2026-02-27T06:00:00.000Z',
        ),
      ),
    ).toBe(' – 6:00 AM');
  });

  it('includes the end date for multi-day events', () => {
    // 10pm Feb 26 – 8pm Feb 28 event-local (a multi-day span)
    expect(
      normalizeSpaces(
        formatEventEndTimeSuffix(
          '2026-03-01T04:00:00.000Z',
          '2026-02-27T06:00:00.000Z',
        ),
      ),
    ).toBe(' – Feb 28, 2026, 8:00 PM');
  });

  it('returns an empty suffix for missing, invalid, or non-positive windows', () => {
    expect(
      formatEventEndTimeSuffix(undefined, '2026-02-27T04:00:00.000Z'),
    ).toBe('');
    expect(formatEventEndTimeSuffix(null, '2026-02-27T04:00:00.000Z')).toBe('');
    expect(
      formatEventEndTimeSuffix('not-a-date', '2026-02-27T04:00:00.000Z'),
    ).toBe('');
    expect(formatEventEndTimeSuffix('2026-02-27T07:00:00.000Z', null)).toBe('');
    // End at or before the start renders nothing.
    expect(
      formatEventEndTimeSuffix(
        '2026-02-27T04:00:00.000Z',
        '2026-02-27T04:00:00.000Z',
      ),
    ).toBe('');
    expect(
      formatEventEndTimeSuffix(
        '2026-02-27T02:00:00.000Z',
        '2026-02-27T04:00:00.000Z',
      ),
    ).toBe('');
  });
});
