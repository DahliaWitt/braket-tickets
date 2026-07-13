import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {toast} from 'ngx-sonner';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {
  PlatformContactDialogComponent,
  type PlatformContactDialogData,
} from './platform-contact-dialog.component';
import {PlatformContactDialogHarness} from './platform-contact-dialog.component.harness';

describe('PlatformContactDialogComponent', () => {
  let fixture: ComponentFixture<PlatformContactDialogComponent>;
  let harness: PlatformContactDialogHarness;
  let dialogData: PlatformContactDialogData;
  const dialogRef = {
    close: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    dialogData = {
      email: 'contact@braket.gay',
      mailtoHref: 'mailto:contact@braket.gay?subject=Working%20with%20Braket',
    };

    await TestBed.configureTestingModule({
      imports: [PlatformContactDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BRA_MODAL_DATA, useFactory: () => dialogData},
        {provide: BraDialogRef, useValue: dialogRef},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlatformContactDialogComponent);
    fixture.detectChanges();
    dialogRef.close.mockReset();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      PlatformContactDialogHarness,
    );
  });

  it('shows the platform email address', async () => {
    expect(await harness.getEmailText()).toBe('contact@braket.gay');
  });

  it('exposes the mail client action as a real mailto link', async () => {
    expect(await harness.getOpenMailHref()).toBe(
      'mailto:contact@braket.gay?subject=Working%20with%20Braket',
    );
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('renders the mail client action through the z-button kit variant', async () => {
    expect(await harness.getOpenMailButtonType()).toBe('default');
  });

  it('copies the email and keeps the dialog open', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');

    await harness.clickCopyEmail();

    expect(writeText).toHaveBeenCalledWith('contact@braket.gay');
    expect(successSpy).toHaveBeenCalledWith('email copied');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes from the done action', async () => {
    await harness.clickClose();

    expect(dialogRef.close).toHaveBeenCalled();
  });
});
