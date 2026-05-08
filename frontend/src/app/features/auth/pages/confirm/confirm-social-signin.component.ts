import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {resolveConfirmOAuthCallback} from './confirm-oauth-callback';

type ConfirmState = 'loading' | 'success' | 'error';

@Component({
  selector: 'app-confirm-social-signin',
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
                title="Just a moment..."
                description="We are matching your provider sign-in with Braket Tickets. If this is your first time here, the house rules are next."
                variant="loading"
                [loading]="true"
              />
            }
            @case ('success') {
              <app-confirmation-state
                icon="check"
                title="You are in"
                description="Your session is ready. Head inside."
                variant="success"
              >
                <button
                  z-button
                  type="button"
                  class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
                  (click)="continueToApp()"
                >
                  Head Inside
                </button>
              </app-confirmation-state>
            }
            @case ('error') {
              <app-confirmation-state
                icon="x"
                title="Authentication unavailable"
                [description]="error() ?? ''"
                variant="error"
              >
                <a
                  routerLink="/login"
                  z-button
                  zType="ghost"
                  class="w-full border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase"
                >
                  Back to Auth
                </a>
              </app-confirmation-state>
            }
          }
        </div>
      </z-card>
    </div>
  `,
})
export class ConfirmSocialSigninComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly redirectHandled = signal(false);
  private readonly initialized = signal(false);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly state = signal<ConfirmState>('loading');
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const alreadyInitialized = untracked(() => this.initialized());
      const queryParamMap = this.queryParamMap();
      const callbackError = queryParamMap.get('error') ?? undefined;
      const ott = queryParamMap.get('ott') ?? undefined;
      if (alreadyInitialized) {
        return;
      }

      this.initialized.set(true);
      void this.initialize(callbackError, ott);
    });

    effect(() => {
      const state = this.state();
      const initialized = this.auth.authInitialized();
      const authenticated = this.auth.isAuthenticated();
      const user = this.auth.user();

      if (state !== 'success') {
        return;
      }

      if (!initialized || !authenticated || !user) {
        return;
      }

      void this.navigateToReturnUrl();
    });
  }

  async continueToApp(): Promise<void> {
    await this.navigateToReturnUrl();
  }

  private async navigateToReturnUrl(): Promise<void> {
    if (untracked(() => this.redirectHandled())) {
      return;
    }

    this.redirectHandled.set(true);
    await this.router.navigateByUrl(this.resolveReturnUrl());
  }

  private async navigateToReturnUrlIfReady(): Promise<void> {
    if (
      !this.auth.authInitialized() ||
      !this.auth.isAuthenticated() ||
      !this.auth.user()
    ) {
      return;
    }

    await this.navigateToReturnUrl();
  }

  private async initialize(
    callbackError: string | undefined,
    ott: string | undefined,
  ): Promise<void> {
    const outcome = await resolveConfirmOAuthCallback({
      auth: this.auth,
      callbackError,
      ott,
      callbackErrorMessage: 'Sign-in could not be completed. Please try again.',
      missingOttMessage:
        'This sign-in link is invalid or expired. Please try again.',
      fallbackErrorMessage: 'Sign-in could not be completed. Please try again.',
      syncUserToApp: true,
    });

    if (!outcome.ok) {
      this.error.set(outcome.errorMessage);
      this.state.set('error');
      return;
    }

    if (outcome.result.completionState.requiresSocialSignupCompletion) {
      await this.router.navigate(['/confirm/social-signup-complete'], {
        queryParams: {
          returnUrl: this.resolveReturnUrl(),
        },
        replaceUrl: true,
      });
      return;
    }

    this.state.set('success');
    await this.navigateToReturnUrlIfReady();
  }

  private resolveReturnUrl(): string {
    return sanitizeInternalReturnUrl(this.queryParamMap().get('returnUrl'));
  }
}
