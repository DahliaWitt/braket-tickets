import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ZardFormFieldComponent, ZardFormLabelComponent, ZardFormMessageComponent } from './form-field.component';
import { ZardFormLabelHarness, ZardFormMessageHarness } from './form-field.harness';

@Component({
  template: `
    <z-form-field>
      <label z-form-label for="test-input" [zRequired]="true">Email</label>
      <input id="test-input" />
      <z-form-message zType="error">Required</z-form-message>
    </z-form-field>
  `,
  imports: [ZardFormFieldComponent, ZardFormLabelComponent, ZardFormMessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {}

describe('ZardFormFieldComponent', () => {
  async function setup(template?: string) {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    if (template) {
      TestBed.overrideComponent(TestHostComponent, { set: { template } });
    }
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    return TestbedHarnessEnvironment.loader(fixture);
  }

  it('should render label with mono-label styling', async () => {
    const loader = await setup();
    const label = await loader.getHarness(ZardFormLabelHarness);
    expect(await label.getText()).toContain('Email');
  });

  it('should show required indicator', async () => {
    const loader = await setup();
    const label = await loader.getHarness(ZardFormLabelHarness);
    expect(await label.isRequired()).toBe(true);
  });

  it('should render error message', async () => {
    const loader = await setup();
    const msg = await loader.getHarness(ZardFormMessageHarness);
    expect(await msg.getText()).toBe('Required');
    expect(await msg.getType()).toBe('error');
  });

  it('should render success message', async () => {
    const loader = await setup(`
      <z-form-field>
        <z-form-message zType="success">Valid</z-form-message>
      </z-form-field>
    `);
    const msg = await loader.getHarness(ZardFormMessageHarness);
    expect(await msg.getType()).toBe('success');
  });
});
