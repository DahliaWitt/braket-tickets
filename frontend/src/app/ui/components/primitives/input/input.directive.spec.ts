import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type HarnessLoader} from '@angular/cdk/testing';

import {ZardInputDirective} from './input.directive';
import {ZardInputHarness} from './input.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardInputDirective],
  template: `
    <input zInput id="default-input" />
    <input zInput [zStatus]="'error'" id="error-input" />
    <input zInput [(value)]="val" id="model-input" />
    <input
      zInput
      id="password-placeholder"
      type="password"
      placeholder="••••••••"
    />
    <input
      zInput
      id="visible-password-placeholder"
      type="text"
      autocomplete="new-password"
      placeholder="••••••••"
    />
    <input zInput id="text-placeholder" type="text" placeholder="Your name" />
  `,
})
class TestHostComponent {
  readonly val = signal('initial');
}

describe('ZardInputDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it('should create harness', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#default-input'}),
    );
    expect(input).toBeTruthy();
  });

  it('should disable externally', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#default-input'}),
    );

    // Get directive instance to call the method (White-box testing part)
    const directive = fixture.debugElement
      .query(By.directive(ZardInputDirective))
      .injector.get(ZardInputDirective);

    directive.disable(true);
    expect(await input.isDisabled()).toBe(true);

    directive.disable(false);
    expect(await input.isDisabled()).toBe(false);
  });

  it('should set aria-invalid when status is error', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#error-input'}),
    );
    expect(await input.getAriaInvalid()).toBe('true');
  });

  it('should set aria-describedby to matching error id when status is error and id is present', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#error-input'}),
    );
    expect(await input.getAriaDescribedBy()).toBe('error-input-error');
  });

  it('should update model when input value changes', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#model-input'}),
    );
    const component = fixture.componentInstance;

    expect(await input.getValue()).toBe('initial');

    await input.setValue('updated');
    expect(component.val()).toBe('updated');
  });

  it('should update input value when model changes', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#model-input'}),
    );
    const component = fixture.componentInstance;

    component.val.set('programmatic');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await input.getValue()).toBe('programmatic');
  });

  it('should remove placeholders from password inputs', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#password-placeholder'}),
    );

    expect(await input.getAttribute('placeholder')).toBeNull();
  });

  it('should remove placeholders from password autocomplete inputs', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#visible-password-placeholder'}),
    );

    expect(await input.getAttribute('placeholder')).toBeNull();
  });

  it('should preserve placeholders on non-password inputs', async () => {
    const input = await loader.getHarness(
      ZardInputHarness.with({selector: '#text-placeholder'}),
    );

    expect(await input.getAttribute('placeholder')).toBe('Your name');
  });
});
