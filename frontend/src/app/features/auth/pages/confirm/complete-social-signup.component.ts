import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {ConfirmationStateComponent} from '@ui/components/composites/confirmation-state/confirmation-state.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';

type CompleteState = 'loading' | 'ready' | 'submitting' | 'error';

@Component({
  selector: 'app-complete-social-signup',
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
        <div class="space-y-6 p-6">
          @if (state() === 'error') {
            <app-confirmation-state
              icon="x"
              title="Account setup unavailable"
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
          } @else {
            <div class="space-y-4">
              <p
                class="font-mono text-2xs tracking-widest text-primary/80 uppercase"
              >
                One Last Step
              </p>
              <app-confirmation-state
                icon="badge-check"
                title="You made it in"
                description="Before we drop you into the app, we need one clean yes on the house rules."
                [variant]="
                  state() === 'loading' || state() === 'submitting'
                    ? 'loading'
                    : 'success'
                "
                [loading]="state() === 'loading' || state() === 'submitting'"
              />
            </div>

            <label
              class="flex items-start gap-3 font-sans text-sm leading-relaxed text-muted-foreground"
            >
              <input
                type="checkbox"
                [checked]="acceptedTerms()"
                [disabled]="state() !== 'ready'"
                (change)="acceptedTerms.set(!acceptedTerms())"
                class="mt-0.5 h-6 w-6 rounded border-border bg-background text-primary focus:ring-primary focus:ring-offset-background"
              />
              <span>
                I agree to the
                <a
                  routerLink="/terms"
                  class="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Terms of Service</a
                >
                and
                <a
                  routerLink="/privacy"
                  class="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Privacy Policy</a
                >.
              </span>
            </label>

            @if (inlineError()) {
              <p
                data-testid="social-signup-inline-error"
                class="mono-label text-2xs text-destructive-text"
              >
                {{ inlineError() }}
              </p>
            }

            <button
              z-button
              type="button"
              class="w-full bg-foreground font-display tracking-wider text-background uppercase hover:bg-foreground/90"
              [zLoading]="state() === 'submitting'"
              [zDisabled]="continueDisabled()"
              (click)="complete()"
            >
              Finish Setup
            </button>
          }
        </div>
      </z-card>
    </div>
  `,
})
export class CompleteSocialSignupComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly state = signal<CompleteState>('loading');
  readonly acceptedTerms = signal(false);
  readonly error = signal<string | null>(null);
  readonly inlineError = signal<string | null>(null);
  readonly continueDisabled = computed(
    () => this.state() !== 'ready' || !this.acceptedTerms(),
  );

  constructor() {
    effect(() => {
      const initialized = this.auth.authInitialized();
      const authenticated = this.auth.isAuthenticated();
      const user = this.auth.user();

      if (!initialized) {
        return;
      }

      if (!authenticated) {
        this.error.set('Your session has expired. Please sign in again.');
        this.state.set('error');
        return;
      }

      if (user?.termsAcceptedAt) {
        void this.router.navigateByUrl(this.resolveReturnUrl());
        return;
      }

      if (this.state() === 'loading') {
        this.error.set(null);
        this.state.set('ready');
      }
    });
  }

  private resolveReturnUrl(): string {
    return sanitizeInternalReturnUrl(this.queryParamMap().get('returnUrl'));
  }

  async complete(): Promise<void> {
    if (!this.auth.authInitialized() || !this.auth.isAuthenticated()) {
      return;
    }

    if (!this.acceptedTerms()) {
      this.inlineError.set('Please accept the terms to continue.');
      return;
    }

    this.state.set('submitting');
    this.inlineError.set(null);
    try {
      await this.auth.completeSocialSignupOnboarding();
      await this.router.navigateByUrl(this.resolveReturnUrl());
    } catch {
      this.error.set('Account setup could not be completed. Please try again.');
      this.state.set('error');
    }
  }
}
