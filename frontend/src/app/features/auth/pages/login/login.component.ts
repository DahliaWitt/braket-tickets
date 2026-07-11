import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  DestroyRef,
  effect,
  untracked,
} from '@angular/core';
import {takeUntilDestroyed, toSignal} from '@angular/core/rxjs-interop';
import {timer} from 'rxjs';
import {
  form,
  FormField,
  required,
  email as emailValidator,
  minLength,
  maxLength,
} from '@angular/forms/signals';
import {Router, RouterLink, ActivatedRoute} from '@angular/router';
import {AuthService, UnverifiedEmailError} from '@/core/services/auth.service';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {PasswordService} from '@/core/services/password.service';

import {
  CONNECTED_PROVIDERS,
  type SocialProvider,
} from '@/features/auth/models/external-auth.model';
import {logger} from '@/utils/logger';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
  notBlank,
} from '@/utils/signal-form';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {
  ZardFormLabelComponent,
  ZardFormMessageComponent,
} from '@ui/components/primitives/form-field/form-field.component';

type Tab = 'login' | 'register';

/** Single source for the invalid-email format message across all three login-page forms. */
export const INVALID_EMAIL_MESSAGE = 'Please enter a valid email address';

interface LoginRouteState {
  readonly signupRequested: boolean;
  readonly registeredMessageRequested: boolean;
  readonly oauthCallbackRequested: boolean;
  readonly returnUrl: string;
}

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ZardButtonComponent,
    ZardCardComponent,
    ZardInputDirective,
    ZardIconComponent,
    ZardTooltipDirective,
    ZardFormLabelComponent,
    ZardFormMessageComponent,
    FormField, // Angular Signal Forms directive
  ],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  auth = inject(AuthService);
  private passwordService = inject(PasswordService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private readonly browser = inject(BrowserPlatformService);
  private readonly routeQueryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly activeTab = signal<Tab>('login');
  readonly isResetMode = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  readonly socialProviders = CONNECTED_PROVIDERS;
  readonly invalidEmailMessage = INVALID_EMAIL_MESSAGE;
  readonly loginSubmitted = signal(false);
  readonly registerSubmitted = signal(false);
  readonly resetSubmitted = signal(false);
  readonly resetEmailBlurred = signal(false);
  readonly resendingVerification = signal(false);
  readonly lastAttemptedEmail = signal<string | null>(null);

  // Password visibility signals
  readonly loginPasswordVisible = signal(false);
  readonly registerPasswordVisible = signal(false);
  readonly registerConfirmPasswordVisible = signal(false);

  readonly resendCooldown = signal(0);
  private resendCooldownInterval: ReturnType<typeof setInterval> | null = null;
  private resendCooldownGeneration = 0;

  // --- FORM MODELS (Pure Signal Forms) ---

  // Login
  readonly loginModel = signal({
    email: '',
    password: '',
  });

  // Pass schema function directly as second argument
  loginForm = form(this.loginModel, (f) => {
    required(f.email);
    emailValidator(f.email);
    maxLength(f.email, 254);
    required(f.password);
    maxLength(f.password, 72); // bcrypt limit
  });

  // Register
  readonly registerModel = signal({
    name: '',
    email: '',
    password: '',
    passwordConfirm: '',
    termsAccepted: false,
  });

  registerForm = form(this.registerModel, (f) => {
    required(f.name);
    notBlank(f.name);
    minLength(f.name, 2);
    maxLength(f.name, 100);
    required(f.email);
    emailValidator(f.email);
    maxLength(f.email, 254);
    required(f.password);
    minLength(f.password, 8);
    maxLength(f.password, 72); // bcrypt limit
    required(f.passwordConfirm);
    maxLength(f.passwordConfirm, 72); // bcrypt limit
    required(f.termsAccepted);

    // Note: Cross-field validation via setters like setErrors is not available on SchemaPath.
    // We handle password mismatch via computed signals or effects if not supported by the schema API natively yet.
    // For now, removing the direct setErrors call in schema as it caused issues.
  });

  // Reset
  readonly resetModel = signal({
    email: '',
  });

  resetForm = form(this.resetModel, (f) => {
    required(f.email);
    emailValidator(f.email);
    maxLength(f.email, 254);
  });

  readonly resetSubmitDisabled = computed(
    () => this.loading() || this.resetForm().invalid(),
  );
  readonly resetEmailSent = computed(
    () => this.isResetMode() && this.message() !== null,
  );
  readonly resetEmailInvalid = computed(
    () =>
      this.resetForm.email().invalid() &&
      (this.resetEmailBlurred() ||
        isSignalFormFieldInvalid(this.resetForm.email, this.resetSubmitted(), {
          includeDirty: true,
        })),
  );

  // Computed for password mismatch (useful for UI feedback distinct from simple validation)
  readonly registerPasswordsMismatch = computed(() => {
    const val = this.registerModel();
    return (
      !!val.password &&
      !!val.passwordConfirm &&
      val.password !== val.passwordConfirm
    );
  });

  private readonly routeQueryParams = computed(() => this.toRouteQueryParams());
  private readonly routeState = computed<LoginRouteState>(() => {
    const queryParamMap = this.routeQueryParamMap();
    const error = queryParamMap.get('error');
    const ott = queryParamMap.get('ott');
    const code = queryParamMap.get('code');
    const state = queryParamMap.get('state');

    return {
      signupRequested: queryParamMap.get('signup') === 'true',
      registeredMessageRequested: queryParamMap.get('registered') === 'true',
      oauthCallbackRequested: Boolean(error || ott || code || state),
      returnUrl: sanitizeInternalReturnUrl(queryParamMap.get('returnUrl')),
    };
  });

  // Track if we've already handled a redirect to prevent duplicate navigations
  private readonly redirectHandled = signal(false);
  private readonly signupQueryParamHandled = signal(false);
  private readonly registeredQueryParamHandled = signal(false);
  private readonly oauthRedirectHandled = signal(false);

  constructor() {
    // Cleanup interval on destroy
    this.destroyRef.onDestroy(() => {
      this.stopResendCooldown();
    });

    effect(() => {
      const routeState = this.routeState();
      const queryParams = this.routeQueryParams();

      if (routeState.signupRequested) {
        if (!untracked(() => this.signupQueryParamHandled())) {
          this.signupQueryParamHandled.set(true);
          this.activeTab.set('register');
        }
      } else {
        this.signupQueryParamHandled.set(false);
      }

      if (routeState.oauthCallbackRequested) {
        if (!untracked(() => this.oauthRedirectHandled())) {
          this.oauthRedirectHandled.set(true);
          void this.router.navigate(['/confirm/social-signin'], {
            queryParams,
            replaceUrl: true,
          });
        }
        return;
      }

      this.oauthRedirectHandled.set(false);

      if (routeState.registeredMessageRequested) {
        if (!untracked(() => this.registeredQueryParamHandled())) {
          this.registeredQueryParamHandled.set(true);
          this.message.set(
            `If this email is not already registered, a verification email has been sent.`,
          );
          this.activeTab.set('login');
          this.scheduleRegisteredQueryParamCleanup();
        }
      } else {
        this.registeredQueryParamHandled.set(false);
      }

      const initialized = this.auth.authInitialized();
      const authenticated = this.auth.isAuthenticated();
      const user = this.auth.user();

      const alreadyHandled = untracked(() => this.redirectHandled());
      const isLoading = untracked(() => this.loading());

      if (alreadyHandled || isLoading) {
        return;
      }

      if (initialized && authenticated && user) {
        this.redirectHandled.set(true);
        if (user.socialSignupCompletionRequired === true) {
          void this.router.navigate(['/confirm/social-signup-complete'], {
            queryParams: {
              returnUrl: routeState.returnUrl,
            },
          });
          return;
        }
        void this.router.navigateByUrl(routeState.returnUrl);
      }
    });
  }

  private toRouteQueryParams(): Record<string, string> {
    const queryParamMap = this.routeQueryParamMap();
    const queryParams: Record<string, string> = {};

    for (const key of queryParamMap.keys) {
      const value = queryParamMap.get(key);
      if (value !== null) {
        queryParams[key] = value;
      }
    }

    return queryParams;
  }

  private stopResendCooldown(): void {
    this.resendCooldownGeneration += 1;
    if (this.resendCooldownInterval !== null) {
      clearInterval(this.resendCooldownInterval);
      this.resendCooldownInterval = null;
    }
  }

  startResendCooldown(): void {
    this.stopResendCooldown();
    const activeGeneration = this.resendCooldownGeneration;

    this.resendCooldown.set(60);
    this.resendCooldownInterval = setInterval(() => {
      if (activeGeneration !== this.resendCooldownGeneration) {
        return;
      }

      const nextCooldown = Math.max(this.resendCooldown() - 1, 0);
      this.resendCooldown.set(nextCooldown);
      if (nextCooldown === 0) {
        this.stopResendCooldown();
      }
    }, 1000);
  }

  // Check if the current error is about email verification
  readonly isEmailVerificationError = computed(() => {
    const err = this.error();
    const msg = this.message();
    const text = (err || msg || '').toLowerCase();
    return text.includes('verify') || text.includes('verification');
  });

  private clearQueryParams(keys: string[] = ['error']) {
    const queryParams: Record<string, string | null> = {};
    keys.forEach((k) => (queryParams[k] = null));

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private scheduleRegisteredQueryParamCleanup(): void {
    timer(100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearQueryParams(['registered']));
  }

  onTabKeydown(event: KeyboardEvent) {
    const tabs: Tab[] = ['login', 'register'];
    const currentIndex = tabs.indexOf(this.activeTab());
    let nextIndex: number;

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    this.switchTab(nextTab);

    // Move focus to the newly active tab button
    this.browser.focusElementById(`tab-${nextTab}`);
  }

  switchTab(tab: Tab) {
    this.activeTab.set(tab);
    this.isResetMode.set(false);
    this.error.set(null);
    this.message.set(null);
    this.loginSubmitted.set(false);
    this.registerSubmitted.set(false);
    this.resetSubmitted.set(false);
    this.resetEmailBlurred.set(false);
  }

  enterResetMode() {
    this.isResetMode.set(true);
    this.error.set(null);
    this.message.set(null);
    this.resetSubmitted.set(false);
    this.resetEmailBlurred.set(false);
  }

  exitResetMode() {
    this.isResetMode.set(false);
    this.error.set(null);
    this.message.set(null);
    this.resetSubmitted.set(false);
    this.resetEmailBlurred.set(false);
  }

  readonly isFieldInvalid = isSignalFormFieldInvalid;
  readonly hasError = signalFormFieldHasError;

  async onLogin() {
    // Prevent rapid double-clicks from triggering multiple auth requests
    if (this.loading()) {
      return;
    }

    this.loginSubmitted.set(true);

    // Access form state by calling the form property
    if (this.loginForm().invalid()) {
      this.error.set('Please fix the highlighted fields.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.message.set(null);

    try {
      const {email, password} = this.loginModel();
      this.lastAttemptedEmail.set(email);
      await this.auth.loginWithPassword(
        email,
        password,
        this.routeState().returnUrl,
      );
    } catch (err: unknown) {
      if (err instanceof UnverifiedEmailError) {
        this.error.set(err.message);
      } else {
        const error =
          err instanceof Error ? err.message : 'Authentication failed';
        this.error.set(error);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async onRegister() {
    // Prevent rapid double-clicks from triggering multiple auth requests
    if (this.loading()) {
      return;
    }

    this.registerSubmitted.set(true);

    if (this.registerForm().invalid()) {
      this.error.set('Please fix the highlighted fields.');
      return;
    }

    // Cross-check again just in case (though validator handles it)
    const {email, password, passwordConfirm, termsAccepted} =
      this.registerModel();
    const name = this.registerModel().name.trim();

    if (!name) {
      this.error.set('Please fix the highlighted fields.');
      return;
    }

    if (password !== passwordConfirm) {
      this.error.set('Passwords do not match');
      return;
    }

    if (!termsAccepted) {
      this.error.set('Please accept the terms to join the community');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      this.lastAttemptedEmail.set(email);
      // auth.signup signature: (email, password, passwordConfirm, name)
      await this.auth.signup(
        email,
        password,
        passwordConfirm,
        name,
        this.routeState().returnUrl,
      );
      // auth.service navigates to /login?registered=true on success (new or existing email).
      // The registered=true query-param handler sets the neutral message via subscription.
    } catch (err: unknown) {
      if (err instanceof UnverifiedEmailError) {
        this.message.set(
          `If this email is not already registered, a verification email has been sent.`,
        );
      } else {
        const error =
          err instanceof Error ? err.message : 'Registration failed';
        this.error.set(error);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async onReset() {
    // Prevent rapid double-clicks from triggering multiple auth requests
    if (this.loading()) {
      return;
    }

    this.resetSubmitted.set(true);
    if (this.resetForm().invalid()) {
      this.error.set(INVALID_EMAIL_MESSAGE);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.message.set(null);

    try {
      const {email} = this.resetModel();
      await this.passwordService.requestPasswordReset(email);
      this.message.set(
        'Password reset email sent. Check your inbox for the reset link.',
      );
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Request failed';
      this.error.set(error);
    } finally {
      this.loading.set(false);
    }
  }

  async loginWithProvider(provider: SocialProvider) {
    // Prevent rapid double-clicks from triggering multiple auth requests
    if (this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.loginWithSocial(provider, this.routeState().returnUrl);
    } catch (err: unknown) {
      logger.error('Social login failed', err);
      this.error.set('Sign-in could not be started. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async resendVerificationEmail() {
    // Access value from signal model or field
    // field value access: loginForm.email().value()
    // Access value directly from the source signal
    const email = this.loginModel().email || this.lastAttemptedEmail();
    if (!email) {
      this.error.set('Please enter your email address first.');
      return;
    }

    this.resendingVerification.set(true);
    this.error.set(null);
    this.message.set(null);

    try {
      await this.passwordService.requestVerificationEmail(email);
      this.message.set('verification email sent. check your inbox.');
      this.startResendCooldown();
    } catch (err: unknown) {
      const error =
        err instanceof Error
          ? err.message
          : 'Failed to send verification email';
      this.error.set(error);
    } finally {
      this.resendingVerification.set(false);
    }
  }
}
