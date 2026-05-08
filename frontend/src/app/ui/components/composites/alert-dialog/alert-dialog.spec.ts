import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { BraAlertDialogService } from './alert-dialog.service';
import { BraAlertDialogHarness } from './alert-dialog.component.harness';
import { OverlayModule } from '@angular/cdk/overlay';
import { PortalModule } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { vi } from 'vitest';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TestHostComponent {
  dialogService = inject(BraAlertDialogService);
}

describe('BraAlertDialog', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, OverlayModule, PortalModule],
      providers: [BraAlertDialogService],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should open and display title and description', async () => {
    component.dialogService.confirm({
      zTitle: 'Confirm Title',
      zDescription: 'Confirm Description',
      zOkText: 'Yes',
      zCancelText: 'No',
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogHarness);

    expect(await dialog.getTitleText()).toBe('Confirm Title');
    expect(await dialog.getDescriptionText()).toBe('Confirm Description');
    expect(await dialog.hasCancelButton()).toBe(true);
  });

  it('should trigger zOnOk callback when OK button is clicked', async () => {
    const okSpy = vi.fn();
    component.dialogService.confirm({
      zTitle: 'Confirm Title',
      zOnOk: okSpy,
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogHarness);
    await dialog.clickOk();

    expect(okSpy).toHaveBeenCalled();
  });

  it('should trigger zOnCancel callback when Cancel button is clicked', async () => {
    const cancelSpy = vi.fn();
    component.dialogService.confirm({
      zTitle: 'Confirm Title',
      zOnCancel: cancelSpy,
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogHarness);
    await dialog.clickCancel();

    expect(cancelSpy).toHaveBeenCalled();
  });

  it('should display warning with content and no cancel button by default', async () => {
    component.dialogService.warning({
      zTitle: 'Warning',
      zContent: 'Be careful',
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogHarness);

    expect(await dialog.getTitleText()).toBe('Warning');
    expect(await dialog.getContentText()).toBe('Be careful');
    expect(await dialog.hasCancelButton()).toBe(false);
  });
});
