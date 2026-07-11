import {describe, it, expect} from 'vitest';
import {vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {NotFoundComponent} from './not-found.component';
import {NotFoundComponentHarness} from './not-found.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;
  let convexMock: MockConvexClient;
  let harness: NotFoundComponentHarness;

  beforeEach(async () => {
    const authServiceSpy = {user: signal(null), isAuthenticated: signal(false)};
    convexMock = createMockConvexClient();
    convexMock.client.onUpdate = vi.fn().mockReturnValue(() => void 0);
    convexMock.onUpdate = convexMock.client.onUpdate;

    await TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{path: 'dashboard', component: NotFoundComponent}]),
        {provide: AuthService, useValue: authServiceSpy},
        {provide: CONVEX, useValue: convexMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      NotFoundComponentHarness,
    );
  });

  describe('navigation', () => {
    it('should route the Go Home button to the home page', async () => {
      await expect(harness.getGoHomeRouterLink()).resolves.toBe('/');
    });
  });

  describe('copy', () => {
    it('should say the page does not exist instead of claiming a fix is underway', async () => {
      const body = await harness.getBodyText();
      expect(body).toContain("this page doesn't exist");
      expect(body).not.toMatch(/working vewy hawd|fix this/i);
    });
  });

  describe('accessibility', () => {
    it('should have aria-label on go home action', async () => {
      await expect(harness.getGoHomeAriaLabel()).resolves.toBe(
        'Navigate to home',
      );
    });

    it('should have proper heading hierarchy', () => {
      return expect(harness.getHeadingText()).resolves.toBe('404');
    });
  });
});
