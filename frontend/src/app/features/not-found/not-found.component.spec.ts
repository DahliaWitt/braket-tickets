import {describe, it, expect} from 'vitest';
import {vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import type {HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {NotFoundComponent} from './not-found.component';
import {NotFoundComponentHarness} from './not-found.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {ZardButtonComponentHarness} from '@/ui/components/primitives/button/button.component.harness';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;
  let convexMock: MockConvexClient;
  let loader: HarnessLoader;
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
    loader = TestbedHarnessEnvironment.loader(fixture);
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

  describe('accessibility', () => {
    it('should have aria-label on go home button', async () => {
      const button = await loader.getHarness(
        ZardButtonComponentHarness.with({text: 'Go Home'}),
      );
      const host = await button.host();
      expect(await host.getAttribute('aria-label')).toBe('Navigate to home');
    });

    it('should have proper heading hierarchy', () => {
      return expect(harness.getHeadingText()).resolves.toBe('404');
    });
  });
});
