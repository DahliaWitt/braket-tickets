import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {LoginComponent, INVALID_EMAIL_MESSAGE} from './login.component';
import {LoginComponentHarness} from './login.component.harness';
import {AuthService, UnverifiedEmailError} from '@/core/services/auth.service';
import {PasswordService} from '@/core/services/password.service';
import {
  ActivatedRoute,
  Router,
  type ParamMap,
  provideRouter,
} from '@angular/router';
import {vi} from 'vitest';
import {of} from 'rxjs';

function createQueryParamMap(queryParams: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(queryParams),
    get: (name: string) => queryParams[name] ?? null,
    getAll: (name: string) => {
      return Object.prototype.hasOwnProperty.call(queryParams, name)
        ? [queryParams[name]]
        : [];
    },
    has: (name: string) =>
      Object.prototype.hasOwnProperty.call(queryParams, name),
  };
}

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: {
    loginWithPassword: ReturnType<typeof vi.fn>;
    signup: ReturnType<typeof vi.fn>;
    requestPasswordReset: ReturnType<typeof vi.fn>;
    loginWithSocial: ReturnType<typeof vi.fn>;
    requestVerificationEmail: ReturnType<typeof vi.fn>;
    currentUser: ReturnType<typeof vi.fn>;
    userRole: ReturnType<typeof vi.fn>;
    authInitialized: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
    user: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let harness: LoginComponentHarness;
  let routeQueryParams: Record<string, string>;

  beforeEach(async () => {
    routeQueryParams = {};
    authServiceMock = {
      loginWithPassword: vi.fn().mockResolvedValue(undefined),
      signup: vi.fn().mockResolvedValue(undefined),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      loginWithSocial: vi.fn().mockResolvedValue(undefined),
      requestVerificationEmail: vi.fn().mockResolvedValue(undefined),
      currentUser: vi.fn(() => null),
      userRole: vi.fn(() => 'user'),
      authInitialized: vi.fn(() => false),
      isAuthenticated: vi.fn(() => false),
      user: vi.fn(() => null),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: authServiceMock},
        {provide: PasswordService, useValue: authServiceMock},
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return {
                queryParamMap: {
                  get: (key: string) => routeQueryParams[key] ?? null,
                },
                queryParams: {...routeQueryParams},
              };
            },
            get queryParams() {
              return of({...routeQueryParams});
            },
            get queryParamMap() {
              return of(createQueryParamMap(routeQueryParams));
            },
          },
        },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    vi.spyOn(router, 'navigateByUrl');

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      LoginComponentHarness,
    );
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should switch tabs', () => {
    component.activeTab.set('register');
    fixture.detectChanges();
    expect(component.activeTab()).toBe('register');
  });

  describe('tablist keyboard navigation', () => {
    it('switches to the register tab on ArrowRight from the login tab', async () => {
      await harness.pressArrowKeyOnTab('login', 'right');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.activeTab()).toBe('register');
      expect(await harness.isRegisterPanelVisible()).toBe(true);
      expect(await harness.getTabTabindex('register')).toBe('0');
      expect(await harness.getTabTabindex('login')).toBe('-1');
    });

    it('switches back to the login tab on ArrowLeft from the register tab', async () => {
      await harness.switchToRegister();

      await harness.pressArrowKeyOnTab('register', 'left');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.activeTab()).toBe('login');
      expect(await harness.isLoginPanelVisible()).toBe(true);
      expect(await harness.getTabTabindex('login')).toBe('0');
      expect(await harness.getTabTabindex('register')).toBe('-1');
    });

    it('wraps ArrowLeft from the login tab around to the register tab', async () => {
      await harness.pressArrowKeyOnTab('login', 'left');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.activeTab()).toBe('register');
      expect(await harness.isRegisterPanelVisible()).toBe(true);
    });
  });

  it('should call auth.loginWithPassword on login submit', async () => {
    // Direct model update for signal forms
    component.loginModel.update((m) => ({
      ...m,
      email: 'test@example.com',
      password: 'password123',
    }));

    await component.onLogin();

    expect(authServiceMock.loginWithPassword).toHaveBeenCalledWith(
      'test@example.com',
      'password123',
      '/',
    );
  });

  it('redirects authenticated users with incomplete social signup to completion', async () => {
    routeQueryParams.returnUrl = '/tickets';
    authServiceMock.authInitialized.mockReturnValue(true);
    authServiceMock.isAuthenticated.mockReturnValue(true);
    authServiceMock.user.mockReturnValue({
      _id: 'user-1',
      socialSignupCompletionRequired: true,
    });

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    const navigateCall = vi.mocked(router.navigate).mock.calls[0] as [
      unknown,
      {queryParams?: {returnUrl?: string}} | undefined,
    ];

    expect(navigateCall[0]).toEqual(['/confirm/social-signup-complete']);
    expect(navigateCall[1]?.queryParams?.returnUrl).toBeTypeOf('string');
  });

  it('should submit via button click (template wiring)', async () => {
    await harness.setLoginEmail('test@example.com');
    await harness.setLoginPassword('password123');
    await harness.submitLogin();

    expect(authServiceMock.loginWithPassword).toHaveBeenCalledWith(
      'test@example.com',
      'password123',
      '/',
    );
  });

  it('shows a visible error after an invalid login attempt', async () => {
    authServiceMock.loginWithPassword.mockRejectedValueOnce(
      new Error('Invalid email or password'),
    );

    await harness.setLoginEmail('test@example.com');
    await harness.setLoginPassword('wrong-password');
    await harness.submitLogin();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getAuthErrorText()).toContain(
      'Invalid email or password',
    );
  });

  describe('Email Verification Gate', () => {
    it('should show verification error when user is unverified', async () => {
      authServiceMock.loginWithPassword.mockRejectedValueOnce(
        new UnverifiedEmailError('test@example.com'),
      );

      component.loginModel.update((m) => ({
        ...m,
        email: 'test@example.com',
        password: 'password123',
      }));
      await component.onLogin();
      fixture.detectChanges();

      expect(component.error()).toContain('verification');
      expect(component.isEmailVerificationError()).toBe(true);
    });

    it('should store lastAttemptedEmail on login attempt', async () => {
      authServiceMock.loginWithPassword.mockRejectedValueOnce(
        new UnverifiedEmailError('test@example.com'),
      );

      component.loginModel.update((m) => ({
        ...m,
        email: 'test@example.com',
        password: 'password123',
      }));
      await component.onLogin();

      expect(component.lastAttemptedEmail()).toBe('test@example.com');
    });

    it('should call requestVerificationEmail with form email when resending', async () => {
      component.loginModel.update((m) => ({...m, email: 'test@example.com'}));

      await component.resendVerificationEmail();

      expect(authServiceMock.requestVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should call requestVerificationEmail with lastAttemptedEmail as fallback', async () => {
      component.lastAttemptedEmail.set('fallback@example.com');
      component.loginModel.update((m) => ({...m, email: ''}));

      await component.resendVerificationEmail();

      expect(authServiceMock.requestVerificationEmail).toHaveBeenCalledWith(
        'fallback@example.com',
      );
    });

    it('should show success message after resending verification email', async () => {
      component.loginModel.update((m) => ({...m, email: 'test@example.com'}));

      await component.resendVerificationEmail();
      fixture.detectChanges();

      expect(component.message()).toContain('verification email sent');
    });

    it('cancels the registered cleanup timer when destroyed', async () => {
      vi.useFakeTimers();

      try {
        (
          component as unknown as {
            scheduleRegisteredQueryParamCleanup: () => void;
          }
        ).scheduleRegisteredQueryParamCleanup();
        fixture.destroy();
        await vi.advanceTimersByTimeAsync(100);

        expect(router.navigate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores stale cooldown ticks after restarting the resend cooldown', () => {
      const intervalCallbacks = new Map<number, () => void>();
      let nextIntervalId = 1;

      const setIntervalSpy = vi
        .spyOn(globalThis, 'setInterval')
        .mockImplementation((handler: TimerHandler) => {
          if (typeof handler !== 'function') {
            throw new TypeError(
              'Expected setInterval handler to be a function',
            );
          }

          const intervalHandler = handler as () => void;
          const intervalId = nextIntervalId++;
          intervalCallbacks.set(intervalId, () => {
            intervalHandler();
          });
          return intervalId as unknown as ReturnType<typeof setInterval>;
        });

      const clearIntervalSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(
          (
            intervalId:
              string | number | ReturnType<typeof setTimeout> | undefined,
          ) => {
            if (typeof intervalId === 'number') {
              intervalCallbacks.delete(intervalId);
            }
          },
        );

      try {
        component.startResendCooldown();
        const firstTick = intervalCallbacks.get(1);
        expect(firstTick).toBeDefined();
        expect(component.resendCooldown()).toBe(60);

        component.startResendCooldown();
        const secondTick = intervalCallbacks.get(2);
        expect(secondTick).toBeDefined();
        expect(component.resendCooldown()).toBe(60);

        firstTick?.();
        expect(component.resendCooldown()).toBe(60);

        secondTick?.();
        expect(component.resendCooldown()).toBe(59);
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });
  });

  describe('Registration', () => {
    beforeEach(() => {
      component.activeTab.set('register');
      fixture.detectChanges();
    });

    it('should display register field validation messages on submit when invalid', async () => {
      await harness.switchToRegister();
      fixture.detectChanges();

      await component.onRegister();
      fixture.detectChanges();

      expect(await harness.getRegisterNameErrorText()).toBeTruthy();
      expect(await harness.getRegisterEmailErrorText()).toBeTruthy();
      expect(await harness.getRegisterPasswordErrorText()).toBeTruthy();
      expect(await harness.getRegisterPasswordConfirmErrorText()).toBeTruthy();
    });

    it('shows all social provider buttons', async () => {
      fixture = TestBed.createComponent(LoginComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        LoginComponentHarness,
      );

      await harness.switchToRegister();
      fixture.detectChanges();
      await fixture.whenStable();

      const buttons = (
        fixture.debugElement.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>(
        '#register-panel button[id$="-register"]',
      );
      // All providers are shown - auth availability is assumed
      expect(buttons.length).toEqual(2);
    });

    it('should call auth.signup on register submit', async () => {
      component.registerModel.update((m) => ({
        ...m,
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      await component.onRegister();

      expect(authServiceMock.signup).toHaveBeenCalledWith(
        'new@example.com',
        'password123',
        'password123',
        'New User',
        '/',
      );
    });

    it('submits registration through the template button click', async () => {
      await harness.switchToRegister();
      await harness.setRegisterName('Template User');
      await harness.setRegisterEmail('template@example.com');
      await harness.setRegisterPassword('password123');
      await harness.setRegisterPasswordConfirm('password123');
      await harness.acceptRegisterTerms();

      await harness.submitRegister();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(authServiceMock.signup).toHaveBeenCalledWith(
        'template@example.com',
        'password123',
        'password123',
        'Template User',
        '/',
      );
      expect(component.error()).toBeNull();
    });

    it('keeps registration submit interactive and shows a visible terms error', async () => {
      await harness.switchToRegister();
      await harness.setRegisterName('Template User');
      await harness.setRegisterEmail('template@example.com');
      await harness.setRegisterPassword('password123');
      await harness.setRegisterPasswordConfirm('password123');

      expect(await harness.isRegisterSubmitDisabled()).toBe(false);

      await harness.submitRegister();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getRegisterTermsErrorText()).toContain(
        'Please accept the terms',
      );
      expect(component.error()).toContain('Please fix the highlighted fields');
      expect(authServiceMock.signup).not.toHaveBeenCalled();
    });

    it('should show error if passwords mismatch', async () => {
      component.registerModel.update((m) => ({
        ...m,
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        passwordConfirm: 'mismatch',
        termsAccepted: true,
      }));

      await component.onRegister();

      expect(component.error()).toContain('Passwords do not match');
      expect(authServiceMock.signup).not.toHaveBeenCalled();
    });

    it('should handle signup failure', async () => {
      authServiceMock.signup.mockRejectedValueOnce(new Error('Signup failed'));
      component.registerModel.update((m) => ({
        ...m,
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      await component.onRegister();

      expect(component.error()).toBe('Signup failed');
    });

    it('does not leak email or set error when signup resolves (new-account path)', async () => {
      // auth.service navigates to /login?registered=true on success. The neutral message
      // is set by the registered=true query-param subscription (not inline here).
      // This verifies the security property: no email address is leaked.
      component.registerModel.update((m) => ({
        ...m,
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      await component.onRegister();
      fixture.detectChanges();

      expect(component.error()).toBeNull();
      expect(component.error() ?? '').not.toContain('new@example.com');
      expect(component.message() ?? '').not.toContain('new@example.com');
    });

    it('shows neutral message when signup throws UnverifiedEmailError (no email in message)', async () => {
      authServiceMock.signup.mockRejectedValueOnce(
        new UnverifiedEmailError('existing@example.com'),
      );
      component.registerModel.update((m) => ({
        ...m,
        name: 'New User',
        email: 'existing@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      await component.onRegister();
      fixture.detectChanges();

      const msg = component.message();
      expect(msg).toBeTruthy();
      expect(msg).toContain('If this email is not already registered');
      expect(msg).not.toContain('existing@example.com');
    });

    it('does not leak email when signup resolves for an existing email', async () => {
      // auth.service.signup() navigates to /login?registered=true for both new and
      // existing emails (prevents enumeration). The component sees a resolved promise
      // with no error set and no email in any state.
      component.registerModel.update((m) => ({
        ...m,
        name: 'Existing User',
        email: 'existing@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      await component.onRegister();
      fixture.detectChanges();

      expect(component.error()).toBeNull();
      expect(component.error() ?? '').not.toContain('existing@example.com');
      expect(component.message() ?? '').not.toContain('existing@example.com');
    });

    describe('whitespace-only name (BRA-378)', () => {
      it('form is invalid when name is whitespace-only', () => {
        component.registerModel.update((m) => ({
          ...m,
          name: '   ',
          email: 'test@example.com',
          password: 'password123',
          passwordConfirm: 'password123',
          termsAccepted: true,
        }));

        expect(component.registerForm().invalid()).toBe(true);
      });

      it('does not call auth.signup when name is whitespace-only', async () => {
        component.registerModel.update((m) => ({
          ...m,
          name: '   ',
          email: 'test@example.com',
          password: 'password123',
          passwordConfirm: 'password123',
          termsAccepted: true,
        }));

        await component.onRegister();

        expect(authServiceMock.signup).not.toHaveBeenCalled();
      });

      it('shows name required error on submit with whitespace-only name', async () => {
        await harness.switchToRegister();

        component.registerModel.update((m) => ({
          ...m,
          name: '   ',
          email: 'test@example.com',
          password: 'password123',
          passwordConfirm: 'password123',
          termsAccepted: true,
        }));

        await component.onRegister();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getRegisterNameErrorText();
        expect(errorText).toBeTruthy();
      });
    });
  });

  describe('maxLength validation', () => {
    describe('login form', () => {
      it('should show maxLength error for email exceeding 254 characters', async () => {
        const longEmail = 'a'.repeat(249) + '@x.com';
        await harness.setLoginEmail(longEmail);
        await harness.submitLogin();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getLoginEmailErrorText();
        expect(errorText).toContain('254 characters or fewer');
      });

      it('should show maxLength error for password exceeding 72 characters', async () => {
        await harness.setLoginEmail('valid@example.com');
        await harness.setLoginPassword('a'.repeat(73));
        await harness.submitLogin();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getLoginPasswordErrorText();
        expect(errorText).toContain('72 characters or fewer');
      });

      it('should not show maxLength error for valid-length inputs', async () => {
        await harness.setLoginEmail('valid@example.com');
        await harness.setLoginPassword('password123');
        await harness.submitLogin();
        fixture.detectChanges();
        await fixture.whenStable();

        const emailError = await harness.getLoginEmailErrorText();
        const passwordError = await harness.getLoginPasswordErrorText();
        expect(emailError).toBeNull();
        expect(passwordError).toBeNull();
      });

      it('should show required error when email is empty on submit', async () => {
        await harness.submitLogin();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getLoginEmailErrorText();
        expect(errorText).toContain('Email is required');
      });
    });

    describe('register form', () => {
      beforeEach(async () => {
        component.activeTab.set('register');
        fixture.detectChanges();
        await fixture.whenStable();
      });

      it('should show maxLength error for name exceeding 100 characters', async () => {
        component.registerModel.update((m) => ({
          ...m,
          name: 'a'.repeat(101),
          email: 'test@example.com',
          password: 'password123',
          passwordConfirm: 'password123',
          termsAccepted: true,
        }));
        await component.onRegister();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getRegisterNameErrorText();
        expect(errorText).toContain('100 characters or fewer');
      });

      it('should show maxLength error for email exceeding 254 characters', async () => {
        component.registerModel.update((m) => ({
          ...m,
          name: 'Test User',
          email: 'a'.repeat(249) + '@x.com',
          password: 'password123',
          passwordConfirm: 'password123',
          termsAccepted: true,
        }));
        await component.onRegister();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getRegisterEmailErrorText();
        expect(errorText).toContain('254 characters or fewer');
      });

      it('should show maxLength error for password exceeding 72 characters', async () => {
        component.registerModel.update((m) => ({
          ...m,
          name: 'Test User',
          email: 'test@example.com',
          password: 'a'.repeat(73),
          passwordConfirm: 'a'.repeat(73),
          termsAccepted: true,
        }));
        await component.onRegister();
        fixture.detectChanges();
        await fixture.whenStable();

        const errorText = await harness.getRegisterPasswordErrorText();
        expect(errorText).toContain('72 characters or fewer');
      });
    });
  });

  it('should call auth.requestPasswordReset on reset submit', async () => {
    component.isResetMode.set(true);
    fixture.detectChanges();
    component.resetModel.update((m) => ({...m, email: 'reset@example.com'}));

    await component.onReset();

    expect(authServiceMock.requestPasswordReset).toHaveBeenCalledWith(
      'reset@example.com',
    );
    expect(component.message()).toContain('Password reset email sent');
  });

  describe('Password reset validation', () => {
    beforeEach(async () => {
      await harness.enterResetMode();
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('keeps the reset submit button disabled until a valid email is present', async () => {
      expect(await harness.isResetSubmitDisabled()).toBe(true);

      await harness.setResetEmail('bad');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isResetSubmitDisabled()).toBe(true);

      await harness.setResetEmail('reset@example.com');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isResetSubmitDisabled()).toBe(false);
    });

    it('shows a visible required error after the reset email field is blurred empty', async () => {
      await harness.touchResetEmail();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getResetEmailErrorText()).toContain(
        'Email is required',
      );
      expect(await harness.getResetEmailDescribedBy()).toBe(
        'reset-email-error',
      );
      expect(await harness.isResetSubmitDisabled()).toBe(true);
    });

    it('shows a visible invalid reset email error while submit remains disabled', async () => {
      await harness.typeResetEmail('not-an-email');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getResetEmailErrorText()).toContain(
        INVALID_EMAIL_MESSAGE,
      );
      expect(await harness.getResetEmailDescribedBy()).toBe(
        'reset-email-error',
      );
      expect(await harness.isResetSubmitDisabled()).toBe(true);
    });

    it('guards direct reset handler calls with empty email and shows the inline required error', async () => {
      await component.onReset();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getResetEmailErrorText()).toContain(
        'Email is required',
      );
      expect(authServiceMock.requestPasswordReset).not.toHaveBeenCalled();
    });

    it('guards direct reset handler calls with invalid email and shows the inline format error', async () => {
      await harness.setResetEmail('bad');
      await component.onReset();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getResetEmailErrorText()).toContain(
        INVALID_EMAIL_MESSAGE,
      );
      expect(authServiceMock.requestPasswordReset).not.toHaveBeenCalled();
    });

    it('shows a dedicated success state after sending a password reset email', async () => {
      await harness.setResetEmail('reset@example.com');
      await harness.submitResetRequest();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getResetSuccessText()).toContain(
        'Password reset email sent',
      );
    });
  });

  describe('Debounce guards', () => {
    it('should not call auth when loading is true (login)', async () => {
      component.loginModel.update((m) => ({
        ...m,
        email: 'test@example.com',
        password: 'password123',
      }));
      component.loading.set(true);

      await component.onLogin();

      expect(authServiceMock.loginWithPassword).not.toHaveBeenCalled();
    });

    it('should not call auth when loading is true (register)', async () => {
      component.activeTab.set('register');
      fixture.detectChanges();
      component.registerModel.update((m) => ({
        ...m,
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));
      component.loading.set(true);

      await component.onRegister();

      expect(authServiceMock.signup).not.toHaveBeenCalled();
    });

    it('should not call auth when loading is true (reset)', async () => {
      component.isResetMode.set(true);
      fixture.detectChanges();
      component.resetModel.update((m) => ({...m, email: 'reset@example.com'}));
      component.loading.set(true);

      await component.onReset();

      expect(authServiceMock.requestPasswordReset).not.toHaveBeenCalled();
    });

    it('should not call auth when loading is true (social provider)', async () => {
      component.loading.set(true);

      await component.loginWithProvider('google');

      expect(authServiceMock.loginWithSocial).not.toHaveBeenCalled();
    });

    it('sends only one request on rapid double-click (login)', async () => {
      component.loginModel.update((m) => ({
        ...m,
        email: 'test@example.com',
        password: 'password123',
      }));

      const first = component.onLogin();
      const second = component.onLogin();
      await Promise.all([first, second]);

      expect(authServiceMock.loginWithPassword).toHaveBeenCalledTimes(1);
    });

    it('sends only one request on rapid double-click (register)', async () => {
      component.activeTab.set('register');
      fixture.detectChanges();
      component.registerModel.update((m) => ({
        ...m,
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        termsAccepted: true,
      }));

      const first = component.onRegister();
      const second = component.onRegister();
      await Promise.all([first, second]);

      expect(authServiceMock.signup).toHaveBeenCalledTimes(1);
    });

    it('sends only one request on rapid double-click (reset)', async () => {
      component.isResetMode.set(true);
      fixture.detectChanges();
      component.resetModel.update((m) => ({...m, email: 'reset@example.com'}));

      const first = component.onReset();
      const second = component.onReset();
      await Promise.all([first, second]);

      expect(authServiceMock.requestPasswordReset).toHaveBeenCalledTimes(1);
    });

    it('sends only one request on rapid double-click (social provider)', async () => {
      const first = component.loginWithProvider('google');
      const second = component.loginWithProvider('google');
      await Promise.all([first, second]);

      expect(authServiceMock.loginWithSocial).toHaveBeenCalledTimes(1);
    });
  });
});

// This block deliberately provides a mock Router (instead of `provideRouter`)
// so the ActivatedRoute mock actually delivers query params to the component —
// `provideRouter` supplies its own root ActivatedRoute that shadows the mock.
describe('LoginComponent query-param routing', () => {
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  async function createWithQueryParams(
    queryParams: Record<string, string>,
  ): Promise<void> {
    const authServiceMock = {
      loginWithPassword: vi.fn().mockResolvedValue(undefined),
      signup: vi.fn().mockResolvedValue(undefined),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      loginWithSocial: vi.fn().mockResolvedValue(undefined),
      requestVerificationEmail: vi.fn().mockResolvedValue(undefined),
      currentUser: vi.fn(() => null),
      userRole: vi.fn(() => 'user'),
      authInitialized: vi.fn(() => false),
      isAuthenticated: vi.fn(() => false),
      user: vi.fn(() => null),
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: authServiceMock},
        {provide: PasswordService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
        {
          provide: ActivatedRoute,
          useValue: {
            get queryParams() {
              return of({...queryParams});
            },
            get queryParamMap() {
              return of(createQueryParamMap(queryParams));
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('routes a bare verification-callback error to the verification page, not social sign-in', async () => {
    // Better Auth redirects an expired resend-verification link to
    // `/login?error=TOKEN_EXPIRED` (no OAuth ott/code/state). It must land on
    // the verification-outcome page, not the social sign-in error page, and
    // must forward the callback params (error + any returnUrl) intact.
    await createWithQueryParams({
      error: 'TOKEN_EXPIRED',
      returnUrl: '/tickets',
    });

    expect(routerMock.navigate).toHaveBeenCalledWith(['/confirm/verification'], {
      queryParams: {error: 'TOKEN_EXPIRED', returnUrl: '/tickets'},
      replaceUrl: true,
    });
    expect(routerMock.navigate).not.toHaveBeenCalledWith(
      ['/confirm/social-signin'],
      expect.anything(),
    );
  });

  it('routes a genuine OAuth callback (code/state) to the social sign-in page', async () => {
    await createWithQueryParams({code: 'oauth-code', state: 'oauth-state'});

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/confirm/social-signin'],
      expect.objectContaining({replaceUrl: true}),
    );
    expect(routerMock.navigate).not.toHaveBeenCalledWith(
      ['/confirm/verification'],
      expect.anything(),
    );
  });

  it('routes an OAuth error accompanied by a one-time token to the social sign-in page', async () => {
    // A failed cross-domain OAuth exchange carries `ott` alongside `error`; it is
    // still an OAuth callback and must not be reclassified as a verification error.
    await createWithQueryParams({error: 'access_denied', ott: 'one-time-token'});

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/confirm/social-signin'],
      expect.objectContaining({replaceUrl: true}),
    );
    expect(routerMock.navigate).not.toHaveBeenCalledWith(
      ['/confirm/verification'],
      expect.anything(),
    );
  });
});
