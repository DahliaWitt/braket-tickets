import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
  type WritableSignal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { CalendarMode, CalendarValue } from './calendar.types';
import { BraCalendarComponent } from './calendar.component';
import { BraCalendarGridComponent } from './calendar-grid.component';
import { BraCalendarGridComponentHarness } from './calendar-grid.harness';
import { BraCalendarNavigationComponent } from './calendar-navigation.component';
import { BraCalendarNavigationComponentHarness } from './calendar-navigation.component.harness';
import { BraCalendarComponentHarness } from './calendar.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bra-calendar
      [zMode]="mode()"
      [(value)]="value"
      [disabled]="disabled()"
      [minDate]="minDate()"
      [maxDate]="maxDate()"
      (dateChange)="onDateChange($event)"
    />
  `,
  imports: [BraCalendarComponent],
})
class TestHostComponent {
  readonly mode = signal<CalendarMode>('single');
  readonly value = signal<CalendarValue>(null);
  readonly disabled = signal(false);
  readonly minDate = signal<Date | null>(null);
  readonly maxDate = signal<Date | null>(null);

  readonly dateChanges = signal<Exclude<CalendarValue, null>[]>([]);

  onDateChange(date: Exclude<CalendarValue, null>) {
    this.dateChanges.update((changes) => [...changes, date]);
  }
}

interface CalendarComponentTestApi {
  onMonthChange(month: string | string[]): void;
  onYearChange(year: string | string[]): void;
  currentMonthValue: WritableSignal<string>;
  currentYearValue: WritableSignal<string>;
}

describe('BraCalendarComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let _calendarHarness: BraCalendarComponentHarness;
  let _gridHarness: BraCalendarGridComponentHarness;
  let _navigationHarness: BraCalendarNavigationComponentHarness;

  const getCalendar = (): BraCalendarComponent =>
    fixture.debugElement.query((de) => de.componentInstance instanceof BraCalendarComponent)
      ?.componentInstance as BraCalendarComponent;

  const getCalendarApi = (): CalendarComponentTestApi =>
    getCalendar() as unknown as CalendarComponentTestApi;

  const getGrid = (): BraCalendarGridComponent =>
    fixture.debugElement.query((de) => de.componentInstance instanceof BraCalendarGridComponent)
      ?.componentInstance as BraCalendarGridComponent;

  const getNavigation = (): BraCalendarNavigationComponent =>
    fixture.debugElement.query(
      (de) => de.componentInstance instanceof BraCalendarNavigationComponent,
    )?.componentInstance as BraCalendarNavigationComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    _calendarHarness = await loader.getHarness(BraCalendarComponentHarness);
    _gridHarness = await loader.getHarness(BraCalendarGridComponentHarness);
    _navigationHarness = await loader.getHarness(BraCalendarNavigationComponentHarness);
  });

  it('should select a date in single mode and emit dateChange', () => {
    const selectedDate = new Date(2026, 0, 11);
    const grid = getGrid();

    grid.dateSelect.emit({ date: selectedDate, index: 10 });
    fixture.detectChanges();

    const value = host.value();
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toDateString()).toBe(selectedDate.toDateString());
    expect(host.dateChanges()).toHaveLength(1);
    const emittedDate = host.dateChanges()[0];
    expect(emittedDate).toBeInstanceOf(Date);
    expect((emittedDate as Date).toDateString()).toBe(selectedDate.toDateString());
  });

  it('should ignore date selection when disabled', () => {
    host.disabled.set(true);
    fixture.detectChanges();

    const grid = getGrid();
    grid.dateSelect.emit({ date: new Date(2026, 0, 15), index: 14 });
    fixture.detectChanges();

    expect(host.value()).toBeNull();
    expect(host.dateChanges()).toHaveLength(0);
  });

  it('should toggle dates in multiple mode and emit only non-null dateChange values', () => {
    host.mode.set('multiple');
    fixture.detectChanges();

    const grid = getGrid();
    const dateOne = new Date(2026, 0, 5);
    const dateTwo = new Date(2026, 0, 7);

    grid.dateSelect.emit({ date: dateOne, index: 4 });
    fixture.detectChanges();
    expect(host.value()).toEqual([dateOne]);

    grid.dateSelect.emit({ date: dateTwo, index: 6 });
    fixture.detectChanges();
    expect(host.value()).toEqual([dateOne, dateTwo]);

    grid.dateSelect.emit({ date: dateOne, index: 4 });
    fixture.detectChanges();
    expect(host.value()).toEqual([dateTwo]);

    const changesBeforeNull = host.dateChanges().length;
    grid.dateSelect.emit({ date: dateTwo, index: 6 });
    fixture.detectChanges();

    expect(host.value()).toBeNull();
    expect(host.dateChanges().length).toBe(changesBeforeNull);
  });

  it('should handle range mode ordering and same-day reset', () => {
    host.mode.set('range');
    fixture.detectChanges();

    const grid = getGrid();
    const start = new Date(2026, 0, 10);
    const earlier = new Date(2026, 0, 3);

    grid.dateSelect.emit({ date: start, index: 9 });
    fixture.detectChanges();
    expect(host.value()).toEqual([start]);

    grid.dateSelect.emit({ date: earlier, index: 2 });
    fixture.detectChanges();
    expect(host.value()).toEqual([earlier, start]);

    grid.dateSelect.emit({ date: earlier, index: 2 });
    fixture.detectChanges();
    expect(host.value()).toEqual([earlier]);

    grid.dateSelect.emit({ date: earlier, index: 2 });
    fixture.detectChanges();
    expect(host.value()).toBeNull();
  });

  it('should validate month and year changes before applying navigation state', () => {
    const calendarApi = getCalendarApi();
    calendarApi.currentMonthValue.set('5');
    calendarApi.currentYearValue.set('2026');

    calendarApi.onMonthChange(['1']);
    expect(calendarApi.currentMonthValue()).toBe('5');

    calendarApi.onMonthChange('');
    expect(calendarApi.currentMonthValue()).toBe('5');

    calendarApi.onMonthChange('12');
    expect(calendarApi.currentMonthValue()).toBe('5');

    calendarApi.onMonthChange('2');
    expect(calendarApi.currentMonthValue()).toBe('2');

    calendarApi.onYearChange(['2024']);
    expect(calendarApi.currentYearValue()).toBe('2026');

    calendarApi.onYearChange('');
    expect(calendarApi.currentYearValue()).toBe('2026');

    calendarApi.onYearChange('1800');
    expect(calendarApi.currentYearValue()).toBe('2026');

    calendarApi.onYearChange('2027');
    expect(calendarApi.currentYearValue()).toBe('2027');
  });

  it('should handle previous and next month boundaries through navigation events', () => {
    const calendarApi = getCalendarApi();
    const navigation = getNavigation();

    calendarApi.currentMonthValue.set('0');
    calendarApi.currentYearValue.set('2026');
    navigation.previousMonth.emit();
    fixture.detectChanges();

    expect(calendarApi.currentMonthValue()).toBe('11');
    expect(calendarApi.currentYearValue()).toBe('2025');

    navigation.nextMonth.emit();
    fixture.detectChanges();
    expect(calendarApi.currentMonthValue()).toBe('0');
    expect(calendarApi.currentYearValue()).toBe('2026');

    calendarApi.currentMonthValue.set('11');
    calendarApi.currentYearValue.set('2026');
    navigation.nextMonth.emit();
    fixture.detectChanges();

    expect(calendarApi.currentMonthValue()).toBe('0');
    expect(calendarApi.currentYearValue()).toBe('2027');
  });

  it('should update disabled state through ControlValueAccessor', () => {
    const calendar = getCalendar();
    calendar.setDisabledState(true);
    fixture.detectChanges();

    const grid = getGrid();
    grid.dateSelect.emit({ date: new Date(2026, 0, 9), index: 8 });
    fixture.detectChanges();

    expect(host.value()).toBeNull();
  });

  it('should invoke ControlValueAccessor callbacks on date selection', () => {
    const calendar = getCalendar();
    const onChange = vi.fn();
    const onTouched = vi.fn();
    const selectedDate = new Date(2026, 1, 20);

    calendar.registerOnChange(onChange);
    calendar.registerOnTouched(onTouched);

    getGrid().dateSelect.emit({ date: selectedDate, index: 19 });
    fixture.detectChanges();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(selectedDate);
    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('should reset navigation to selected date and clear focused day', () => {
    host.value.set(new Date(2026, 8, 9));
    fixture.detectChanges();

    const calendarApi = getCalendarApi();
    const grid = getGrid();
    const focusSpy = vi.spyOn(grid, 'setFocusedDayIndex');

    getCalendar().resetNavigation();

    expect(calendarApi.currentMonthValue()).toBe('8');
    expect(calendarApi.currentYearValue()).toBe('2026');
    expect(focusSpy).toHaveBeenCalledWith(-1);
  });

  it('should reset grid focus after year navigation from grid keyboard events', async () => {
    vi.useFakeTimers();
    const calendarApi = getCalendarApi();
    const grid = getGrid();
    const resetFocusSpy = vi.spyOn(grid, 'resetFocus');
    calendarApi.currentYearValue.set('2026');
    fixture.detectChanges();

    grid.previousYear.emit();
    await vi.runAllTimersAsync();
    fixture.detectChanges();
    expect(calendarApi.currentYearValue()).toBe('2025');

    grid.nextYear.emit();
    await vi.runAllTimersAsync();
    fixture.detectChanges();
    expect(calendarApi.currentYearValue()).toBe('2026');
    expect(resetFocusSpy).toHaveBeenCalledTimes(2);
  });

  it('should focus first enabled day after grid next-month boundary navigation', async () => {
    vi.useFakeTimers();
    const calendarApi = getCalendarApi();
    const grid = getGrid();
    const focusSpy = vi.spyOn(grid, 'setFocusedDayIndex');

    calendarApi.currentMonthValue.set('0');
    calendarApi.currentYearValue.set('2026');
    fixture.detectChanges();

    grid.nextMonth.emit({ position: 'first', dayOfWeek: -1 });
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    const days = (
      grid as unknown as { calendarDays: () => { isDisabled: boolean }[] }
    ).calendarDays();
    const expectedFirstEnabled = days.findIndex((day) => !day.isDisabled);

    expect(calendarApi.currentMonthValue()).toBe('1');
    expect(calendarApi.currentYearValue()).toBe('2026');
    expect(focusSpy).toHaveBeenLastCalledWith(expectedFirstEnabled);
  });

  it('should focus last enabled day after grid previous-month boundary navigation', async () => {
    vi.useFakeTimers();
    const calendarApi = getCalendarApi();
    const grid = getGrid();
    const focusSpy = vi.spyOn(grid, 'setFocusedDayIndex');

    calendarApi.currentMonthValue.set('2');
    calendarApi.currentYearValue.set('2026');
    fixture.detectChanges();

    grid.previousMonth.emit({ position: 'last', dayOfWeek: -1 });
    await vi.runAllTimersAsync();
    fixture.detectChanges();

    const days = (
      grid as unknown as { calendarDays: () => { isDisabled: boolean }[] }
    ).calendarDays();
    let expectedLastEnabled = -1;
    for (let index = days.length - 1; index >= 0; index--) {
      if (!days[index].isDisabled) {
        expectedLastEnabled = index;
        break;
      }
    }

    expect(calendarApi.currentMonthValue()).toBe('1');
    expect(calendarApi.currentYearValue()).toBe('2026');
    expect(focusSpy).toHaveBeenLastCalledWith(expectedLastEnabled);
  });

  it('should skip scheduled focus work after the calendar is destroyed', async () => {
    vi.useFakeTimers();
    const grid = getGrid();
    const resetFocusSpy = vi.spyOn(grid, 'resetFocus');

    grid.previousYear.emit();
    fixture.destroy();
    await vi.runAllTimersAsync();

    expect(resetFocusSpy).not.toHaveBeenCalled();
  });
});
