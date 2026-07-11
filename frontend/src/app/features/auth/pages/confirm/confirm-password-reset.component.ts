import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  computed,
  type OnInit,
} from '@angular/core';
import {
  form,
  FormField,
  required,
  minLength,
  maxLength,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import {toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {PasswordService} from '@/core/services/password.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
} from '@/utils/signal-form';

type ConfirmState = 'form' | 'loading' | 'success' | 'error';
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9]{24}$/;
const INVALID_RESET_LINK_MESSAGE =
  'Invalid reset link. Please request a new one.';
const MISSING_RESET_TOKEN_MESSAGE = 'Invalid reset link. No token provided.';

@Component({
  selector: 'app-confirm-password-reset',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    ZardInputDirective,
    ConfirmationStateComponent,
  ],
  template: `
    <div
      class="bg-waterfall ph-no-capture flex min-h-screen items-center justify-center bg-background p-4 selection:bg-primary selection:text-primary-foreground"
    >
      <z-card
        class="animate-fade-in relative z-10 w-full max-w-md border-border shadow-2xl"
      >
        <div class="space-y-6 p-6">
          @switch (state()) {
            @case ('form') {
              <div class="space-y-2 text-center">
                <h2
                  class="font-display text-xl tracking-wide text-foreground uppercase"
                >
                  Reset Your Password
                </h2>
                <p class="font-sans text-sm text-muted-foreground">
                  Enter your new password below.
                </p>
              </div>

              <form
                (submit)="onSubmit(); $event.preventDefault()"
                class="space-y-4"
              >
                <div class="space-y-2">
                  <label
                    for="password"
                    class="font-mono text-xs tracking-wider text-muted-foreground uppercase"
                  >
                    New Password
                  </label>
                  <div class="relative">
                    <input
                      id="password"
                      zInput
                      [type]="passwordVisible() ? 'text' : 'password'"
                      [formField]="f.password"
                      autocomplete="new-password"
                      [zStatus]="
                        isFieldInvalid(f.password) ? 'error' : undefined
                      "
                      class="pr-10 font-sans"
                      [attr.aria-describedby]="
                        isFieldInvalid(f.password) ? 'password-error' : null
                      "
                    />
                    <button
                      type="button"
                      (click)="passwordVisible.set(!passwordVisible())"
                      class="absolute top-1/2 right-2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                      [attr.aria-label]="
                        passwordVisible() ? 'Hide password' : 'Show password'
                      "
                    >
                      <z-icon
                        [zType]="passwordVisible() ? 'eye-off' : 'eye'"
                        class="h-4 w-4"
                      />
                    </button>
                  </div>
                  @if (isFieldInvalid(f.password)) {
                    <div
                      id="password-error"
                      class="font-mono text-2xs tracking-widest text-destructive-text uppercase"
                    >
                      @if (hasError(f.password, 'required')) {
                        Password is required
                      } @else if (hasError(f.password, 'minlength')) {
                        Must be at least 8 characters
                      } @else if (hasError(f.password, 'maxLength')) {
                        Must be 72 characters or fewer
                      }
                    </div>
                  }
                </div>

                <div class="space-y-2">
                  <label
                    for="passwordConfirm"
                    class="font-mono text-xs tracking-wider text-muted-foreground uppercase"
                  >
                    Confirm Password
                  </label>
                  <div class="relative">
                    <input
                      id="passwordConfirm"
                      zInput
                      [type]="passwordConfirmVisible() ? 'text' : 'password'"
                      [formField]="f.passwordConfirm"
                      autocomplete="new-password"
                      [zStatus]="
                        isFieldInvalid(f.passwordConfirm) ||
                        (passwordsMismatch() && submitted())
                          ? 'error'
                          : undefined
                      "
                      class="pr-10 font-sans"
                      [attr.aria-describedby]="
                        isFieldInvalid(f.passwordConfirm) ||
                        (passwordsMismatch() && submitted())
                          ? 'passwordConfirm-error'
                          : null
                      "
                    />
                    <button
                      type="button"
                      (click)="
                        passwordConfirmVisible.set(!passwordConfirmVisible())
                      "
                      class="absolute top-1/2 right-2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                      [attr.aria-label]="
                        passwordConfirmVisible()
                          ? 'Hide password'
                          : 'Show password'
                      "
                    >
                      <z-icon
                        [zType]="passwordConfirmVisible() ? 'eye-off' : 'eye'"
                        class="h-4 w-4"
                      />
                    </button>
                  </div>
                  @if (
                    isFieldInvalid(f.passwordConfirm) ||
                    (passwordsMismatch() && submitted())
                  ) {
                    <div
                      id="passwordConfirm-error"
                      class="font-mono text-2xs tracking-widest text-destructive-text uppercase"
                    >
                      @if (hasError(f.passwordConfirm, 'required')) {
                        Password is required
                      } @else if (passwordsMismatch()) {
                        Passwords do not match
                      }
                    </div>
                  }
                </div>

                @if (error()) {
                  <div
                    id="form-error"
                    role="alert"
                    class="border border-destructive/20 bg-destructive/10 p-3 font-mono text-xs text-destructive-text"
                  >
                    ERROR: {{ error() }}
                  </div>
                }

                <button
                  id="submit-button"
                  z-button
                  type="submit"
                  zType="default"
                  [zLoading]="loading()"
                  [zDisabled]="loading()"
                  class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
                >
                  Reset Password
                </button>
              </form>
            }
            @case ('loading') {
              <div class="text-center">
                <app-confirmation-state
                  icon="loader-circle"
                  title="Resetting password..."
                  variant="loading"
                  [loading]="true"
                />
              </div>
            }
            @case ('success') {
              <div class="text-center">
                <app-confirmation-state
                  iconId="success-icon"
                  icon="check"
                  title="password reset"
                  description="Your password has been reset. You can now log in with your new password."
                  variant="success"
                >
                  <a
                    id="login-link"
                    routerLink="/login"
                    z-button
                    zType="default"
                    class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
                  >
                    Go to Login
                  </a>
                </app-confirmation-state>
              </div>
            }
            @case ('error') {
              <div class="text-center">
                <app-confirmation-state
                  iconId="error-icon"
                  descriptionId="error-message"
                  icon="x"
                  title="Reset Failed"
                  [description]="error() ?? ''"
                  variant="error"
                >
                  <a
                    routerLink="/login"
                    z-button
                    zType="ghost"
                    class="w-full border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    Back to Login
                  </a>
                </app-confirmation-state>
              </div>
            }
          }
        </div>
      </z-card>
    </div>
  `,
})
export class ConfirmPasswordResetComponent implements OnInit {
  private passwordService = inject(PasswordService);
  private route = inject(ActivatedRoute);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly token = computed(() => this.queryParamMap().get('token'));
  readonly resetLinkError = computed(() => this.queryParamMap().get('error'));
  readonly state = signal<ConfirmState>('form');
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly submitted = signal(false);

  // Password visibility signals
  readonly passwordVisible = signal(false);
  readonly passwordConfirmVisible = signal(false);

  readonly resetModel = signal({password: '', passwordConfirm: ''});

  f = form(this.resetModel, (f) => {
    required(f.password);
    minLength(f.password, 8);
    maxLength(f.password, 72); // bcrypt limit
    required(f.passwordConfirm);
    maxLength(f.passwordConfirm, 72); // bcrypt limit
  });

  isFieldInvalid<T>(field: MaybeFieldTree<T>): boolean {
    return isSignalFormFieldInvalid(field, this.submitted());
  }

  hasError<T>(field: MaybeFieldTree<T>, errorKind: string): boolean {
    return signalFormFieldHasError(field, errorKind);
  }

  ngOnInit(): void {
    if (this.hasInvalidResetLink()) {
      this.error.set(INVALID_RESET_LINK_MESSAGE);
      this.state.set('error');
      return;
    }

    const token = this.token();
    if (!token) {
      this.error.set(MISSING_RESET_TOKEN_MESSAGE);
      this.state.set('error');
      return;
    }

    if (!this.isValidToken(token)) {
      this.error.set(INVALID_RESET_LINK_MESSAGE);
      this.state.set('error');
    }
  }

  private isValidToken(token: string): boolean {
    return RESET_TOKEN_PATTERN.test(token);
  }

  private hasInvalidResetLink(): boolean {
    if (this.resetLinkError() === 'INVALID_TOKEN') {
      return true;
    }

    const token = this.token();
    return token ? !this.isValidToken(token) : false;
  }

  readonly passwordsMismatch = computed(() => {
    const {password, passwordConfirm} = this.resetModel();
    return password && passwordConfirm && password !== passwordConfirm;
  });

  async onSubmit() {
    if (this.hasInvalidResetLink()) {
      this.error.set(INVALID_RESET_LINK_MESSAGE);
      this.state.set('error');
      return;
    }

    this.submitted.set(true);
    this.error.set(null);

    if (this.f().invalid()) {
      // Signal forms track touched state automatically via [formField] directive interactions
      // but we can force validation display via 'submitted' signal
      return;
    }

    if (this.passwordsMismatch()) {
      this.error.set('Passwords do not match');
      return;
    }

    const {password, passwordConfirm} = this.resetModel();

    this.loading.set(true);
    this.state.set('loading');

    try {
      const token = this.token();
      if (!token) {
        this.error.set(MISSING_RESET_TOKEN_MESSAGE);
        this.state.set('error');
        return;
      }

      if (!this.isValidToken(token)) {
        this.error.set(INVALID_RESET_LINK_MESSAGE);
        this.state.set('error');
        return;
      }

      await this.passwordService.confirmPasswordReset(
        token,
        password,
        passwordConfirm,
      );
      this.state.set('success');
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Password reset failed',
      );
      this.state.set('error');
    } finally {
      this.loading.set(false);
    }
  }
}
