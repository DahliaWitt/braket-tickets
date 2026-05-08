import {describe, it, expect, vi, afterEach} from 'vitest';
import {
  EVENT_DATE_TIME_ZONE,
  toDateKeyInEventTimeZone,
  normalizeToDateKey,
  todayDateKey,
  startOfDateKeyInEventTimeZone,
  startOfTodayInEventTimeZone,
  hasEventDatePassed,
} from './timezone';

describe('timezone utilities', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('EVENT_DATE_TIME_ZONE', () => {
    it('should be America/Los_Angeles', () => {
      expect(EVENT_DATE_TIME_ZONE).toBe('America/Los_Angeles');
    });
  });

  describe('toDateKeyInEventTimeZone', () => {
    it('should format a Date into YYYY-MM-DD in America/Los_Angeles', () => {
      // 2026-03-15 noon UTC is still 2026-03-15 in LA (UTC-7 PDT)
      const date = new Date('2026-03-15T12:00:00Z');
      expect(toDateKeyInEventTimeZone(date)).toBe('2026-03-15');
    });

    it('should roll back to previous day when UTC is past midnight but LA is not', () => {
      // 2026-02-27T07:30:00Z => 2026-02-26 23:30 in America/Los_Angeles (UTC-8 PST)
      const date = new Date('2026-02-27T07:30:00Z');
      expect(toDateKeyInEventTimeZone(date)).toBe('2026-02-26');
    });

    it('should stay on same day when UTC midnight has not crossed', () => {
      // 2026-02-26T20:00:00Z => 2026-02-26 12:00 in America/Los_Angeles
      const date = new Date('2026-02-26T20:00:00Z');
      expect(toDateKeyInEventTimeZone(date)).toBe('2026-02-26');
    });
  });

  describe('normalizeToDateKey', () => {
    it('should convert noon-UTC ISO timestamps to the same LA calendar day', () => {
      // Noon UTC => 4am/5am LA => same calendar day in LA
      expect(normalizeToDateKey('2026-01-15T12:00:00.000Z')).toBe('2026-01-15');
      expect(normalizeToDateKey('2025-12-31T12:00:00.000Z')).toBe('2025-12-31');
    });

    it('should convert ISO-8601 timestamps via platform timezone', () => {
      // 2026-02-27T07:30:00Z => 2026-02-26 in LA
      expect(normalizeToDateKey('2026-02-27T07:30:00.000Z')).toBe('2026-02-26');
    });

    it('should throw on invalid date strings', () => {
      expect(() => normalizeToDateKey('not-a-date')).toThrow(
        'Invalid event date format',
      );
    });

    it('should throw on date-only input (fail loud, not silent off-by-one)', () => {
      expect(() => normalizeToDateKey('2026-06-15')).toThrow(
        'Date-only input not supported',
      );
    });
  });

  describe('todayDateKey', () => {
    it('should return today in America/Los_Angeles timezone', () => {
      vi.useFakeTimers();
      // Set to 2026-03-20T10:00:00Z => 2026-03-20 03:00 in LA (PDT)
      vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));
      expect(todayDateKey()).toBe('2026-03-20');
    });

    it('should return previous day when UTC is ahead of LA', () => {
      vi.useFakeTimers();
      // 2026-03-21T06:00:00Z => 2026-03-20 23:00 in LA (PDT, UTC-7)
      vi.setSystemTime(new Date('2026-03-21T06:00:00Z'));
      expect(todayDateKey()).toBe('2026-03-20');
    });
  });

  describe('startOfDateKeyInEventTimeZone', () => {
    it('should return LA midnight as UTC for a regular PDT day', () => {
      expect(startOfDateKeyInEventTimeZone('2026-06-01')).toBe(
        '2026-06-01T07:00:00.000Z',
      );
    });

    it('should return LA midnight as UTC across spring-forward DST', () => {
      expect(startOfDateKeyInEventTimeZone('2026-03-08')).toBe(
        '2026-03-08T08:00:00.000Z',
      );
    });

    it('should return LA midnight as UTC across fall-back DST', () => {
      expect(startOfDateKeyInEventTimeZone('2026-11-01')).toBe(
        '2026-11-01T07:00:00.000Z',
      );
    });
  });

  describe('startOfTodayInEventTimeZone', () => {
    it("should derive today's LA midnight from the current clock", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T20:00:00.000Z'));
      expect(startOfTodayInEventTimeZone()).toBe('2026-06-01T07:00:00.000Z');
    });
  });

  describe('hasEventDatePassed', () => {
    // Event rows store full ISO timestamps; use noon UTC so the LA calendar
    // day matches the intended event date across DST.
    const iso = (dateKey: string) => `${dateKey}T12:00:00.000Z`;

    it('should return false on event day', () => {
      vi.useFakeTimers();
      // 2026-06-15T20:00:00Z => 2026-06-15 13:00 in LA (PDT)
      vi.setSystemTime(new Date('2026-06-15T20:00:00Z'));
      expect(hasEventDatePassed(iso('2026-06-15'))).toBe(false);
    });

    it('should return false on day before event', () => {
      vi.useFakeTimers();
      // 2026-06-14T20:00:00Z => 2026-06-14 13:00 in LA
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'));
      expect(hasEventDatePassed(iso('2026-06-15'))).toBe(false);
    });

    it('should return true on day after event', () => {
      vi.useFakeTimers();
      // 2026-06-16T20:00:00Z => 2026-06-16 13:00 in LA
      vi.setSystemTime(new Date('2026-06-16T20:00:00Z'));
      expect(hasEventDatePassed(iso('2026-06-15'))).toBe(true);
    });

    it('should return false when UTC crossed midnight but LA has not (the original bug)', () => {
      vi.useFakeTimers();
      // 2026-02-27T07:30:00Z => 2026-02-26 23:30 in LA (PST, UTC-8)
      // Event date is 2026-02-27 => event is "tomorrow" in LA, should NOT be past
      vi.setSystemTime(new Date('2026-02-27T07:30:00Z'));
      expect(hasEventDatePassed(iso('2026-02-27'))).toBe(false);
    });

    it('should return true when LA has also crossed midnight past event day', () => {
      vi.useFakeTimers();
      // 2026-02-28T08:01:00Z => 2026-02-28 00:01 in LA (PST)
      // Event date was 2026-02-27 => event is yesterday in LA
      vi.setSystemTime(new Date('2026-02-28T08:01:00Z'));
      expect(hasEventDatePassed(iso('2026-02-27'))).toBe(true);
    });

    it('should handle DST transition (spring forward)', () => {
      vi.useFakeTimers();
      // Spring forward 2026: Mar 8, 2:00 AM -> 3:00 AM
      // 2026-03-08T10:00:00Z => 2026-03-08 03:00 in LA (PDT, UTC-7)
      vi.setSystemTime(new Date('2026-03-08T10:00:00Z'));
      expect(hasEventDatePassed(iso('2026-03-08'))).toBe(false);
      expect(hasEventDatePassed(iso('2026-03-07'))).toBe(true);
    });

    it('should handle DST transition (fall back)', () => {
      vi.useFakeTimers();
      // Fall back 2026: Nov 1, 2:00 AM -> 1:00 AM
      // 2026-11-01T09:00:00Z => 2026-11-01 01:00 in LA (PST, UTC-8)
      vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
      expect(hasEventDatePassed(iso('2026-11-01'))).toBe(false);
      expect(hasEventDatePassed(iso('2026-10-31'))).toBe(true);
    });
  });
});
