import {ComponentPortal, TemplatePortal} from '@angular/cdk/portal';
import {type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  type TemplateRef,
  ViewContainerRef,
  inject,
  provideZonelessChangeDetection,
  viewChild,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {vi} from 'vitest';
import {BraDialogComponent, BraDialogOptions} from './dialog.component';
import {BraDialogHarness} from './dialog.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class PortalContentComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-template #contentTemplate>Template content</ng-template>`,
})
class TemplateHostComponent {
  readonly contentTemplate =
    viewChild.required<TemplateRef<unknown>>('contentTemplate');
  readonly viewContainerRef = inject(ViewContainerRef);
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<bra-dialog />`,
  imports: [BraDialogComponent],
})
class DialogHostComponent {
  readonly dialog =
    viewChild.required<BraDialogComponent<unknown, unknown>>(
      BraDialogComponent,
    );
}

describe('BraDialogComponent', () => {
  let fixture: ComponentFixture<DialogHostComponent>;
  let component: BraDialogComponent<unknown, unknown>;
  let loader: HarnessLoader;
  let options: BraDialogOptions<unknown, unknown>;

  const createDialog = async (
    configOverrides: Partial<BraDialogOptions<unknown, unknown>> = {},
  ): Promise<void> => {
    Object.assign(options, configOverrides);

    fixture = TestBed.createComponent(DialogHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    component = fixture.componentInstance.dialog();

    loader = TestbedHarnessEnvironment.loader(fixture);
  };

  beforeEach(async () => {
    options = new BraDialogOptions<unknown, unknown>();
    await TestBed.configureTestingModule({
      imports: [
        DialogHostComponent,
        PortalContentComponent,
        TemplateHostComponent,
      ],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDialogOptions, useFactory: () => options},
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render title, description, string content, and default footer labels', async () => {
    await createDialog({
      zTitle: 'Delete Ticket',
      zDescription: 'This action cannot be undone.',
      zContent: 'Dialog body',
    });

    const harness = await loader.getHarness(BraDialogHarness);

    expect(await harness.getRole()).toBe('dialog');
    expect(await harness.getTitleText()).toContain('Delete Ticket');
    expect(await harness.getDescriptionText()).toContain(
      'This action cannot be undone.',
    );
    expect(await harness.getContentText()).toContain('Dialog body');
    expect(await harness.getCancelText()).toContain('Cancel');
    expect(await harness.getOkText()).toContain('OK');
    expect(await harness.getAriaLabelledBy()).toContain('-title');
    expect(await harness.getAriaDescribedBy()).toContain('-description');
    expect(await harness.hasFocusTrapAnchors()).toBe(true);
    expect(await harness.isCancelInitialFocus()).toBe(true);
  });

  it('should hide close and footer actions when disabled by config', async () => {
    await createDialog({
      zClosable: false,
      zHideFooter: true,
    });

    const harness = await loader.getHarness(BraDialogHarness);

    expect(await harness.hasCloseHeaderButton()).toBe(false);
    expect(await harness.hasCancelButton()).toBe(false);
    expect(await harness.hasOkButton()).toBe(false);
    expect(await harness.getAriaLabelledBy()).toBeNull();
    expect(await harness.getAriaDescribedBy()).toBeNull();
    expect(await harness.isFallbackInitialFocus()).toBe(true);
  });

  it('should emit cancel and ok outputs from action buttons', async () => {
    await createDialog({
      zTitle: 'Confirm',
      zDescription: 'Choose an option',
    });

    const harness = await loader.getHarness(BraDialogHarness);
    const okSpy = vi.fn();
    const cancelSpy = vi.fn();

    component.okTriggered.subscribe(okSpy);
    component.cancelTriggered.subscribe(cancelSpy);

    await harness.clickOk();
    await harness.clickCancel();
    await harness.clickHeaderClose();

    expect(okSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(2);
  });

  it('should attach component portal once and throw on second attachment', async () => {
    await createDialog();

    const componentPortal = new ComponentPortal(PortalContentComponent);
    const attachedRef = component.attachComponentPortal(componentPortal);

    expect(attachedRef.instance).toBeTruthy();
    expect(() => component.attachComponentPortal(componentPortal)).toThrow(
      'Attempting to attach modal content after content is already attached',
    );
  });

  it('should attach template portal once and throw on second attachment', async () => {
    const templateHostFixture = TestBed.createComponent(TemplateHostComponent);
    templateHostFixture.detectChanges();
    await templateHostFixture.whenStable();

    await createDialog();

    const templatePortal = new TemplatePortal(
      templateHostFixture.componentInstance.contentTemplate(),
      templateHostFixture.componentInstance.viewContainerRef,
    );

    component.attachTemplatePortal(templatePortal);
    expect(() => component.attachTemplatePortal(templatePortal)).toThrow(
      'Attempting to attach modal content after content is already attached',
    );
  });
});
