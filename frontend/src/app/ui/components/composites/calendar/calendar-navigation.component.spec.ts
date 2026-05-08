import { type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BraCalendarNavigationComponent } from './calendar-navigation.component';
import { BraCalendarNavigationHarness } from './calendar-navigation.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bra-calendar-navigation
      [currentMonth]="currentMonth()"
      [currentYear]="currentYear()"
      [minDate]="minDate()"
      [maxDate]="maxDate()"
      [disabled]="disabled()"
      (monthChange)="onMonthChange($event)"
      (yearChange)="onYearChange($event)"
      (previousMonth)="onPreviousMonth()"
      (nextMonth)="onNextMonth()"
    />
  `,
  imports: [BraCalendarNavigationComponent],
})
class TestHostComponent {
  readonly currentMonth = signal('5');
  readonly currentYear = signal('2026');
  readonly minDate = signal<Date | null>(null);
  readonly maxDate = signal<Date | null>(null);
  readonly disabled = signal(false);

  readonly monthChanges = signal<string[]>([]);
  readonly yearChanges = signal<string[]>([]);
  readonly previousCount = signal(0);
  readonly nextCount = signal(0);

  onMonthChange(month: string) {
    this.monthChanges.update((changes) => [...changes, month]);
  }

  onYearChange(year: string) {
    this.yearChanges.update((changes) => [...changes, year]);
  }

  onPreviousMonth() {
    this.previousCount.update((count) => count + 1);
  }

  onNextMonth() {
    this.nextCount.update((count) => count + 1);
  }
}

interface NavigationTestApi {
  onMonthChange(month: string | string[]): void;
  onYearChange(year: string | string[]): void;
}

describe('BraCalendarNavigationComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let harnessLoader: HarnessLoader;

  const getNavigation = (): BraCalendarNavigationComponent =>
    fixture.debugElement.query(By.directive(BraCalendarNavigationComponent))
      .componentInstance as BraCalendarNavigationComponent;

  const getNavigationApi = (): NavigationTestApi => getNavigation() as unknown as NavigationTestApi;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    harnessLoader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should disable both navigation buttons when component is disabled', async () => {
    host.disabled.set(true);
    fixture.detectChanges();

    const harness = await harnessLoader.getHarness(BraCalendarNavigationHarness);
    expect(await harness.isPreviousDisabled()).toBe(true);
    expect(await harness.isNextDisabled()).toBe(true);
  });

  it('should disable previous navigation when minDate is in current month', async () => {
    host.currentMonth.set('5');
    host.currentYear.set('2026');
    host.minDate.set(new Date(2026, 5, 1));
    fixture.detectChanges();

    const harness = await harnessLoader.getHarness(BraCalendarNavigationHarness);
    expect(await harness.isPreviousDisabled()).toBe(true);
  });

  it('should disable next navigation when maxDate is in current month', async () => {
    host.currentMonth.set('5');
    host.currentYear.set('2026');
    host.maxDate.set(new Date(2026, 5, 30));
    fixture.detectChanges();

    const harness = await harnessLoader.getHarness(BraCalendarNavigationHarness);
    expect(await harness.isNextDisabled()).toBe(true);
  });

  it('should emit previousMonth and nextMonth from navigation button clicks', async () => {
    const harness = await harnessLoader.getHarness(BraCalendarNavigationHarness);
    await harness.clickPrevious();
    await harness.clickNext();
    fixture.detectChanges();

    expect(host.previousCount()).toBe(1);
    expect(host.nextCount()).toBe(1);
  });

  it('should emit monthChange/yearChange for single values and ignore array values', () => {
    const navigationApi = getNavigationApi();

    navigationApi.onMonthChange('3');
    navigationApi.onYearChange('2028');
    navigationApi.onMonthChange(['4']);
    navigationApi.onYearChange(['2029']);

    expect(host.monthChanges()).toEqual(['3']);
    expect(host.yearChanges()).toEqual(['2028']);
  });
});
