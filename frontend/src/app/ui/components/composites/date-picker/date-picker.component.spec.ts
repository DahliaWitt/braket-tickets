import {type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {vi} from 'vitest';
import {BraDatePickerComponent} from './date-picker.component';
import {BraDatePickerHarness} from './date-picker.component.harness';
import {BraDatePickerComponentHarness} from './date-picker.harness';

interface DatePickerTestApi {
  displayText: () => string;
  onDateChange: (date: Date | Date[]) => void;
  onPopoverVisibilityChange: (visible: boolean) => void;
}

describe('BraDatePickerComponent', () => {
  let fixture: ComponentFixture<BraDatePickerComponent>;
  let component: BraDatePickerComponent;
  let loader: HarnessLoader;

  const getApi = (): DatePickerTestApi =>
    component as unknown as DatePickerTestApi;

  const setPopoverDirectiveStub = (
    hideSpy = vi.fn(),
  ): ReturnType<typeof vi.fn> => {
    Object.defineProperty(component, 'popoverDirective', {
      configurable: true,
      value: () => ({hide: hideSpy}),
    });
    return hideSpy;
  };

  const setCalendarStub = (resetSpy = vi.fn()): ReturnType<typeof vi.fn> => {
    Object.defineProperty(component, 'calendar', {
      configurable: true,
      value: () => ({resetNavigation: resetSpy}),
    });
    return resetSpy;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BraDatePickerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(BraDatePickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render placeholder when no date is selected', async () => {
    fixture.componentRef.setInput('placeholder', 'Select event date');
    component.writeValue(null);
    fixture.detectChanges();

    const picker = await loader.getHarness(BraDatePickerHarness);
    expect(getApi().displayText()).toBe('Select event date');
    expect(await picker.getTriggerText()).toContain('Select event date');
  });

  it('should format selected date using configured format', async () => {
    fixture.componentRef.setInput('zFormat', 'yyyy-MM-dd');
    component.writeValue(new Date(2026, 0, 2, 12, 0, 0));
    fixture.detectChanges();

    expect(getApi().displayText()).toBe('2026-01-02');
  });

  it('should normalize array date selection and notify CVA/output callbacks', () => {
    const hideSpy = setPopoverDirectiveStub();
    const onChange = vi.fn();
    const onTouched = vi.fn();
    const emitSpy = vi.spyOn(component.dateChange, 'emit');
    const selectedDate = new Date(2026, 1, 14);

    component.registerOnChange(onChange);
    component.registerOnTouched(onTouched);
    getApi().onDateChange([selectedDate]);

    expect(component.value()?.toDateString()).toBe(selectedDate.toDateString());
    expect(onChange).toHaveBeenCalledWith(selectedDate);
    expect(onTouched).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(selectedDate);
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('should expose the selected date in trigger text and aria-label', async () => {
    const hideSpy = setPopoverDirectiveStub();
    fixture.componentRef.setInput('zFormat', 'yyyy-MM-dd');
    const selectedDate = new Date(2026, 3, 21);

    getApi().onDateChange(selectedDate);
    fixture.detectChanges();
    await fixture.whenStable();

    const picker = await loader.getHarness(BraDatePickerHarness);
    expect(await picker.getTriggerText()).toContain('2026-04-21');
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector('button');
    if (!trigger) {
      throw new Error('Expected date picker trigger button');
    }
    expect(trigger.getAttribute('aria-label')).toBe('Selected date 2026-04-21');
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('component harness should find the trigger after placeholder and selected-date label changes', async () => {
    const hideSpy = setPopoverDirectiveStub();
    fixture.componentRef.setInput('placeholder', 'Pick a date');
    fixture.componentRef.setInput('zFormat', 'yyyy-MM-dd');
    fixture.detectChanges();
    await fixture.whenStable();

    const picker = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      BraDatePickerComponentHarness,
    );
    expect(await picker.getDisplayText()).toContain('Pick a date');
    expect(await picker.getAriaLabel()).toBe('Pick a date');

    getApi().onDateChange(new Date(2026, 3, 21));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await picker.getDisplayText()).toContain('2026-04-21');
    expect(await picker.getAriaLabel()).toBe('Selected date 2026-04-21');
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('should map empty date arrays to null and still notify consumers', () => {
    const hideSpy = setPopoverDirectiveStub();
    const onChange = vi.fn();
    const emitSpy = vi.spyOn(component.dateChange, 'emit');

    component.registerOnChange(onChange);
    getApi().onDateChange([]);

    expect(component.value()).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
    expect(emitSpy).toHaveBeenCalledWith(null);
    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('should reset calendar navigation when popover becomes visible', () => {
    vi.useFakeTimers();
    const resetSpy = setCalendarStub();

    getApi().onPopoverVisibilityChange(true);
    expect(component.isOpen()).toBe(true);
    expect(resetSpy).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('should not reset calendar navigation when popover stays hidden', () => {
    const resetSpy = setCalendarStub();

    getApi().onPopoverVisibilityChange(false);

    expect(component.isOpen()).toBe(false);
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('should propagate disabled state to trigger button', async () => {
    component.setDisabledState(true);
    fixture.detectChanges();

    const picker = await loader.getHarness(BraDatePickerHarness);
    expect(await picker.isDisabled()).toBe(true);
  });
});
