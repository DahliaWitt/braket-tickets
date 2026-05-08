import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ZardAlertComponent } from './alert.component';
import { ZardAlertHarness } from './alert.harness';

@Component({
  template: `<z-alert zType="default" zTitle="Test Title" zDescription="Test Description" />`,
  imports: [ZardAlertComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {}

describe('ZardAlertComponent', () => {
  async function setup(template: string) {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    TestBed.overrideComponent(TestHostComponent, { set: { template } });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    return loader.getHarness(ZardAlertHarness);
  }

  it('should render with default type', async () => {
    const harness = await setup(`<z-alert zTitle="Hello" zDescription="World" />`);
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
});
