import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {
  provideZonelessChangeDetection,
  signal,
  type WritableSignal,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import {of} from 'rxjs';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AuthService} from '@/core/services/auth.service';
import {CompleteSocialSignupComponent} from './complete-social-signup.component';

describe('CompleteSocialSignupComponent', () => {
  let fixture: ComponentFixture<CompleteSocialSignupComponent>;
  let component: CompleteSocialSignupComponent;
  type TestUser = Record<string, unknown> | null;
  let authServiceMock: {
    authInitialized: WritableSignal<boolean>;
    isAuthenticated: WritableSignal<boolean>;
    user: WritableSignal<TestUser>;
    completeSocialSignupOnboarding: ReturnType<typeof vi.fn>;
  };
  let routerMock: {
    navigateByUrl: ReturnType<typeof vi.fn>;
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
    user: TestUser = {_id: 'user-1'},
    authInitialized = true,
  ) {
    const userSignal = signal<TestUser>(user);
    authServiceMock = {
      authInitialized: signal(authInitialized),
      isAuthenticated: signal(Boolean(user)),
      user: userSignal,
      completeSocialSignupOnboarding: vi.fn().mockResolvedValue(undefined),
    };
    routerMock = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [CompleteSocialSignupComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: ActivatedRoute, useValue: createActivatedRoute(queryParams)},
        {provide: AuthService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompleteSocialSignupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error when the user is no longer authenticated', async () => {
    await setupComponent({}, null);

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'Your session has expired. Please sign in again.',
    );
  });

  it('waits for auth initialization before showing the expired session state', async () => {
    await setupComponent({}, null, false);

    expect(component.state()).toBe('loading');
    expect(component.error()).toBeNull();

    authServiceMock.authInitialized.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'Your session has expired. Please sign in again.',
    );
  });

  it('becomes ready when auth hydration finds a valid session', async () => {
    await setupComponent({}, {_id: 'user-1'}, false);

    expect(component.state()).toBe('loading');

    authServiceMock.authInitialized.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.state()).toBe('ready');
    expect(component.error()).toBeNull();
  });

  it('persists terms acceptance and continues to the return URL', async () => {
    await setupComponent({returnUrl: '/tickets?tab=buyers#details'});

    component.acceptedTerms.set(true);
    await component.complete();

    expect(authServiceMock.completeSocialSignupOnboarding).toHaveBeenCalled();
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
      '/tickets?tab=buyers#details',
    );
  });

  it('does not continue until terms are accepted', async () => {
    await setupComponent({returnUrl: '/tickets'});

    await component.complete();

    expect(
      authServiceMock.completeSocialSignupOnboarding,
    ).not.toHaveBeenCalled();
    expect(component.inlineError()).toBe(
      'Please accept the terms to continue.',
    );
  });

  it('keeps the submit error visible when terms persistence fails', async () => {
    await setupComponent({returnUrl: '/tickets'});
    authServiceMock.completeSocialSignupOnboarding.mockRejectedValue(
      new Error('network'),
    );

    component.acceptedTerms.set(true);
    await component.complete();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe(
      'Account setup could not be completed. Please try again.',
    );
    expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
  });

  it('skips the step when the user already completed terms acceptance', async () => {
    await setupComponent({}, {_id: 'user-1', termsAcceptedAt: Date.now()});

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/');
  });
});
