import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {of} from 'rxjs';
import {describe, expect, it, vi} from 'vitest';
import {
  AuthService,
  SocialAuthBlockedError,
} from '@/core/services/auth.service';
import {ConfirmSocialSigninComponent} from './confirm-social-signin.component';

describe('ConfirmSocialSigninComponent', () => {
  interface TestSignal<T> {
    (): T;
    set: (value: T) => void;
  }

  let fixture: ComponentFixture<ConfirmSocialSigninComponent>;
  let component: ConfirmSocialSigninComponent;
  let authServiceMock: {
    handleOAuthCallback: ReturnType<typeof vi.fn>;
    authInitialized: TestSignal<boolean>;
    isAuthenticated: TestSignal<boolean>;
    user: TestSignal<object | null>;
  };
  let routerMock: {
    navigateByUrl: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
  };
  let authInitializedSignal: TestSignal<boolean>;
  let isAuthenticatedSignal: TestSignal<boolean>;
  let userSignal: TestSignal<object | null>;

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
  ) {
    authInitializedSignal = signal(false);
    isAuthenticatedSignal = signal(false);
    userSignal = signal<object | null>(null);

    authServiceMock = {
      handleOAuthCallback: vi
        .fn()
        .mockResolvedValue({requiresSocialSignupCompletion: false}),
      authInitialized: authInitializedSignal,
      isAuthenticated: isAuthenticatedSignal,
      user: userSignal,
    };
    routerMock = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmSocialSigninComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: ActivatedRoute, useValue: createActivatedRoute(queryParams)},
        {provide: AuthService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmSocialSigninComponent);
    component = fixture.componentInstance;
  }

  async function renderAndSettle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows an error when no OTT token is present', async () => {
    await setupComponent();
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'This sign-in link is invalid or expired. Please try again.',
    );
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('completes sign-in and navigates to the sanitized return URL', async () => {
    await setupComponent({
      ott: 'ott-token',
      returnUrl: '/tickets?tab=buyers#details',
    });
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    userSignal.set({_id: 'user-1'});

    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).toHaveBeenCalledWith(
      'ott-token',
      {
        navigateOnSuccess: false,
      },
    );
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/tickets?tab=buyers#details',
    );
  });

  it('waits for authenticated user data before redirecting after social sign-in', async () => {
    await setupComponent({
      ott: 'ott-token',
      returnUrl: '/tickets?tab=buyers#details',
    });

    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).toHaveBeenCalledWith(
      'ott-token',
      {
        navigateOnSuccess: false,
      },
    );
    expect(component.state()).toBe('success');
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();

    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    userSignal.set({_id: 'user-1'});

    await renderAndSettle();

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/tickets?tab=buyers#details',
    );
  });

  it('routes newly created social users to the completion step', async () => {
    await setupComponent({ott: 'ott-token', returnUrl: '/tickets'});
    authServiceMock.handleOAuthCallback.mockResolvedValueOnce({
      requiresSocialSignupCompletion: true,
    });

    await renderAndSettle();

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/confirm/social-signup-complete'],
      {
        queryParams: {returnUrl: '/tickets'},
        replaceUrl: true,
      },
    );
  });

  it('surfaces blocked social-auth errors without leaking account details', async () => {
    await setupComponent({ott: 'ott-token'});
    authServiceMock.handleOAuthCallback.mockRejectedValueOnce(
      new SocialAuthBlockedError('provider_email_missing'),
    );

    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toContain('did not return an email address');
  });
});
