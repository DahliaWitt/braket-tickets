import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {of} from 'rxjs';
import {describe, it, expect, vi} from 'vitest';
import {ConfirmSocialLinkComponent} from './confirm-social-link.component';
import {ConfirmSocialLinkComponentHarness} from './confirm-social-link.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {type ExternalAuth} from '@/features/auth/models/external-auth.model';

const GOOGLE_AUTH: ExternalAuth = {
  id: 'ext-1',
  provider: 'google',
  providerId: 'google-account-id',
};

describe('ConfirmSocialLinkComponent', () => {
  let fixture: ComponentFixture<ConfirmSocialLinkComponent>;
  let component: ConfirmSocialLinkComponent;
  let authServiceMock: {
    getExternalAuths: ReturnType<typeof vi.fn>;
    authInitialized: ReturnType<typeof signal<boolean>>;
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    user: ReturnType<typeof signal<unknown>>;
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };

  function createActivatedRoute(
    queryParams: Record<string, string | undefined>,
  ) {
    return {
      queryParamMap: of(convertToParamMap(queryParams)),
      snapshot: {
        queryParamMap: {
          get: (key: string) => queryParams[key] ?? null,
        },
      },
    };
  }

  async function setupComponent(
    queryParams: Record<string, string | undefined> = {},
    options: {
      externalAuths?: ExternalAuth[];
      authInitialized?: boolean;
      isAuthenticated?: boolean;
    } = {},
  ) {
    authServiceMock = {
      getExternalAuths: vi
        .fn()
        .mockResolvedValue(options.externalAuths ?? [GOOGLE_AUTH]),
      authInitialized: signal(options.authInitialized ?? true),
      isAuthenticated: signal(options.isAuthenticated ?? true),
      user: signal({}),
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmSocialLinkComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: ActivatedRoute, useValue: createActivatedRoute(queryParams)},
        {provide: AuthService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmSocialLinkComponent);
    component = fixture.componentInstance;
  }

  async function renderAndSettle() {
    fixture.detectChanges();
    await fixture.whenStable();
    // Drain the initialize() promise chain (retry helper + connected-accounts
    // read) — whenStable only awaits change detection, not test-mock promises.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  async function getHarness() {
    return TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ConfirmSocialLinkComponentHarness,
    );
  }

  it('confirms the link from the existing session without requiring an OTT', async () => {
    await setupComponent({provider: 'google'});
    await renderAndSettle();

    expect(authServiceMock.getExternalAuths).toHaveBeenCalled();
    expect(component.state()).toBe('success');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/account']);

    const harness = await getHarness();
    expect(await harness.isSuccess()).toBe(true);
  });

  it('stays in the loading state until auth bootstrap settles', async () => {
    await setupComponent({provider: 'google'}, {authInitialized: false});
    await renderAndSettle();

    expect(component.state()).toBe('loading');
    expect(authServiceMock.getExternalAuths).not.toHaveBeenCalled();

    authServiceMock.authInitialized.set(true);
    await renderAndSettle();
    await renderAndSettle();

    expect(component.state()).toBe('success');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('shows an error when the user has no session after the redirect', async () => {
    await setupComponent({provider: 'google'}, {isAuthenticated: false});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(authServiceMock.getExternalAuths).not.toHaveBeenCalled();

    const harness = await getHarness();
    expect(await harness.getStateText()).toContain(
      'Sign in to your account, then check Account Settings to confirm this connection.',
    );
  });

  it('rejects a missing provider parameter', async () => {
    await setupComponent({});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This provider link is invalid or expired. Please try again.',
    );
    expect(authServiceMock.getExternalAuths).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider parameter', async () => {
    await setupComponent({provider: 'https://evil.example'});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This provider link is invalid or expired. Please try again.',
    );
    expect(authServiceMock.getExternalAuths).not.toHaveBeenCalled();
  });

  it('shows a generic provider error when the callback reports a failure', async () => {
    await setupComponent({error: 'access_denied', provider: 'google'});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This provider could not be connected right now.',
    );
    expect(authServiceMock.getExternalAuths).not.toHaveBeenCalled();

    const harness = await getHarness();
    expect(await harness.isError()).toBe(true);
    expect(await harness.isBackToAccountVisible()).toBe(true);
  });

  it('retries the connected-accounts read before reporting success', async () => {
    vi.useFakeTimers();
    try {
      await setupComponent({provider: 'google'});
      authServiceMock.getExternalAuths
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([GOOGLE_AUTH]);

      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(500);

      expect(authServiceMock.getExternalAuths).toHaveBeenCalledTimes(2);
      expect(component.state()).toBe('success');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an unconfirmed link when the provider never appears in connected accounts', async () => {
    vi.useFakeTimers();
    try {
      await setupComponent({provider: 'google'}, {externalAuths: []});

      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(7500);

      expect(authServiceMock.getExternalAuths).toHaveBeenCalledTimes(5);
      expect(component.state()).toBe('error');
      expect(component.error()).toBe(
        'We could not confirm the connection. Check Account Settings to see if this login method is linked.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast without retries when the connected-accounts read is non-retryable', async () => {
    await setupComponent({provider: 'google'});
    authServiceMock.getExternalAuths.mockRejectedValue(
      new Error('Unauthorized'),
    );
    await renderAndSettle();

    expect(authServiceMock.getExternalAuths).toHaveBeenCalledTimes(1);
    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'We could not confirm the connection. Check Account Settings to see if this login method is linked.',
    );
  });
});
