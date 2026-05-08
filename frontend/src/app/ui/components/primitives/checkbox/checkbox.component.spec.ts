import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {FormsModule} from '@angular/forms';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {By} from '@angular/platform-browser';
import {vi} from 'vitest';
import {ZardCheckboxComponent} from './checkbox.component';
import {ZardCheckboxHarness} from './checkbox.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-checkbox
      [ngModel]="isCheckedSignal()"
      (ngModelChange)="isCheckedSignal.set($event)"
      [disabled]="isDisabled()"
    >
      Test Label
    </z-checkbox>
  `,
  imports: [ZardCheckboxComponent, FormsModule],
})
class TestHostComponent {
  readonly isCheckedSignal = signal(false);
  readonly isDisabled = signal(false);
}

describe('ZardCheckboxComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let harness: ZardCheckboxHarness;
  let component: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(ZardCheckboxHarness);
  });

  it('should display the correct label', async () => {
    expect(await harness.getLabelText()).toBe('Test Label');
  });

  it('should be unchecked initially', async () => {
    expect(await harness.isChecked()).toBe(false);
  });

  it('should toggle state when clicked', async () => {
    await harness.toggle();
    expect(await harness.isChecked()).toBe(true);
    expect(component.isCheckedSignal()).toBe(true);

    await harness.toggle();
    expect(await harness.isChecked()).toBe(false);
    expect(component.isCheckedSignal()).toBe(false);
  });

  it('should respect disabled state', async () => {
    component.isDisabled.set(true);
    fixture.detectChanges();

    expect(await harness.isDisabled()).toBe(true);

    await harness.toggle();
    // Should remain unchecked
    expect(await harness.isChecked()).toBe(false);
    expect(component.isCheckedSignal()).toBe(false);
  });

  it('should respect form-driven disabled state from ControlValueAccessor', async () => {
    const checkbox = fixture.debugElement.query(
      By.directive(ZardCheckboxComponent),
    ).componentInstance as ZardCheckboxComponent;

    checkbox.setDisabledState(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isDisabled()).toBe(true);

    await harness.toggle();

    expect(await harness.isChecked()).toBe(false);
    expect(component.isCheckedSignal()).toBe(false);

    checkbox.setDisabledState(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isDisabled()).toBe(false);
  });

  it('should update view when model changes programmatically', async () => {
    component.isCheckedSignal.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isChecked()).toBe(true);
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-checkbox [zAriaDescribedBy]="ariaDescribedBy()"> Test Label </z-checkbox>
  `,
  imports: [ZardCheckboxComponent],
})
class TestAriaHostComponent {
  readonly ariaDescribedBy = signal<string | null>(null);
}

describe('ZardCheckboxComponent Accessibility', () => {
  let fixture: ComponentFixture<TestAriaHostComponent>;
  let component: TestAriaHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestAriaHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestAriaHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should apply aria-describedby attribute to the input', () => {
    const inputElement = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input')!;
    expect(inputElement.getAttribute('aria-describedby')).toBeNull();

    component.ariaDescribedBy.set('error-id');
    fixture.detectChanges();

    expect(inputElement.getAttribute('aria-describedby')).toBe('error-id');
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-checkbox [disabled]="isDisabled()">Callback Label</z-checkbox>
  `,
  imports: [ZardCheckboxComponent],
})
class TestCallbacksHostComponent {
  readonly isDisabled = signal(false);
}

describe('ZardCheckboxComponent Internal Callbacks', () => {
  let fixture: ComponentFixture<TestCallbacksHostComponent>;
  let host: TestCallbacksHostComponent;
  let checkbox: ZardCheckboxComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestCallbacksHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestCallbacksHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    checkbox = fixture.debugElement.query(By.directive(ZardCheckboxComponent))
      .componentInstance as ZardCheckboxComponent;
  });

  it('should short-circuit onCheckboxChange when disabled', () => {
    const onChange = vi.fn();
    const onTouched = vi.fn();
    const outputSpy = vi.fn();

    checkbox.registerOnChange(onChange);
    checkbox.registerOnTouched(onTouched);
    checkbox.checkChange.subscribe(outputSpy);

    host.isDisabled.set(true);
    fixture.detectChanges();
    checkbox.onCheckboxChange();

    expect(checkbox.checked()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onTouched).not.toHaveBeenCalled();
    expect(outputSpy).not.toHaveBeenCalled();
  });

  it('should short-circuit onCheckboxChange when disabled via ControlValueAccessor', () => {
    const onChange = vi.fn();
    const outputSpy = vi.fn();

    checkbox.registerOnChange(onChange);
    checkbox.checkChange.subscribe(outputSpy);

    checkbox.setDisabledState(true);
    fixture.detectChanges();
    checkbox.onCheckboxChange();

    expect(checkbox.checked()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(outputSpy).not.toHaveBeenCalled();
  });

  it('should call registered onTouched callback on blur', () => {
    const onTouched = vi.fn();
    checkbox.registerOnTouched(onTouched);

    checkbox.onCheckboxBlur();
    checkbox.onCheckboxBlur();

    expect(onTouched).toHaveBeenCalledTimes(2);
  });
});
