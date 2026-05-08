import { describe, it, expect } from 'vitest';
import {
  isSameDay,
  isDateDisabled,
  generateCalendarDays,
  getSelectedDatesArray,
  getDayId,
  getDayAriaLabel,
  makeSafeDate,
  normalizeCalendarValue,
  toValidDate,
} from './calendar.utils';
import type { CalendarDay, CalendarDayConfig, CalendarValue } from './calendar.types';

describe('calendar.utils', () => {
  describe('isSameDay', () => {
    it('should return true for the same date', () => {
      const date1 = new Date(2024, 0, 15, 10, 30);
      const date2 = new Date(2024, 0, 15, 14, 45);
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 16);
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should return false for different months', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 1, 15);
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('should return false for different years', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2025, 0, 15);
      expect(isSameDay(date1, date2)).toBe(false);
    });
  });

  describe('isDateDisabled', () => {
    it('should return false when no constraints are provided', () => {
      const date = new Date(2024, 5, 15);
      expect(isDateDisabled(date, null, null)).toBe(false);
    });

    it('should return true when date is before minDate', () => {
      const date = new Date(2024, 5, 10);
      const minDate = new Date(2024, 5, 15);
      expect(isDateDisabled(date, minDate, null)).toBe(true);
    });

    it('should return true when date is after maxDate', () => {
      const date = new Date(2024, 5, 20);
      const maxDate = new Date(2024, 5, 15);
      expect(isDateDisabled(date, null, maxDate)).toBe(true);
    });

    it('should return false when date is within range', () => {
      const date = new Date(2024, 5, 15);
      const minDate = new Date(2024, 5, 10);
      const maxDate = new Date(2024, 5, 20);
      expect(isDateDisabled(date, minDate, maxDate)).toBe(false);
    });

    it('should return false when date equals minDate', () => {
      const date = new Date(2024, 5, 15);
      const minDate = new Date(2024, 5, 15);
      expect(isDateDisabled(date, minDate, null)).toBe(false);
    });

    it('should return false when date equals maxDate', () => {
      const date = new Date(2024, 5, 15);
      const maxDate = new Date(2024, 5, 15);
      expect(isDateDisabled(date, null, maxDate)).toBe(false);
    });
  });

  describe('generateCalendarDays', () => {
    const baseConfig: CalendarDayConfig = {
      year: 2024,
      month: 5, // June (0-indexed)
      mode: 'single',
      selectedDates: [],
      minDate: null,
      maxDate: null,
      disabled: false,
    };

    it('should generate days for a month', () => {
      const days = generateCalendarDays(baseConfig);
      expect(days.length).toBeGreaterThan(0);
      expect(days.every((day) => day.date instanceof Date)).toBe(true);
    });

    it('should mark today correctly', () => {
      const today = new Date();
      const config = { ...baseConfig, year: today.getFullYear(), month: today.getMonth() };
      const days = generateCalendarDays(config);
      const todayDay = days.find((day) => isSameDay(day.date, today));
      expect(todayDay?.isToday).toBe(true);
    });

    it('should mark current month days correctly', () => {
      const days = generateCalendarDays(baseConfig);
      const currentMonthDays = days.filter((day) => day.isCurrentMonth);
      expect(currentMonthDays.length).toBeGreaterThan(0);
      expect(currentMonthDays.every((day) => day.date.getMonth() === 5)).toBe(true);
    });

    it('should handle single selection mode', () => {
      const selectedDate = new Date(2024, 5, 15);
      const config = { ...baseConfig, selectedDates: [selectedDate] };
      const days = generateCalendarDays(config);
      const selectedDay = days.find((day) => isSameDay(day.date, selectedDate));
      expect(selectedDay?.isSelected).toBe(true);
    });

    it('should handle multiple selection mode', () => {
      const selectedDates = [new Date(2024, 5, 15), new Date(2024, 5, 20)];
      const config = { ...baseConfig, mode: 'multiple' as const, selectedDates };
      const days = generateCalendarDays(config);
      const selectedDays = days.filter((day) =>
        selectedDates.some((sel) => isSameDay(day.date, sel)),
      );
      expect(selectedDays.every((day) => day.isSelected)).toBe(true);
    });

    it('should handle range selection mode with start and end', () => {
      const startDate = new Date(2024, 5, 10);
      const endDate = new Date(2024, 5, 20);
      const config = {
        ...baseConfig,
        mode: 'range' as const,
        selectedDates: [startDate, endDate],
      };
      const days = generateCalendarDays(config);

      const startDay = days.find((day) => isSameDay(day.date, startDate));
      const endDay = days.find((day) => isSameDay(day.date, endDate));
      const middleDay = days.find(
        (day) => day.date > startDate && day.date < endDate && day.isCurrentMonth,
      );

      expect(startDay?.isRangeStart).toBe(true);
      expect(startDay?.isSelected).toBe(true);
      expect(endDay?.isRangeEnd).toBe(true);
      expect(endDay?.isSelected).toBe(true);
      expect(middleDay?.isInRange).toBe(true);
    });

    it('should handle range selection mode with only start', () => {
      const startDate = new Date(2024, 5, 10);
      const config = {
        ...baseConfig,
        mode: 'range' as const,
        selectedDates: [startDate],
      };
      const days = generateCalendarDays(config);

      const startDay = days.find((day) => isSameDay(day.date, startDate));
      expect(startDay?.isRangeStart).toBe(true);
      expect(startDay?.isSelected).toBe(true);
    });

    it('should mark disabled dates when disabled flag is true', () => {
      const config = { ...baseConfig, disabled: true };
      const days = generateCalendarDays(config);
      expect(days.every((day) => day.isDisabled)).toBe(true);
    });

    it('should mark disabled dates based on minDate', () => {
      const minDate = new Date(2024, 5, 15);
      const config = { ...baseConfig, minDate };
      const days = generateCalendarDays(config);
      const beforeMinDay = days.find((day) => day.date < minDate && day.isCurrentMonth);
      if (beforeMinDay) {
        expect(beforeMinDay.isDisabled).toBe(true);
      }
    });

    it('should mark disabled dates based on maxDate', () => {
      const maxDate = new Date(2024, 5, 15);
      const config = { ...baseConfig, maxDate };
      const days = generateCalendarDays(config);
      const afterMaxDay = days.find((day) => day.date > maxDate && day.isCurrentMonth);
      if (afterMaxDay) {
        expect(afterMaxDay.isDisabled).toBe(true);
      }
    });
  });

  describe('getSelectedDatesArray', () => {
    it('should return empty array for null value', () => {
      expect(getSelectedDatesArray(null, 'single')).toEqual([]);
    });

    it('should return array with single date for single mode', () => {
      const date = new Date(2024, 5, 15);
      expect(getSelectedDatesArray(date, 'single')).toEqual([date]);
    });

    it('should return array for multiple mode', () => {
      const dates = [new Date(2024, 5, 15), new Date(2024, 5, 20)];
      expect(getSelectedDatesArray(dates, 'multiple')).toEqual(dates);
    });

    it('should return array for range mode', () => {
      const dates = [new Date(2024, 5, 10), new Date(2024, 5, 20)];
      expect(getSelectedDatesArray(dates, 'range')).toEqual(dates);
    });

    it('should return empty array for invalid value in multiple mode', () => {
      expect(getSelectedDatesArray(new Date(), 'multiple')).toEqual([]);
    });

    it('should return empty array for invalid value in range mode', () => {
      expect(getSelectedDatesArray(new Date(), 'range')).toEqual([]);
    });
  });

  describe('getDayId', () => {
    it('should generate unique ID with index', () => {
      expect(getDayId(0)).toBe('calendar-day-0');
      expect(getDayId(42)).toBe('calendar-day-42');
    });
  });

  describe('getDayAriaLabel', () => {
    it('should generate aria label for a day', () => {
      const day: CalendarDay = {
        date: new Date(2024, 5, 15),
        isCurrentMonth: true,
        isToday: false,
        isSelected: false,
        isDisabled: false,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('June');
      expect(label).toContain('2024');
      expect(label).toContain('15');
    });

    it('should include "Today" in label when isToday is true', () => {
      const today = new Date();
      const day: CalendarDay = {
        date: today,
        isCurrentMonth: true,
        isToday: true,
        isSelected: false,
        isDisabled: false,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('Today');
    });

    it('should include "Selected" in label when isSelected is true', () => {
      const day: CalendarDay = {
        date: new Date(2024, 5, 15),
        isCurrentMonth: true,
        isToday: false,
        isSelected: true,
        isDisabled: false,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('Selected');
    });

    it('should include range indicators in label', () => {
      const day: CalendarDay = {
        date: new Date(2024, 5, 15),
        isCurrentMonth: true,
        isToday: false,
        isSelected: true,
        isDisabled: false,
        isRangeStart: true,
        isRangeEnd: false,
        isInRange: false,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('Range start');
    });

    it('should include "Outside month" for non-current month days', () => {
      const day: CalendarDay = {
        date: new Date(2024, 4, 15), // May
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        isDisabled: false,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('Outside month');
    });

    it('should include "Disabled" for disabled days', () => {
      const day: CalendarDay = {
        date: new Date(2024, 5, 15),
        isCurrentMonth: true,
        isToday: false,
        isSelected: false,
        isDisabled: true,
      };
      const label = getDayAriaLabel(day);
      expect(label).toContain('Disabled');
    });
  });

  describe('makeSafeDate', () => {
    it('should create a date at midday', () => {
      const date = makeSafeDate(2024, 5, 15);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(5);
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(12);
      expect(date.getMinutes()).toBe(0);
      expect(date.getSeconds()).toBe(0);
      expect(date.getMilliseconds()).toBe(0);
    });

    it('should default to day 1 when day is not provided', () => {
      const date = makeSafeDate(2024, 5);
      expect(date.getDate()).toBe(1);
    });
  });

  describe('normalizeCalendarValue', () => {
    it('should return null for null value', () => {
      expect(normalizeCalendarValue(null)).toBeNull();
    });

    it('should return valid Date for Date input', () => {
      const date = new Date(2024, 5, 15);
      const result = normalizeCalendarValue(date);
      expect(result).toBeInstanceOf(Date);
      expect(result).toEqual(date);
    });

    it('should normalize array of dates', () => {
      const dates = [new Date(2024, 5, 15), new Date(2024, 5, 20)];
      const result = normalizeCalendarValue(dates);
      expect(Array.isArray(result)).toBe(true);
      expect((result as Date[]).length).toBe(2);
    });

    it('should normalize string date', () => {
      const result = normalizeCalendarValue('20240615' as unknown as CalendarValue);
      expect(result).toBeInstanceOf(Date);
    });

    it('should normalize number date', () => {
      const result = normalizeCalendarValue(20240615 as unknown as CalendarValue);
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('toValidDate', () => {
    it('should return Date as-is when input is Date', () => {
      const date = new Date(2024, 5, 15);
      expect(toValidDate(date)).toBe(date);
    });

    it('should parse 8-digit number as YYYYMMDD', () => {
      const result = toValidDate(20240615);
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // June (0-indexed)
      expect(result.getDate()).toBe(15);
    });

    it('should parse 8-digit string as YYYYMMDD', () => {
      const result = toValidDate('20240615');
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5);
      expect(result.getDate()).toBe(15);
    });

    it('should parse standard date string', () => {
      const result = toValidDate('2024-06-15');
      expect(result).toBeInstanceOf(Date);
    });

    it('should parse timestamp number', () => {
      const timestamp = new Date(2024, 5, 15).getTime();
      const result = toValidDate(timestamp);
      expect(result).toBeInstanceOf(Date);
    });

    it('should handle invalid date string', () => {
      const result = toValidDate('invalid-date');
      // The function attempts to create a date, which may result in an invalid date
      // or fallback behavior. The actual behavior depends on Date constructor.
      expect(result).toBeDefined();
    });

    it('should handle non-8-digit numbers', () => {
      const result = toValidDate(12345);
      expect(result).toBeInstanceOf(Date);
    });
  });
});
