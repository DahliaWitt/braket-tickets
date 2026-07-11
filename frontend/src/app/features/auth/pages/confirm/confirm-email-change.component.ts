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
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {AuthService} from '@/core/services/auth.service';

type ConfirmState = 'loading' | 'pending' | 'success' | 'error';

@Component({
  selector: 'app-confirm-email-change',
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
                title="Updating your email..."
                description="Just a moment while we process your request."
                variant="loading"
                [loading]="true"
              />
            }
            @case ('success') {
              <app-confirmation-state
                iconId="success-icon"
                icon="check"
                title="email changed"
                description="Your email has been updated."
                variant="success"
              >
                <a
                  id="account-link"
                  routerLink="/account"
                  z-button
                  zType="default"
                  class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
                >
                  Go to Account Settings
                </a>
              </app-confirmation-state>
            }
            @case ('pending') {
              <app-confirmation-state
                iconId="pending-icon"
                descriptionId="pending-message"
                icon="mail"
                title="Almost Done"
                [description]="pendingDescription()"
                variant="warning"
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
            @case ('error') {
              <app-confirmation-state
                iconId="error-icon"
                descriptionId="error-message"
                icon="x"
                title="Update Failed"
                [description]="error() ?? ''"
                variant="error"
              >
                <div class="flex gap-3">
                  <a
                    routerLink="/account"
                    z-button
                    zType="ghost"
                    class="flex-1 border border-border font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    Back to Account
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
export class ConfirmEmailChangeComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private readonly callbackCompleted = signal(false);
  private readonly awaitingSessionResolution = signal(false);
  private readonly redirectHandled = signal(false);
  private readonly initialized = signal(false);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly state = signal<ConfirmState>('loading');
  readonly error = signal<string | null>(null);
  readonly pendingDescription = signal(
    'Request confirmed. Now verify the link sent to your new inbox to finish.',
  );

  constructor() {
    effect(() => {
      const alreadyInitialized = untracked(() => this.initialized());
      const queryParamMap = this.queryParamMap();
      const callbackError = queryParamMap.get('error') ?? undefined;
      const ott = queryParamMap.get('ott') ?? undefined;
      const isEmailChangeCallback =
        queryParamMap.get('flow') === 'email-change';
      if (alreadyInitialized) {
        return;
      }

      this.initialized.set(true);
      void this.initialize(callbackError, ott, isEmailChangeCallback);
    });

    effect(() => {
      if (!this.callbackCompleted()) {
        return;
      }

      if (!this.auth.authInitialized() || !this.auth.isAuthenticated()) {
        return;
      }

      const user = this.auth.user();
      if (!user) {
        return;
      }

      if (user.pendingEmail) {
        this.state.set('pending');
        return;
      }

      this.state.set('success');
      void this.navigateToAccount();
    });

    effect(() => {
      if (!this.awaitingSessionResolution()) {
        return;
      }

      if (!this.auth.authInitialized()) {
        return;
      }

      if (!this.auth.isAuthenticated()) {
        this.showMissingTokenError();
        this.awaitingSessionResolution.set(false);
        return;
      }

      const user = this.auth.user();
      if (!user) {
        return;
      }

      if (user.pendingEmail) {
        this.state.set('pending');
      } else {
        this.showMissingTokenError();
      }

      this.awaitingSessionResolution.set(false);
    });
  }

  private async initialize(
    callbackError: string | undefined,
    ott: string | undefined,
    isEmailChangeCallback: boolean,
  ) {
    if (callbackError) {
      this.error.set(this.mapCallbackError(callbackError));
      this.state.set('error');
      return;
    }

    if (!ott) {
      if (isEmailChangeCallback) {
        this.pendingDescription.set(
          'If you just confirmed the change request, check the new inbox for the final verification link.',
        );
        this.state.set('pending');
        return;
      }
      this.awaitingSessionResolution.set(true);
      return;
    }

    try {
      await this.auth.handleOAuthCallback(ott, {
        navigateOnSuccess: false,
        syncUserToApp: true,
      });
      this.callbackCompleted.set(true);
    } catch (err: unknown) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to change email',
      );
      this.state.set('error');
    }
  }

  private async navigateToAccount(): Promise<void> {
    if (untracked(() => this.redirectHandled())) {
      return;
    }

    this.redirectHandled.set(true);
    await this.router.navigate(['/account']);
  }

  private showMissingTokenError(): void {
    this.error.set('Invalid email change link. Please request a new one.');
    this.state.set('error');
  }

  private mapCallbackError(errorCode: string): string {
    switch (errorCode) {
      case 'token_expired':
        return 'Email change link has expired. Please request a new one.';
      case 'invalid_token':
        return 'Invalid email change link. Please request a new one.';
      case 'unauthorized':
        return 'You must be signed in to complete this email change.';
      case 'user_not_found':
        return 'Unable to find the account for this email change request.';
      default:
        return 'Failed to change email';
    }
  }
}
