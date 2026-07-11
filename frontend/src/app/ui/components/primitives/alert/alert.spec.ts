import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {ZardAlertComponent} from './alert.component';
import {ZardAlertHarness} from './alert.harness';

@Component({
  template: `<z-alert
    zType="default"
    zTitle="Test Title"
    zDescription="Test Description"
  />`,
  imports: [ZardAlertComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {}

describe('ZardAlertComponent', () => {
  async function setup(template: string) {
    TestBed.configureTestingModule({imports: [TestHostComponent]});
    TestBed.overrideComponent(TestHostComponent, {set: {template}});
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    return loader.getHarness(ZardAlertHarness);
  }

  it('should render with default type', async () => {
    const harness = await setup(
      `<z-alert zTitle="Hello" zDescription="World" />`,
    );
    expect(await harness.getType()).toBe('default');
    expect(await harness.getRole()).toBe('alert');
  });

  it('should render success type', async () => {
    const harness = await setup(`<z-alert zType="success" zTitle="Done" />`);
    expect(await harness.getType()).toBe('success');
  });

  it('should render warning type', async () => {
    const harness = await setup(`<z-alert zType="warning" zTitle="Caution" />`);
    expect(await harness.getType()).toBe('warning');
  });

  it('should render error type', async () => {
    const harness = await setup(`<z-alert zType="error" zTitle="Failed" />`);
    expect(await harness.getType()).toBe('error');
  });

  it('should render info type', async () => {
    const harness = await setup(`<z-alert zType="info" zTitle="Note" />`);
    expect(await harness.getType()).toBe('info');
  });

  it('should use the paired foreground token for the description on fill appearance', async () => {
    const harness = await setup(
      `<z-alert zType="success" zAppearance="fill" zTitle="Done" zDescription="Saved" />`,
    );
    expect(await harness.descriptionHasClass('text-success-foreground')).toBe(
      true,
    );
    // The per-type tint would be self-on-self (text-success on bg-success ≈ 1:1)
    expect(await harness.descriptionHasClass('text-success/90')).toBe(false);
  });

  it('should use the warning foreground token for the description on warning fill', async () => {
    const harness = await setup(
      `<z-alert zType="warning" zAppearance="fill" zTitle="Heads up" zDescription="Check this" />`,
    );
    expect(await harness.descriptionHasClass('text-warning-foreground')).toBe(
      true,
    );
    expect(await harness.descriptionHasClass('text-warning/90')).toBe(false);
  });

  it('should keep the tinted description color at full opacity on soft appearance', async () => {
    const harness = await setup(
      `<z-alert zType="success" zAppearance="soft" zTitle="Done" zDescription="Saved" />`,
    );
    expect(await harness.descriptionHasClass('text-success')).toBe(true);
    // AA-calibrated text tokens are never alpha-modified — /90 drops below AA
    expect(await harness.descriptionHasClass('text-success/90')).toBe(false);
    expect(await harness.descriptionHasClass('text-success-foreground')).toBe(
      false,
    );
  });

  it('should keep the destructive text token at full opacity on error descriptions', async () => {
    const harness = await setup(
      `<z-alert zType="error" zTitle="Failed" zDescription="Try again" />`,
    );
    expect(await harness.descriptionHasClass('text-destructive-text')).toBe(
      true,
    );
    expect(await harness.descriptionHasClass('text-destructive-text/90')).toBe(
      false,
    );
  });
});
