import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {of} from 'rxjs';
import {describe, expect, it, vi} from 'vitest';
import {ConfirmVerificationComponent} from './confirm-verification.component';
import {ConfirmVerificationComponentHarness} from './confirm-verification.component.harness';
import {AuthService} from '@/core/services/auth.service';

describe('ConfirmVerificationComponent', () => {
  interface TestSignal<T> {
    (): T;
    set: (value: T) => void;
  }

  let fixture: ComponentFixture<ConfirmVerificationComponent>;
  let component: ConfirmVerificationComponent;
  let authServiceMock: {
    handleOAuthCallback: ReturnType<typeof vi.fn>;
    confirmVerification: ReturnType<typeof vi.fn>;
    authInitialized: TestSignal<boolean>;
    isAuthenticated: TestSignal<boolean>;
    user: TestSignal<object | null>;
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
    navigateByUrl: ReturnType<typeof vi.fn>;
  };
  let authInitializedSignal: TestSignal<boolean>;
  let isAuthenticatedSignal: TestSignal<boolean>;
  let userSignal: TestSignal<object | null>;

  function createActivatedRoute(
    queryParams: Record<string, string | undefined>,
  ) {
    const emptyParamMap = convertToParamMap({});
    const queryParamMap = convertToParamMap(queryParams);
    return {
      paramMap: of(emptyParamMap),
      queryParamMap: of(queryParamMap),
      snapshot: {
        paramMap: {
          get: (_key: string) => null,
        },
        queryParamMap: {
          get: (key: string) => queryParams[key] ?? null,
        },
      },
    };
  }

  async function setupComponent(
    queryParams: Record<string, string | undefined> = {},
  ) {
    authInitializedSignal = signal(true);
    isAuthenticatedSignal = signal(true);
    userSignal = signal<object | null>({_id: 'user-1'});

    authServiceMock = {
      handleOAuthCallback: vi
        .fn()
        .mockResolvedValue({requiresSocialSignupCompletion: false}),
      confirmVerification: vi.fn().mockResolvedValue(undefined),
      authInitialized: authInitializedSignal,
      isAuthenticated: isAuthenticatedSignal,
      user: userSignal,
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmVerificationComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: ActivatedRoute, useValue: createActivatedRoute(queryParams)},
        {provide: AuthService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmVerificationComponent);
    component = fixture.componentInstance;
  }

  async function renderAndSettle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('uses the OTT callback path when present', async () => {
    await setupComponent({ott: 'ott-token'});
    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).toHaveBeenCalledWith(
      'ott-token',
      {
        navigateOnSuccess: false,
      },
    );
    expect(authServiceMock.confirmVerification).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('falls back to the verification token path when ott is absent', async () => {
    await setupComponent({token: 'verify-token'});
    await renderAndSettle();

    expect(authServiceMock.confirmVerification).toHaveBeenCalledWith(
      'verify-token',
    );
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('redirects to a safe returnUrl after email verification', async () => {
    await setupComponent({
      token: 'verify-token',
      returnUrl: '/admin-invite/test-token',
    });
    await renderAndSettle();

    expect(authServiceMock.confirmVerification).toHaveBeenCalledWith(
      'verify-token',
    );
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/admin-invite/test-token',
    );
  });

  it('redirects no-token backend verification callbacks when already authenticated', async () => {
    await setupComponent({
      returnUrl: '/admin-invite/test-token',
    });
    await renderAndSettle();

    expect(authServiceMock.confirmVerification).not.toHaveBeenCalled();
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/admin-invite/test-token',
    );
  });

  it('shows an error for no-token callbacks that settle unauthenticated', async () => {
    await setupComponent({
      returnUrl: '/admin-invite/test-token',
    });
    isAuthenticatedSignal.set(false);
    userSignal.set(null);

    await renderAndSettle();

    expect(authServiceMock.confirmVerification).not.toHaveBeenCalled();
    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'Verification did not create a signed-in session.',
    );
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows an expired-link error for a TOKEN_EXPIRED callback without touching verification APIs', async () => {
    await setupComponent({error: 'TOKEN_EXPIRED'});
    await renderAndSettle();

    expect(authServiceMock.confirmVerification).not.toHaveBeenCalled();
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This verification link has expired. Please sign in and request a new one.',
    );
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ConfirmVerificationComponentHarness,
    );
    expect(await harness.isError()).toBe(true);
    expect(await harness.getErrorText()).toBe(
      'This verification link has expired. Please sign in and request a new one.',
    );
  });

  it('shows an invalid-link error for a non-expiry error code', async () => {
    await setupComponent({error: 'INVALID_TOKEN'});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This verification link is invalid or has already been used. Please sign in and request a new one.',
    );
  });

  it('waits for authenticated user data before redirecting after verification', async () => {
    await setupComponent({token: 'verify-token'});
    userSignal.set(null);

    await renderAndSettle();

    expect(authServiceMock.confirmVerification).toHaveBeenCalledWith(
      'verify-token',
    );
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();

    userSignal.set({_id: 'user-1'});

    await renderAndSettle();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/');
  });
});
