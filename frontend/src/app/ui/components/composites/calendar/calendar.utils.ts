import type {
  CalendarDay,
  CalendarDayConfig,
  CalendarMode,
  CalendarValue,
} from './calendar.types';

export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

export function isDateDisabled(
  date: Date,
  minDate: Date | null,
  maxDate: Date | null,
): boolean {
  const dateTime = date.getTime();
  if (minDate && dateTime < minDate.getTime()) return true;
  if (maxDate && dateTime > maxDate.getTime()) return true;
  return false;
}

export function generateCalendarDays(config: CalendarDayConfig): CalendarDay[] {
  const {mode, selectedDates, minDate, maxDate, disabled} = config;

  const today = new Date();

  // Guard against invalid navigation input. A NaN year/month (e.g. produced by
  // an Invalid Date propagated from upstream) — or a finite but out-of-range
  // value such as year 275760 — yields Invalid Date boundaries, and the
  // day-generation loop below would never terminate because its exit condition
  // `currentWeekDate > endDate` is a NaN comparison that is always false,
  // hanging the browser tab. Fall back to the current month whenever either
  // boundary is invalid, so no Invalid Date can reach the loop or the grid.
  let year = Number.isFinite(config.year)
    ? Math.trunc(config.year)
    : today.getFullYear();
  let month = Number.isFinite(config.month)
    ? Math.trunc(config.month)
    : today.getMonth();

  let firstDay = new Date(year, month, 1);
  let lastDay = new Date(year, month + 1, 0);
  if (Number.isNaN(firstDay.getTime()) || Number.isNaN(lastDay.getTime())) {
    year = today.getFullYear();
    month = today.getMonth();
    firstDay = new Date(year, month, 1);
    lastDay = new Date(year, month + 1, 0);
  }

  // Re-derive month from the constructed first day so overflow inputs
  // (e.g. month 12 → January of the next year) still mark the correct cells as
  // current-month below. This is a no-op for in-range values.
  month = firstDay.getMonth();

  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const endDate = new Date(lastDay);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

  const days: CalendarDay[] = [];
  const currentWeekDate = new Date(startDate);

  let selectedDatesSet: Set<string> | null = null;
  if (mode === 'multiple' && selectedDates.length > 0) {
    selectedDatesSet = new Set(
      selectedDates.map(
        (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      ),
    );
  }

  let rangeStartTime: number | null = null;
  let rangeEndTime: number | null = null;
  let rangeStartKey: string | null = null;
  let rangeEndKey: string | null = null;
  if (mode === 'range' && selectedDates.length > 0) {
    const rangeStart = selectedDates[0];
    const rangeEnd = selectedDates.length > 1 ? selectedDates[1] : null;
    rangeStartTime = rangeStart.getTime();
    rangeEndTime = rangeEnd ? rangeEnd.getTime() : null;
    rangeStartKey = `${rangeStart.getFullYear()}-${rangeStart.getMonth()}-${rangeStart.getDate()}`;
    rangeEndKey = rangeEnd
      ? `${rangeEnd.getFullYear()}-${rangeEnd.getMonth()}-${rangeEnd.getDate()}`
      : null;
  }

  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const singleSelectedKey =
    mode === 'single' && selectedDates.length > 0
      ? `${selectedDates[0].getFullYear()}-${selectedDates[0].getMonth()}-${selectedDates[0].getDate()}`
      : null;

  // A month grid spans at most 6 weeks (42 cells). This hard iteration bound is
  // the structural termination guarantee: it holds regardless of date validity,
  // so even if the boundary guards above were ever bypassed the loop can never
  // run unbounded and hang the tab.
  const maxCalendarCells = 6 * 7;
  for (let i = 0; i < maxCalendarCells; i++) {
    if (currentWeekDate > endDate) break;

    const date = new Date(currentWeekDate);
    const isCurrentMonth = date.getMonth() === month;

    const isDisabledDate = disabled || isDateDisabled(date, minDate, maxDate);

    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const isToday = dateKey === todayKey;

    let isSelected = false;
    let isRangeStart = false;
    let isRangeEnd = false;
    let isInRange = false;

    if (mode === 'single') {
      isSelected = singleSelectedKey !== null && dateKey === singleSelectedKey;
    } else if (mode === 'multiple') {
      isSelected = selectedDatesSet !== null && selectedDatesSet.has(dateKey);
    } else if (mode === 'range') {
      if (rangeStartKey !== null && dateKey === rangeStartKey) {
        isRangeStart = true;
        isSelected = true;
      }
      if (rangeEndKey !== null && dateKey === rangeEndKey) {
        isRangeEnd = true;
        isSelected = true;
      }
      if (
        rangeStartTime !== null &&
        rangeEndTime !== null &&
        !isRangeStart &&
        !isRangeEnd
      ) {
        const dateTime = date.getTime();
        isInRange = dateTime > rangeStartTime && dateTime < rangeEndTime;
      }
    }

    days.push({
      date,
      dayNumber: date.getDate(),
      isCurrentMonth,
      isToday,
      isSelected,
      isDisabled: isDisabledDate,
      isRangeStart,
      isRangeEnd,
      isInRange,
    });

    currentWeekDate.setDate(currentWeekDate.getDate() + 1);
  }

  return days;
}

export function getSelectedDatesArray(
  value: CalendarValue,
  mode: CalendarMode,
): Date[] {
  if (!value) return [];

  if (mode === 'single') {
    return [value as Date];
  }

  if ((mode === 'multiple' || mode === 'range') && Array.isArray(value)) {
    return value;
  }

  return [];
}

export function getDayId(index: number): string {
  return `calendar-day-${index}`;
}

export function getDayAriaLabel(day: CalendarDay): string {
  const dateStr = day.date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const labels = [dateStr];

  if (day.isToday) labels.push('Today');
  if (day.isSelected) labels.push('Selected');
  if (day.isRangeStart) labels.push('Range start');
  if (day.isRangeEnd) labels.push('Range end');
  if (day.isInRange) labels.push('In range');
  if (!day.isCurrentMonth) labels.push('Outside month');
  if (day.isDisabled) labels.push('Disabled');

  return labels.join(', ');
}

/**
 * Creates a date positioned safely at midday to avoid timezone-based
 * month/day shifts triggered by local DST or UTC conversions.
 *
 * Useful when constructing calendar/navigation dates where 00:00
 * may incorrectly roll the date backward or forward.
 */
export function makeSafeDate(year: number, month: number, day = 1): Date {
  const date = new Date(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function normalizeCalendarValue(v: CalendarValue): CalendarValue {
  if (!v) return null;

  if (v instanceof Date) return toValidDate(v);

  if (Array.isArray(v)) {
    // Drop entries that fail validation (toValidDate returns null) so an
    // Invalid Date can never reach consumers as an unusable Date object.
    return v.map((d) => toValidDate(d)).filter((d): d is Date => d !== null);
  }

  return toValidDate(v);
}

export function toValidDate(value: unknown): Date | null {
  if (value instanceof Date) {
    // An Invalid Date (e.g. `new Date('garbage')`) is still `instanceof Date`.
    // Returning it unguarded lets NaN year/month reach generateCalendarDays and
    // hang the tab, so treat it the same as any other unparseable input.
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && value.toString().length === 8) {
    const s = value.toString();
    const y = +s.slice(0, 4);
    const m = +s.slice(4, 6) - 1;
    const d = +s.slice(6, 8);

    return makeSafeDate(y, m, d);
  }

  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6) - 1;
    const d = +value.slice(6, 8);

    return makeSafeDate(y, m, d);
  }

  const date = new Date(value as string | number | Date);

  if (isNaN(date.getTime())) return null;

  return makeSafeDate(date.getFullYear(), date.getMonth(), date.getDate());
}
