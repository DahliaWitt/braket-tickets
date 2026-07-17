import {
  Component,
  ChangeDetectionStrategy,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {resolveConfirmOAuthCallback} from './confirm-oauth-callback';

type ConfirmState = 'loading' | 'success' | 'error';

@Component({
  selector: 'app-confirm-verification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ZardButtonComponent,
    ZardCardComponent,
    ConfirmationStateComponent,
  ],
  template: `
    <div
      class="bg-waterfall ph-no-capture flex min-h-screen items-center justify-center bg-background p-4 selection:bg-primary selection:text-primary-foreground"
    >
      <z-card
        class="animate-fade-in relative z-10 w-full max-w-md border-border shadow-2xl"
      >
        <div class="space-y-6 p-6 text-center">
          @switch (state()) {
            @case ('loading') {
              <app-confirmation-state
                icon="loader-circle"
                title="Verifying your email..."
                description="Just a moment while we confirm your email address."
                variant="loading"
                [loading]="true"
              />
            }
            @case ('success') {
              <app-confirmation-state
                iconId="success-icon"
                icon="check"
                title="Email Verified!"
                description="Your email has been verified. You are being logged in and redirected..."
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
            }
            @case ('error') {
              <app-confirmation-state
                iconId="error-icon"
                descriptionId="error-message"
                icon="x"
                title="Verification Failed"
                [description]="error() ?? ''"
                variant="error"
              >
                <div class="flex gap-3">
                  <a
                    routerLink="/login"
                    z-button
                    zType="ghost"
                    class="flex-1 border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    Back to Login
                  </a>
                </div>
              </app-confirmation-state>
            }
          }
        </div>
      </z-card>
    </div>
  `,
})
export class ConfirmVerificationComponent {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly redirectHandled = signal(false);
  private readonly initialized = signal(false);
  private readonly paramMap = toSignal(this.route.paramMap, {
    requireSync: true,
  });
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly state = signal<ConfirmState>('loading');
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const alreadyInitialized = untracked(() => this.initialized());
      const paramMap = this.paramMap();
      const queryParamMap = this.queryParamMap();
      const ott = queryParamMap.get('ott') ?? undefined;
      const callbackError = queryParamMap.get('error') ?? undefined;
      const token =
        paramMap.get('token') ??
        queryParamMap.get('token') ??
        queryParamMap.get('code') ??
        undefined;
      if (alreadyInitialized) {
        return;
      }

      this.initialized.set(true);
      void this.confirmEmailVerification(ott, token, callbackError);
    });

    effect(() => {
      const state = this.state();
      const initialized = this.auth.authInitialized();
      const authenticated = this.auth.isAuthenticated();
      const user = this.auth.user();
      const alreadyHandled = untracked(() => this.redirectHandled());

      if (alreadyHandled || state !== 'success') {
        return;
      }

      if (!initialized) {
        return;
      }

      if (!authenticated) {
        this.error.set('Verification did not create a signed-in session.');
        this.state.set('error');
        return;
      }

      if (!user) {
        return;
      }

      this.redirectHandled.set(true);
      void this.router.navigateByUrl(this.returnUrl());
    });
  }

  private returnUrl(): string {
    return sanitizeInternalReturnUrl(this.queryParamMap().get('returnUrl'));
  }

  private async tryRedirectImmediately(): Promise<void> {
    if (
      this.redirectHandled() ||
      !this.auth.authInitialized() ||
      !this.auth.isAuthenticated()
    ) {
      return;
    }

    const user = this.auth.user();
    if (!user) {
      return;
    }

    this.redirectHandled.set(true);
    await this.router.navigateByUrl(this.returnUrl());
  }

  /**
   * Maps a Better Auth `/verify-email` error code (e.g. `TOKEN_EXPIRED`,
   * `INVALID_TOKEN`) to a user-facing verification-failure message.
   */
  private verificationCallbackErrorMessage(code: string): string {
    if (code.toUpperCase().includes('EXPIRED')) {
      return 'This verification link has expired. Please sign in and request a new one.';
    }
    return 'This verification link is invalid or has already been used. Please sign in and request a new one.';
  }

  private async confirmEmailVerification(
    ott: string | undefined,
    token: string | undefined,
    callbackError?: string,
  ): Promise<void> {
    // Better Auth redirects failed verifications to `${callbackURL}?error=<code>`
    // with no usable token, so surface the failure instead of falling through to
    // the no-token success branch below.
    if (callbackError) {
      this.error.set(this.verificationCallbackErrorMessage(callbackError));
      this.state.set('error');
      return;
    }

    if (ott) {
      const outcome = await resolveConfirmOAuthCallback({
        auth: this.auth,
        callbackError: undefined,
        ott,
        callbackErrorMessage: 'Verification failed',
        missingOttMessage: 'Verification failed',
        fallbackErrorMessage: 'Verification failed',
      });

      if (!outcome.ok) {
        this.error.set(outcome.errorMessage);
        this.state.set('error');
        return;
      }

      if (outcome.result.completionState.requiresSocialSignupCompletion) {
        await this.router.navigate(['/confirm/social-signup-complete'], {
          queryParams: {
            returnUrl: '/',
          },
          replaceUrl: true,
        });
        return;
      }

      this.state.set('success');
      await this.tryRedirectImmediately();
      return;
    }

    if (!token) {
      this.state.set('success');
      await this.tryRedirectImmediately();
      return;
    }

    try {
      await this.auth.confirmVerification(token);
      this.state.set('success');
      await this.tryRedirectImmediately();
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Verification failed',
      );
      this.state.set('error');
    }
  }
}
