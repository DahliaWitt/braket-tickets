import { type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { CalendarDay } from './calendar.types';
import { BraCalendarGridComponent } from './calendar-grid.component';
import { BraCalendarGridComponentHarness } from './calendar-grid.harness';

const createCalendarDay = (
  day: number,
  options: {
    selected?: boolean;
    today?: boolean;
    disabled?: boolean;
    currentMonth?: boolean;
  } = {},
): CalendarDay => ({
  date: new Date(2026, 0, day),
  dayNumber: day,
  isCurrentMonth: options.currentMonth ?? true,
  isToday: options.today ?? false,
  isSelected: options.selected ?? false,
  isDisabled: options.disabled ?? false,
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bra-calendar-grid
      [calendarDays]="days()"
      [disabled]="disabled()"
      (dateSelect)="onDateSelect($event)"
      (previousMonth)="onPreviousMonth($event)"
      (nextMonth)="onNextMonth($event)"
      (previousYear)="onPreviousYear()"
      (nextYear)="onNextYear()"
    />
  `,
  imports: [BraCalendarGridComponent],
})
class TestHostComponent {
  readonly days = signal<CalendarDay[]>(
    Array.from({ length: 14 }, (_, index) => createCalendarDay(index + 1)),
  );
  readonly disabled = signal(false);

  readonly dateSelections = signal<{ date: Date; index: number }[]>([]);
  readonly previousMonthEvents = signal<{ position: string; dayOfWeek: number }[]>([]);
  readonly nextMonthEvents = signal<{ position: string; dayOfWeek: number }[]>([]);
  readonly previousYearCount = signal(0);
  readonly nextYearCount = signal(0);

  onDateSelect(event: { date: Date; index: number }) {
    this.dateSelections.update((events) => [...events, event]);
  }

  onPreviousMonth(event: { position: string; dayOfWeek: number }) {
    this.previousMonthEvents.update((events) => [...events, event]);
  }

  onNextMonth(event: { position: string; dayOfWeek: number }) {
    this.nextMonthEvents.update((events) => [...events, event]);
  }

  onPreviousYear() {
    this.previousYearCount.update((count) => count + 1);
  }

  onNextYear() {
    this.nextYearCount.update((count) => count + 1);
  }
}

describe('BraCalendarGridComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let harnessLoader: HarnessLoader;
  let gridHarness: BraCalendarGridComponentHarness;

  const getGridComponent = (): BraCalendarGridComponent =>
    fixture.debugElement.query((de) => de.componentInstance instanceof BraCalendarGridComponent)
      ?.componentInstance as BraCalendarGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    harnessLoader = TestbedHarnessEnvironment.loader(fixture);
    gridHarness = await harnessLoader.getHarness(BraCalendarGridComponentHarness);
  });

  it('should emit dateSelect when clicking an enabled day', async () => {
    await gridHarness.clickDayByIndex(2);
    fixture.detectChanges();

    const events = host.dateSelections();
    expect(events).toHaveLength(1);
    expect(events[0].index).toBe(2);
    expect(events[0].date.getDate()).toBe(3);
  });

  it('should not emit dateSelect when disabled', async () => {
    host.disabled.set(true);
    fixture.detectChanges();

    await gridHarness.clickDayByIndex(2);
    fixture.detectChanges();

    expect(host.dateSelections()).toHaveLength(0);
  });

  it('should prioritize focus as selected > today > first enabled day', async () => {
    host.days.set([
      createCalendarDay(1, { disabled: true }),
      createCalendarDay(2, { disabled: true }),
      createCalendarDay(3),
      createCalendarDay(4, { today: true }),
      createCalendarDay(5, { selected: true }),
      createCalendarDay(6),
      createCalendarDay(7),
    ]);
    fixture.detectChanges();

    expect(await gridHarness.getTabbableDayIndex()).toBe(4);

    host.days.set([
      createCalendarDay(1, { disabled: true }),
      createCalendarDay(2, { disabled: true }),
      createCalendarDay(3),
      createCalendarDay(4, { today: true }),
      createCalendarDay(5),
      createCalendarDay(6),
      createCalendarDay(7),
    ]);
    fixture.detectChanges();
    expect(await gridHarness.getTabbableDayIndex()).toBe(3);

    host.days.set([
      createCalendarDay(1, { disabled: true }),
      createCalendarDay(2, { disabled: true }),
      createCalendarDay(3),
      createCalendarDay(4),
      createCalendarDay(5),
      createCalendarDay(6),
      createCalendarDay(7),
    ]);
    fixture.detectChanges();
    expect(await gridHarness.getTabbableDayIndex()).toBe(2);
  });

  it('should emit previousMonth when ArrowLeft moves before first day', async () => {
    host.days.set(Array.from({ length: 7 }, (_, index) => createCalendarDay(index + 1)));
    fixture.detectChanges();

    const gridComponent = getGridComponent();
    gridComponent.setFocusedDayIndex(0);
    fixture.detectChanges();

    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();

    expect(host.previousMonthEvents()).toEqual([{ position: 'last', dayOfWeek: -1 }]);
  });

  it('should emit nextMonth with dayOfWeek when ArrowDown crosses month boundary', async () => {
    host.days.set(Array.from({ length: 14 }, (_, index) => createCalendarDay(index + 1)));
    fixture.detectChanges();

    const gridComponent = getGridComponent();
    gridComponent.setFocusedDayIndex(8); // dayOfWeek = 1
    fixture.detectChanges();

    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();

    expect(host.nextMonthEvents()).toEqual([{ position: 'firstWeek', dayOfWeek: 1 }]);
  });

  it('should move focus to first and last enabled day in row with Home/End', async () => {
    host.days.set([
      createCalendarDay(1),
      createCalendarDay(2),
      createCalendarDay(3),
      createCalendarDay(4),
      createCalendarDay(5),
      createCalendarDay(6),
      createCalendarDay(7),
      createCalendarDay(8, { disabled: true }),
      createCalendarDay(9, { disabled: true }),
      createCalendarDay(10),
      createCalendarDay(11, { disabled: true }),
      createCalendarDay(12),
      createCalendarDay(13),
      createCalendarDay(14, { disabled: true }),
    ]);
    fixture.detectChanges();

    const gridComponent = getGridComponent();
    gridComponent.setFocusedDayIndex(9);
    fixture.detectChanges();

    const gridHarness = await harnessLoader.getHarness(BraCalendarGridComponentHarness);
    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'Home' }));
    fixture.detectChanges();
    expect(await gridHarness.getTabbableDayIndex()).toBe(9);

    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }));
    fixture.detectChanges();
    expect(await gridHarness.getTabbableDayIndex()).toBe(12);
  });

  it('should emit year navigation on ctrl+PageUp/PageDown', () => {
    const gridComponent = getGridComponent();

    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true }));
    gridComponent.onKeyDown(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true }));

    expect(host.previousYearCount()).toBe(1);
    expect(host.nextYearCount()).toBe(1);
  });

  it('should expose accessible aria labels on day buttons', async () => {
    host.days.set([
      createCalendarDay(1, { today: true }),
      createCalendarDay(2, { selected: true }),
      createCalendarDay(3),
      createCalendarDay(4),
      createCalendarDay(5),
      createCalendarDay(6),
      createCalendarDay(7),
    ]);
    fixture.detectChanges();

    const gridHarness = await harnessLoader.getHarness(BraCalendarGridComponentHarness);
    const labelToday = await gridHarness.getAriaLabelByIndex(0);
    const labelSelected = await gridHarness.getAriaLabelByIndex(1);

    expect(labelToday).toContain('Today');
    expect(labelSelected).toContain('Selected');
  });
});
