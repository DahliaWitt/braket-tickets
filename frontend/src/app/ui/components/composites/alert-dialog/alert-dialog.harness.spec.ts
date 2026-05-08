import '../../../../../test-setup';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  viewChild,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { BraAlertDialogComponent, BraAlertDialogOptions } from './alert-dialog.component';
import { BraAlertDialogHarness } from './alert-dialog.component.harness';
import { vi } from 'vitest';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<bra-alert-dialog />`,
  imports: [BraAlertDialogComponent],
})
class AlertDialogHarnessHostComponent {
  readonly dialog = viewChild.required<BraAlertDialogComponent<unknown>>(BraAlertDialogComponent);
}

describe('BraAlertDialogHarness', () => {
  let options: BraAlertDialogOptions<unknown>;
  let fixture: ComponentFixture<AlertDialogHarnessHostComponent>;

  const renderHarness = async (
    config: Partial<BraAlertDialogOptions<unknown>>,
  ): Promise<BraAlertDialogHarness> => {
    Object.assign(options, config);
    fixture = TestBed.createComponent(AlertDialogHarnessHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return TestbedHarnessEnvironment.loader(fixture).getHarness(BraAlertDialogHarness);
  };

  beforeEach(async () => {
    options = new BraAlertDialogOptions<unknown>();

    await TestBed.configureTestingModule({
      imports: [AlertDialogHarnessHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BraAlertDialogOptions, useFactory: () => options },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should read title/description/content and click action buttons', async () => {
    const harness = await renderHarness({
      zTitle: 'Delete ticket',
      zDescription: 'This cannot be undone',
      zContent: 'Permanent action',
      zCancelText: 'Cancel',
      zOkText: 'Delete',
    });

    const cancelSpy = vi.fn();
    const okSpy = vi.fn();
    fixture.componentInstance.dialog().cancelTriggered.subscribe(cancelSpy);
    fixture.componentInstance.dialog().okTriggered.subscribe(okSpy);

    expect(await harness.getTitleText()).toContain('Delete ticket');
    expect(await harness.getDescriptionText()).toContain('This cannot be undone');
    expect(await harness.getContentText()).toContain('Permanent action');
    expect(await harness.hasCancelButton()).toBe(true);
    expect(await harness.hasOkButton()).toBe(true);

    await harness.clickCancel();
    await harness.clickOk();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(okSpy).toHaveBeenCalledTimes(1);
  });

  it('should return null/false for optional elements when they are not rendered', async () => {
    const harness = await renderHarness({
      zTitle: undefined,
      zDescription: undefined,
      zContent: undefined,
      zCancelText: null,
      zOkText: null,
    });

    expect(await harness.getTitleText()).toBeNull();
    expect(await harness.getDescriptionText()).toBeNull();
    expect(await harness.getContentText()).toBeNull();
    expect(await harness.hasCancelButton()).toBe(false);
    expect(await harness.hasOkButton()).toBe(false);
  });

  it('should no-op click methods safely when buttons are absent', async () => {
    const harness = await renderHarness({
      zCancelText: null,
      zOkText: null,
    });

    await expect(harness.clickCancel()).resolves.toBeUndefined();
    await expect(harness.clickOk()).resolves.toBeUndefined();
  });
});
