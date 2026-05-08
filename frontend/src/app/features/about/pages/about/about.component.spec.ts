import {describe, it, expect, beforeEach, vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {AboutComponent} from './about.component';
import {AboutComponentHarness} from './about.component.harness';
import {PlatformContactDialogService} from '@/features/contact/platform-contact-dialog.service';

describe('AboutComponent', () => {
  let fixture: ComponentFixture<AboutComponent>;
  let harness: AboutComponentHarness;
  let contactDialogMock: {open: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    contactDialogMock = {open: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [AboutComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: PlatformContactDialogService, useValue: contactDialogMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AboutComponentHarness,
    );
  });

  describe('contact CTA', () => {
    it('should open the platform contact dialog when clicked', async () => {
      expect(await harness.isGetInTouchButtonPresent()).toBe(true);
      await harness.clickGetInTouch();

      expect(contactDialogMock.open).toHaveBeenCalledWith({
        subject: 'Working with Braket',
      });
    });
  });

  describe('platform & security section', () => {
    it('should link to privacy, terms, and support pages', async () => {
      expect(await harness.isPlatformSecuritySectionPresent()).toBe(true);
      expect(await harness.getLinkTargets()).toEqual(
        expect.arrayContaining(['/privacy', '/terms', '/support']),
      );
    });
  });

  describe('accessibility', () => {
    it('should have proper heading hierarchy (h1 before h2s)', async () => {
      expect(await harness.getHeadingTags()).toEqual(['H1', 'H2', 'H2']);
    });
  });
});
