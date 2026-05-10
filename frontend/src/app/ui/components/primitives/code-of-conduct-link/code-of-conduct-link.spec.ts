import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {BraCodeOfConductLinkComponent} from './code-of-conduct-link.component';
import {BraCodeOfConductLinkHarness} from './code-of-conduct-link.harness';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';

@Component({
  template: '',
  imports: [BraCodeOfConductLinkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {
  cocText = '';
}

describe('BraCodeOfConductLinkComponent', () => {
  const createSpy = vi.fn();

  beforeEach(() => {
    createSpy.mockReset();
  });

  async function setup(template: string) {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{provide: BraDialogService, useValue: {create: createSpy}}],
    });
    TestBed.overrideComponent(TestHostComponent, {set: {template}});
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const harness = await loader.getHarness(BraCodeOfConductLinkHarness);
    return {fixture, harness};
  }

  it('should render the link button', async () => {
    const {harness} = await setup(
      `<bra-code-of-conduct-link codeOfConduct="Be kind." />`,
    );
    expect(await harness.isVisible()).toBe(true);
    expect(await harness.getText()).toContain('code of conduct');
  });

  it('should open dialog with CoC content on click', async () => {
    const cocText = 'Respect the space and each other.';
    const {harness} = await setup(
      `<bra-code-of-conduct-link codeOfConduct="${cocText}" />`,
    );

    await harness.click();

    expect(createSpy).toHaveBeenCalledOnce();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Code of Conduct',
        zContent: cocText,
        zOkText: 'Close',
        zCancelText: null,
      }),
    );
  });

  it('should pass through multiline CoC content', async () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{provide: BraDialogService, useValue: {create: createSpy}}],
    });
    TestBed.overrideComponent(TestHostComponent, {
      set: {
        template: `<bra-code-of-conduct-link [codeOfConduct]="cocText" />`,
      },
    });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.cocText = multiline;
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const harness = await loader.getHarness(BraCodeOfConductLinkHarness);

    await harness.click();

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({zContent: multiline}),
    );
  });
});
