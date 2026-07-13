import {describe, it, expect, beforeEach, vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {SupportComponent} from './support.component';
import {SupportComponentHarness} from './support.component.harness';
import {PlatformContactDialogService} from '@/features/contact/platform-contact-dialog.service';

describe('SupportComponent', () => {
  let fixture: ComponentFixture<SupportComponent>;
  let harness: SupportComponentHarness;
  let contactDialogMock: {open: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    contactDialogMock = {open: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [SupportComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: PlatformContactDialogService, useValue: contactDialogMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportComponent);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SupportComponentHarness,
    );
  });

  describe('email support button', () => {
    it('should open the platform contact dialog with the support subject', async () => {
      expect(await harness.isEmailSupportButtonVisible()).toBe(true);

      await harness.clickEmailSupport();

      expect(contactDialogMock.open).toHaveBeenCalledWith({
        subject: 'Braket support',
      });
    });
  });

  describe('accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      const heading = await harness.getMainHeadingText();
      const h2Count = await harness.getH2Count();

      expect(heading).toBeTruthy();
      expect(h2Count).toBeGreaterThanOrEqual(2);
    });
  });
});
