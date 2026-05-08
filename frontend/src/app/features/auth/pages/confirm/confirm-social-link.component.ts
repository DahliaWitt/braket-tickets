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
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {resolveConfirmOAuthCallback} from './confirm-oauth-callback';

type ConfirmState = 'loading' | 'success' | 'error';

@Component({
  selector: 'app-confirm-social-link',
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
                title="Connecting provider..."
                description="Just a moment while we finish linking this login method."
                variant="loading"
                [loading]="true"
              />
            }
            @case ('success') {
              <app-confirmation-state
                icon="check"
                title="Provider connected"
                description="Your account can now use this login method."
                variant="success"
              >
                <a
                  routerLink="/account"
                  z-button
                  class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
                >
                  Back to Account
                </a>
              </app-confirmation-state>
            }
            @case ('error') {
              <app-confirmation-state
                icon="x"
                title="Provider unavailable"
                [description]="error() ?? ''"
                variant="error"
              >
                <a
                  routerLink="/account"
                  z-button
                  zType="ghost"
                  class="w-full border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase"
                >
                  Back to Account
                </a>
              </app-confirmation-state>
            }
          }
        </div>
      </z-card>
    </div>
  `,
})
export class ConfirmSocialLinkComponent {
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
      const alreadyHandled = untracked(() => this.redirectHandled());

      if (alreadyHandled || state !== 'success') {
        return;
      }

      if (!initialized || !authenticated || !user) {
        return;
      }

      void this.navigateToAccount();
    });
  }

  private async navigateToAccount(): Promise<void> {
    if (untracked(() => this.redirectHandled())) {
      return;
    }

    this.redirectHandled.set(true);
    await this.router.navigate(['/account']);
  }

  private async navigateToAccountIfReady(): Promise<void> {
    if (
      !this.auth.authInitialized() ||
      !this.auth.isAuthenticated() ||
      !this.auth.user()
    ) {
      return;
    }

    await this.navigateToAccount();
  }

  private async initialize(
    callbackError: string | undefined,
    ott: string | undefined,
  ): Promise<void> {
    const outcome = await resolveConfirmOAuthCallback({
      auth: this.auth,
      callbackError,
      ott,
      callbackErrorMessage: 'This provider could not be connected right now.',
      missingOttMessage:
        'This provider link is invalid or expired. Please try again.',
      fallbackErrorMessage: 'This provider could not be connected right now.',
      syncUserToApp: false,
    });

    if (!outcome.ok) {
      this.error.set(outcome.errorMessage);
      this.state.set('error');
      return;
    }

    this.state.set('success');
    await this.navigateToAccountIfReady();
  }
}
