import {describe, it, expect, beforeEach} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {SupportComponent} from './support.component';
import {SupportComponentHarness} from './support.component.harness';
import {ZardButtonComponentHarness} from '@/ui/components/primitives/button/button.component.harness';

describe('SupportComponent', () => {
  let fixture: ComponentFixture<SupportComponent>;
  let harness: SupportComponentHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupportComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportComponent);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SupportComponentHarness,
    );
  });

  describe('email support button', () => {
    it('should expose a real mailto link on the email support action', async () => {
      expect(await harness.isEmailSupportButtonVisible()).toBe(true);
      const button = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        ZardButtonComponentHarness.with({text: /EMAIL SUPPORT/}),
      );

      expect(await button.getHref()).toBe(
        'mailto:contact@braket.gay?subject=Braket%20support',
      );
      expect(await harness.getEmailSupportHref()).toBe(
        'mailto:contact@braket.gay?subject=Braket%20support',
      );
      expect(await harness.getManualContactHref()).toBe(
        'mailto:contact@braket.gay?subject=Braket%20support',
      );
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
