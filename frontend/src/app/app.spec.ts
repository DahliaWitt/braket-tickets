import {ChangeDetectionStrategy, Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  provideRouter,
  Router,
} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {App, isInitialNavigationTerminalEvent} from './app';
import {AppHarness} from './app.harness';
import {SeoService} from '@/core/services/seo.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>Ready</p>`,
})
class ReadyComponent {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{path: 'ready', component: ReadyComponent}]),
        {provide: SeoService, useValue: {init: vi.fn()}},
      ],
    }).compileComponents();
  });

  it('keeps a first-load shell visible until initial routing settles', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AppHarness,
    );

    fixture.detectChanges();
    expect(await harness.isInitialRouteShellVisible()).toBe(true);
    expect(await harness.getInitialRouteShellText()).toContain(
      'Opening Braket',
    );

    await router.navigateByUrl('/ready');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(await harness.isInitialRouteShellVisible()).toBe(false);
  });

  it('does not treat redirect or superseded cancellations as initial navigation completion', () => {
    expect(
      isInitialNavigationTerminalEvent(
        new NavigationCancel(
          1,
          '/community-admin/pending',
          'Redirecting to /login',
          NavigationCancellationCode.Redirect,
        ),
      ),
    ).toBe(false);
    expect(
      isInitialNavigationTerminalEvent(
        new NavigationCancel(
          2,
          '/community-admin/pending',
          'Superseded by another navigation',
          NavigationCancellationCode.SupersededByNewNavigation,
        ),
      ),
    ).toBe(false);
    expect(
      isInitialNavigationTerminalEvent(
        new NavigationCancel(
          3,
          '/community-admin/pending',
          'Guard rejected',
          NavigationCancellationCode.GuardRejected,
        ),
      ),
    ).toBe(true);
    expect(
      isInitialNavigationTerminalEvent(
        new NavigationEnd(4, '/login', '/login'),
      ),
    ).toBe(true);
  });
});
