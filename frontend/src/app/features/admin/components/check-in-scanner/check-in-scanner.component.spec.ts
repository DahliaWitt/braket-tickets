import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi} from 'vitest';
import {CheckInScannerComponent} from './check-in-scanner.component';
import {CheckInScannerComponentHarness} from './check-in-scanner.component.harness';
import {QR_SCANNER_CTOR} from './qr-scanner.token';

class MockQrScanner {
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn();
  destroy = vi.fn();
}

class FailingQrScanner {
  start = vi.fn().mockRejectedValue(new Error('Permission denied'));
  stop = vi.fn();
  destroy = vi.fn();
}

describe('CheckInScannerComponent', () => {
  let fixture: ComponentFixture<CheckInScannerComponent>;
  let harness: CheckInScannerComponentHarness;

  beforeEach(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([{kind: 'videoinput', deviceId: '1'}]),
      },
      writable: true,
    });

    await TestBed.configureTestingModule({
      imports: [CheckInScannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: QR_SCANNER_CTOR, useValue: MockQrScanner},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckInScannerComponent);
    fixture.componentRef.setInput('isExpanded', false);
    fixture.componentRef.setInput('isProcessing', false);
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CheckInScannerComponentHarness,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should have aria-live region present in the DOM when no result is set', async () => {
    expect(await harness.isScanResultRegionPresent()).toBe(true);
    expect(await harness.isCheckInResultVisible()).toBe(false);
  });

  it('should show scan result inside the live region when a success result is set', async () => {
    fixture.componentRef.setInput('lastResult', {
      success: true,
      message: 'Successfully checked in',
      ticket: {
        _id: 'ticket-abc123',
        tier: 'regular',
        user: {name: 'Test User', email: 'test@example.com'},
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isScanResultRegionPresent()).toBe(true);
    expect(await harness.isCheckInResultVisible()).toBe(true);
  });

  it('should show scan result inside the live region when a failure result is set', async () => {
    fixture.componentRef.setInput('lastResult', {
      success: false,
      message: 'Ticket is already used',
      ticket: null,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isScanResultRegionPresent()).toBe(true);
    expect(await harness.isCheckInResultVisible()).toBe(true);
  });

  it('clears duplicate scan suppression after a failed check-in result', async () => {
    const scannedSpy = vi.fn();
    fixture.componentInstance.scanned.subscribe(scannedSpy);

    fixture.componentInstance.handleQRCodeDetected('ticket-retry');
    fixture.componentInstance.handleQRCodeDetected('ticket-retry');

    expect(scannedSpy).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('lastResult', {
      success: false,
      message: 'Temporary scanner failure',
      ticket: null,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.handleQRCodeDetected('ticket-retry');
    fixture.componentInstance.handleQRCodeDetected('ticket-retry');

    expect(scannedSpy).toHaveBeenCalledTimes(2);
  });

  it('should hide result content but keep aria-live region after result is cleared', async () => {
    fixture.componentRef.setInput('lastResult', {
      success: true,
      message: 'Successfully checked in',
      ticket: null,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isCheckInResultVisible()).toBe(true);

    fixture.componentRef.setInput('lastResult', null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isScanResultRegionPresent()).toBe(true);
    expect(await harness.isCheckInResultVisible()).toBe(false);
  });

  it('shows actionable recovery guidance and allows retry when camera startup fails', async () => {
    TestBed.resetTestingModule();

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([{kind: 'videoinput', deviceId: '1'}]),
      },
      writable: true,
    });

    await TestBed.configureTestingModule({
      imports: [CheckInScannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: QR_SCANNER_CTOR, useValue: FailingQrScanner},
      ],
    }).compileComponents();

    const failingFixture = TestBed.createComponent(CheckInScannerComponent);
    failingFixture.componentRef.setInput('isExpanded', true);
    failingFixture.componentRef.setInput('isProcessing', false);
    failingFixture.detectChanges();
    await failingFixture.whenStable();
    const failingHarness = await TestbedHarnessEnvironment.harnessForFixture(
      failingFixture,
      CheckInScannerComponentHarness,
    );

    await failingHarness.clickStartScanner();
    failingFixture.detectChanges();
    await failingFixture.whenStable();

    const errorText = await failingHarness.getCameraStartupErrorText();
    expect(errorText).toContain('Camera could not start');
    expect(errorText).toContain('Check browser camera permission');
    expect(failingFixture.componentInstance.hasCamera()).toBe(true);
  });
});
