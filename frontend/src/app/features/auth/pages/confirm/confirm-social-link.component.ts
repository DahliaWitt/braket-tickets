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
import {
  isSocialProvider,
  type SocialProvider,
} from '@/features/auth/models/external-auth.model';
import {isNonRetryableReadError, retryWithDelays} from '@/utils/async-control';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';

type ConfirmState = 'loading' | 'success' | 'error';

const CALLBACK_ERROR_MESSAGE =
  'This provider could not be connected right now.';
const INVALID_LINK_MESSAGE =
  'This provider link is invalid or expired. Please try again.';
const SIGNED_OUT_MESSAGE =
  'Sign in to your account, then check Account Settings to confirm this connection.';
// Deliberately does not claim the link failed: the backend links the account
// during the provider callback, so an unconfirmed read here is usually a
// read-lag false negative (see docs/runbooks/auth-incidents.md).
const UNCONFIRMED_LINK_MESSAGE =
  'We could not confirm the connection. Check Account Settings to see if this login method is linked.';

/**
 * Bounded wait for the linked account to be readable after the provider
 * redirect. Better Auth links the account before redirecting here, so the
 * first attempt normally succeeds; the retries absorb read-after-write lag
 * and the Convex client re-auth window right after page load, during which
 * the connected-accounts action reports an empty list.
 */
const LINK_CONFIRM_RETRY_DELAYS_MS = [0, 500, 1000, 2000, 4000] as const;

/**
 * Confirms a social account link after the provider redirect.
 *
 * Unlike the social sign-in callback, the link callback carries NO one-time
 * token (OTT): Better Auth's OAuth callback only creates a session — which the
 * crossDomain plugin turns into an OTT — for sign-in flows. Linking mutates
 * the account list of the already-authenticated user and redirects back
 * without a new session. The user's existing session survives the round-trip
 * in Better Auth client storage, so this page confirms the link by reading the
 * connected accounts with that session instead of demanding a token that can
 * never arrive.
 *
 * The success state asserts the postcondition "this provider is connected",
 * not that this specific visit performed the link — a revisit while the
 * provider is already linked truthfully reports it as connected.
 */
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
      const queryParamMap = this.queryParamMap();
      const authInitialized = this.auth.authInitialized();
      const alreadyInitialized = untracked(() => this.initialized());
      if (alreadyInitialized) {
        return;
      }

      // The link confirmation reads state owned by the signed-in session, so
      // hold the loading state until auth bootstrap settles.
      if (!authInitialized) {
        return;
      }

      this.initialized.set(true);
      void this.initialize(
        queryParamMap.get('error') ?? undefined,
        queryParamMap.get('provider') ?? undefined,
      );
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

  private async initialize(
    callbackError: string | undefined,
    provider: string | undefined,
  ): Promise<void> {
    if (callbackError) {
      this.fail(CALLBACK_ERROR_MESSAGE);
      return;
    }

    if (!isSocialProvider(provider)) {
      this.fail(INVALID_LINK_MESSAGE);
      return;
    }

    if (!this.auth.isAuthenticated()) {
      this.fail(SIGNED_OUT_MESSAGE);
      return;
    }

    const linked = await this.confirmProviderLinked(provider);
    if (!linked) {
      this.fail(UNCONFIRMED_LINK_MESSAGE);
      return;
    }

    this.state.set('success');
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('error');
  }

  private async confirmProviderLinked(
    provider: SocialProvider,
  ): Promise<boolean> {
    try {
      await retryWithDelays({
        delaysMs: LINK_CONFIRM_RETRY_DELAYS_MS,
        run: async () => {
          const accounts = await this.auth.getExternalAuths();
          if (!accounts.some((account) => account.provider === provider)) {
            throw new Error(`Provider ${provider} is not linked yet`);
          }
        },
        shouldRetry: (error) => !isNonRetryableReadError(error),
      });
      return true;
    } catch {
      return false;
    }
  }
}
