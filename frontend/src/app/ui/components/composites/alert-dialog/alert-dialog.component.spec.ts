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
import {
  BraAlertDialogComponent,
  BraAlertDialogOptions,
} from './alert-dialog.component';
import {BraAlertDialogComponentHarness} from './alert-dialog.component.harness';

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
  template: `<bra-alert-dialog />`,
  imports: [BraAlertDialogComponent],
})
class AlertDialogHostComponent {
  readonly dialog = viewChild.required<BraAlertDialogComponent<unknown>>(
    BraAlertDialogComponent,
  );
}

describe('BraAlertDialogComponent', () => {
  let fixture: ComponentFixture<AlertDialogHostComponent>;
  let component: BraAlertDialogComponent<unknown>;
  let loader: HarnessLoader;
  let options: BraAlertDialogOptions<unknown>;

  const createDialog = async (
    configOverrides: Partial<BraAlertDialogOptions<unknown>> = {},
  ): Promise<void> => {
    Object.assign(options, configOverrides);

    fixture = TestBed.createComponent(AlertDialogHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    component = fixture.componentInstance.dialog();
    loader = TestbedHarnessEnvironment.loader(fixture);
  };

  beforeEach(async () => {
    options = new BraAlertDialogOptions<unknown>();

    await TestBed.configureTestingModule({
      imports: [
        AlertDialogHostComponent,
        PortalContentComponent,
        TemplateHostComponent,
      ],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraAlertDialogOptions, useFactory: () => options},
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize alert dialog options defaults', () => {
    const config = new BraAlertDialogOptions<unknown>();

    expect(config.zOnOk).toBeTypeOf('function');
    expect(config.zOnCancel).toBeTypeOf('function');
    expect(config.zCancelText).toBeUndefined();
    expect(config.zOkText).toBeUndefined();
  });

  it('should render title, description, and string content', async () => {
    await createDialog({
      zTitle: 'Delete event',
      zDescription: 'This cannot be undone',
      zContent: 'Confirm deletion',
    });

    const harness = await loader.getHarness(BraAlertDialogComponentHarness);

    expect(await harness.getTitleText()).toContain('Delete event');
    expect(await harness.getDescriptionText()).toContain(
      'This cannot be undone',
    );
    expect(await harness.getContentText()).toContain('Confirm deletion');
    expect(await harness.getCancelAriaLabel()).toBeNull();
    expect(await harness.getOkAriaLabel()).toBeNull();
    expect(await harness.hasFocusTrapAnchors()).toBe(true);
    expect(await harness.isCancelInitialFocus()).toBe(true);
  });

  it('should use fallback aria-labels when no title is provided', async () => {
    await createDialog({
      zContent: 'No title provided',
    });

    const harness = await loader.getHarness(BraAlertDialogComponentHarness);

    expect(await harness.getCancelAriaLabel()).toBe('Cancel dialog');
    expect(await harness.getOkAriaLabel()).toBe('Confirm dialog');
  });

  it('should hide action buttons when text is null', async () => {
    await createDialog({
      zCancelText: null,
      zOkText: null,
    });

    const harness = await loader.getHarness(BraAlertDialogComponentHarness);

    expect(await harness.hasCancelButton()).toBe(false);
    expect(await harness.hasOkButton()).toBe(false);
    expect(await harness.isFallbackInitialFocus()).toBe(true);
  });

  it('should emit cancel and ok outputs from action clicks', async () => {
    await createDialog({
      zTitle: 'Confirm action',
      zCancelText: 'Back',
      zOkText: 'Continue',
    });

    const harness = await loader.getHarness(BraAlertDialogComponentHarness);
    const cancelSpy = vi.fn();
    const okSpy = vi.fn();

    component.cancelTriggered.subscribe(cancelSpy);
    component.okTriggered.subscribe(okSpy);

    await harness.clickCancel();
    await harness.clickOk();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(okSpy).toHaveBeenCalledTimes(1);
  });

  it('should attach component portal once and throw on second attachment', async () => {
    await createDialog();

    const portal = new ComponentPortal(PortalContentComponent);
    const attachedRef = component.attachComponentPortal(portal);

    expect(attachedRef.instance).toBeTruthy();
    expect(() => component.attachComponentPortal(portal)).toThrow(
      'Attempting to attach alert dialog content after content is already attached',
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
      'Attempting to attach alert dialog content after content is already attached',
    );
  });
});
