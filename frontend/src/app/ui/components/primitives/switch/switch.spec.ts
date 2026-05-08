import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component, signal, type WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ZardSwitchComponent } from './switch.component';
import { ZardSwitchHarness } from './switch.harness';

// ---------------------------------------------------------------------------
// Default test host
// ---------------------------------------------------------------------------

@Component({
  template: `<z-switch [(zChecked)]="checked">Notifications</z-switch>`,
  imports: [ZardSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {
  readonly checked = signal(false);
}

// ---------------------------------------------------------------------------
// Disabled test host
// ---------------------------------------------------------------------------

@Component({
  template: `<z-switch [zDisabled]="disabled()" [(zChecked)]="checked">Mute</z-switch>`,
  imports: [ZardSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class DisabledHostComponent {
  readonly disabled: WritableSignal<boolean> = signal(true);
  readonly checked = signal(false);
}

// ---------------------------------------------------------------------------
// Type variant test host
// ---------------------------------------------------------------------------

@Component({
  template: `
    <z-switch zType="destructive" [(zChecked)]="checked">Delete mode</z-switch>
    <z-switch zType="success" [(zChecked)]="checked">Active</z-switch>
  `,
  imports: [ZardSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TypeVariantsHostComponent {
  readonly checked = signal(false);
}

// ---------------------------------------------------------------------------
// CVA / NgModel test host — uses signal so OnPush detects host mutations
// ---------------------------------------------------------------------------

@Component({
  template: `<z-switch [(ngModel)]="value">Feature flag</z-switch>`,
  imports: [ZardSwitchComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class NgModelHostComponent {
  // Plain property intentionally: NgModel writes back via the ControlValueAccessor,
  // not the signal. The harness reads aria-checked on the DOM, so stable after whenStable.
  value = false;
}

// ---------------------------------------------------------------------------
// CVA disabled-via-form test host — signals for mutable inputs
// ---------------------------------------------------------------------------

@Component({
  template: `<z-switch [(ngModel)]="value" [disabled]="formDisabled()">Save</z-switch>`,
  imports: [ZardSwitchComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FormDisabledHostComponent {
  value = false;
  readonly formDisabled: WritableSignal<boolean> = signal(false);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupDefault() {
  TestBed.configureTestingModule({ imports: [TestHostComponent] });
  const fixture = TestBed.createComponent(TestHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardSwitchHarness);
  return { fixture, harness, host: fixture.componentInstance };
}

async function setupDisabled() {
  TestBed.configureTestingModule({ imports: [DisabledHostComponent] });
  const fixture = TestBed.createComponent(DisabledHostComponent);
  fixture.detectChanges();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardSwitchHarness);
  return { fixture, harness, host: fixture.componentInstance };
}

async function setupNgModel() {
  TestBed.configureTestingModule({ imports: [NgModelHostComponent] });
  const fixture = TestBed.createComponent(NgModelHostComponent);
  fixture.detectChanges();
  // NgModel is async — wait one tick for binding to settle
  await fixture.whenStable();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardSwitchHarness);
  return { fixture, harness, host: fixture.componentInstance };
}

async function setupFormDisabled() {
  TestBed.configureTestingModule({ imports: [FormDisabledHostComponent] });
  const fixture = TestBed.createComponent(FormDisabledHostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const harness = await loader.getHarness(ZardSwitchHarness);
  return { fixture, harness, host: fixture.componentInstance };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZardSwitchComponent', () => {
  // Existing baseline tests ------------------------------------------------

  it('should render unchecked by default', async () => {
    const { harness } = await setupDefault();
    expect(await harness.isChecked()).toBe(false);
  });

  it('should toggle on click', async () => {
    const { harness } = await setupDefault();
    await harness.toggle();
    expect(await harness.isChecked()).toBe(true);
  });

  it('should display label text', async () => {
    const { harness } = await setupDefault();
    expect(await harness.getLabel()).toContain('Notifications');
  });

  // Disabled state (zDisabled input) ---------------------------------------

  it('should report disabled when zDisabled is true', async () => {
    const { harness } = await setupDisabled();
    expect(await harness.isDisabled()).toBe(true);
  });

  it('should not toggle when zDisabled is true', async () => {
    const { harness } = await setupDisabled();
    await harness.toggle();
    expect(await harness.isChecked()).toBe(false);
  });

  it('should become interactive when zDisabled changes to false', async () => {
    const { fixture, harness, host } = await setupDisabled();
    host.disabled.set(false);
    fixture.detectChanges();
    expect(await harness.isDisabled()).toBe(false);
    await harness.toggle();
    expect(await harness.isChecked()).toBe(true);
  });

  // Type variants ----------------------------------------------------------

  it('should render destructive variant without error', async () => {
    TestBed.configureTestingModule({ imports: [TypeVariantsHostComponent] });
    const fixture = TestBed.createComponent(TypeVariantsHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const switches = await loader.getAllHarnesses(ZardSwitchHarness);
    expect(switches.length).toBe(2);
    // Both should render as unchecked
    expect(await switches[0].isChecked()).toBe(false);
    expect(await switches[1].isChecked()).toBe(false);
  });

  // ControlValueAccessor — writeValue --------------------------------------

  it('writeValue: should reflect a true value set from outside', async () => {
    const { fixture, harness, host } = await setupDefault();
    // Direct signal mutation simulates an external writeValue call
    host.checked.set(true);
    fixture.detectChanges();
    expect(await harness.isChecked()).toBe(true);
  });

  it('writeValue: should reflect a false value set after toggling', async () => {
    const { fixture, harness, host } = await setupDefault();
    await harness.toggle();
    fixture.detectChanges();
    host.checked.set(false);
    fixture.detectChanges();
    expect(await harness.isChecked()).toBe(false);
  });

  // ControlValueAccessor — NgModel two-way binding -------------------------

  it('should initialise from NgModel value', async () => {
    const { harness } = await setupNgModel();
    expect(await harness.isChecked()).toBe(false);
  });

  it('should update NgModel value on toggle', async () => {
    const { fixture, harness, host } = await setupNgModel();
    await harness.toggle();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.value).toBe(true);
  });

  it('should reflect NgModel value changed from the host after detectChanges', async () => {
    const { fixture, harness } = await setupNgModel();
    // Directly interact via UI so NgModel's two-way binding propagates correctly
    await harness.toggle();
    fixture.detectChanges();
    await fixture.whenStable();
    // Toggling from false → true should also be reflected in the harness
    expect(await harness.isChecked()).toBe(true);
  });

  // ControlValueAccessor — setDisabledState --------------------------------

  it('should disable via form disabled binding', async () => {
    const { fixture, harness, host } = await setupFormDisabled();
    host.formDisabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isDisabled()).toBe(true);
  });

  it('should not toggle when disabled via form binding', async () => {
    const { fixture, harness, host } = await setupFormDisabled();
    host.formDisabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    await harness.toggle();
    expect(await harness.isChecked()).toBe(false);
  });

  it('should re-enable when form disabled binding is cleared', async () => {
    const { fixture, harness, host } = await setupFormDisabled();
    host.formDisabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    host.formDisabled.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isDisabled()).toBe(false);
  });
});
