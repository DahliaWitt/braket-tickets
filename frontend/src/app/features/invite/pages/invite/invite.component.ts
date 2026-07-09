import {
  Component,
  ChangeDetectionStrategy,
  computed,
  DestroyRef,
  signal,
  effect,
  inject,
} from '@angular/core';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {map} from 'rxjs/operators';
import {AuthService} from '@/core/services/auth.service';
import {injectConvex, injectQuery, skipToken} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';

type ViewState = 'loading' | 'error' | 'options' | 'redeeming' | 'success';

@Component({
  selector: 'app-invite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @switch (viewState()) {
      @case ('loading') {
        <div
          data-testid="invite-loading"
          class="flex min-h-screen items-center justify-center"
        >
          <div role="status">
            <div
              class="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-primary"
            ></div>
            <span class="sr-only">Loading...</span>
          </div>
        </div>
      }
      @case ('error') {
        <div
          data-testid="invite-error"
          class="flex min-h-screen flex-col items-center justify-center gap-6 px-6"
        >
          <div
            class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10"
          >
            <span class="text-2xl text-destructive-text">&#x2715;</span>
          </div>
          <h1
            class="text-center font-display text-2xl font-bold tracking-tight uppercase sm:text-3xl"
          >
            Link Unavailable
          </h1>
          <p
            data-testid="invite-error-message"
            class="mono-label text-center text-xs text-muted-foreground"
          >
            {{ errorMessage() }}
          </p>
          <a
            routerLink="/"
            class="mt-4 font-mono text-sm tracking-wider text-primary uppercase hover:underline"
          >
            &larr; Back to Home
          </a>
        </div>
      }
      @case ('options') {
        <div
          data-testid="invite-options"
          class="flex min-h-screen flex-col items-center justify-center gap-6 px-6"
        >
          <div class="space-y-3 text-center">
            <p class="mono-label text-2xs text-muted-foreground">invitation</p>
            <h1
              class="font-display text-3xl font-bold tracking-tight uppercase sm:text-4xl"
            >
              You're Invited
            </h1>
            <p class="max-w-md text-muted-foreground">
              This link will automatically vet you
              @if (communityName()) {
                for
                <span
                  data-testid="invite-community-name"
                  class="font-semibold text-foreground"
                  >{{ communityName() }}</span
                >.
              } @else {
                for this community.
              }
              <span class="font-bold text-foreground"
                >Only share with trusted comrades.</span
              >
            </p>
            <p class="mono-label text-2xs text-muted-foreground">
              Do not post in public channels like Discord
            </p>
          </div>
          <div class="flex flex-col gap-4 sm:flex-row">
            <a
              data-testid="invite-sign-in"
              [routerLink]="['/login']"
              [queryParams]="{returnUrl: '/invite/' + token()}"
              class="inline-flex w-full items-center justify-center rounded-md bg-primary px-6 py-3 font-mono text-sm tracking-wider text-primary-foreground uppercase transition-colors hover:bg-primary/90 sm:w-auto"
            >
              Sign In
            </a>
            <a
              data-testid="invite-create-account"
              [routerLink]="['/login']"
              [queryParams]="{signup: 'true', returnUrl: '/invite/' + token()}"
              class="inline-flex w-full items-center justify-center rounded-md border border-border px-6 py-3 font-mono text-sm tracking-wider text-foreground uppercase transition-colors hover:bg-accent sm:w-auto"
            >
              Create Account
            </a>
          </div>
        </div>
      }
      @case ('redeeming') {
        <div
          data-testid="invite-redeeming"
          class="flex min-h-screen flex-col items-center justify-center gap-4"
        >
          <div role="status" class="flex flex-col items-center gap-4">
            <div
              class="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-primary"
            ></div>
            <span class="sr-only">Verifying access...</span>
          </div>
          <p
            class="mono-label text-xs text-muted-foreground"
            aria-hidden="true"
          >
            verifying access
          </p>
        </div>
      }
      @case ('success') {
        <div
          data-testid="invite-success"
          class="flex min-h-screen flex-col items-center justify-center gap-6 px-6"
        >
          <div
            class="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/10"
          >
            <span class="text-2xl text-secondary">&#x2713;</span>
          </div>
          <h1
            class="font-display text-2xl font-bold tracking-tight uppercase sm:text-3xl"
          >
            Welcome
          </h1>
          <p class="mono-label text-xs text-muted-foreground">access granted</p>
          <a
            routerLink="/"
            class="mt-4 font-mono text-sm tracking-wider text-primary uppercase hover:underline"
          >
            Go to Home &rarr;
          </a>
        </div>
      }
    }
  `,
})
export class InviteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly convex = injectConvex();
  private readonly destroyRef = inject(DestroyRef);
  private redirectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Token extracted from the :token route param. */
  readonly token = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('token') ?? '')),
    {initialValue: ''},
  );

  /**
   * Realtime query to validate the magic link token.
   * Skips the query when the token is empty (before route resolves).
   */
  readonly validationResult = injectQuery(
    api.communities.invite_links.validateToken,
    () => (this.token() ? {token: this.token()} : skipToken),
  );

  /** Tracks the redemption lifecycle to prevent double-calls and drive view state. */
  readonly redemptionStatus = signal<
    'idle' | 'redeeming' | 'success' | 'error'
  >('idle');

  readonly viewState = computed<ViewState>(() => {
    // Still loading the validation query
    if (this.validationResult.isLoading()) return 'loading';

    const result = this.validationResult.data();
    if (!result) return 'loading';

    // Link is invalid/expired/etc
    if (!result.valid) return 'error';

    // Redemption already in flight or done
    if (this.redemptionStatus() === 'redeeming') return 'redeeming';
    if (this.redemptionStatus() === 'success') return 'success';
    if (this.redemptionStatus() === 'error') return 'error';

    // Valid link, user not authenticated -- show sign-in options
    if (!this.auth.isAuthenticated()) return 'options';

    // Valid link, authenticated user -- trigger auto-redeem
    return 'redeeming';
  });

  readonly communityName = computed(() => {
    const result = this.validationResult.data();
    return result?.communityName;
  });

  readonly errorMessage = computed(() => {
    // Redemption-level failure
    if (this.redemptionStatus() === 'error') {
      return 'Something went wrong while redeeming the link. Please try again.';
    }

    const result = this.validationResult.data();
    if (!result || result.valid) return '';

    switch (result.error) {
      case undefined:
        return 'This link is unavailable.';
      case 'invalid':
        return 'This link does not exist or has been removed.';
      case 'paused':
        return 'This link has been temporarily paused.';
      case 'disabled':
        return 'This link is no longer active.';
      case 'expired':
        return 'This link has expired.';
      case 'maxed':
        return 'This link has reached its maximum uses.';
      default:
        return 'This link is unavailable.';
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearRedirectTimeout();
    });

    effect(() => {
      if (this.viewState() !== 'success') {
        this.clearRedirectTimeout();
      }
    });

    effect(() => {
      this.token();
      this.clearRedirectTimeout();
    });

    // This effect triggers a one-shot mutation (redemption), not data fetching.
    // The idle guard prevents re-execution. Distinct from the CLAUDE.md rule
    // "avoid effect() for data fetching" which targets reactive data subscriptions.
    effect(() => {
      const state = this.viewState();
      const token = this.token();
      const user = this.auth.user();

      if (state === 'redeeming' && user && token) {
        void this.redeemLink(token);
      }
    });
  }

  /**
   * Calls the redeem mutation and navigates to the home page on success.
   * Guards against double invocation via redemptionStatus.
   */
  private async redeemLink(token: string): Promise<void> {
    if (this.redemptionStatus() !== 'idle') return;
    this.redemptionStatus.set('redeeming');

    try {
      const result = await this.convex.mutation(
        api.communities.invite_links.redeem,
        {token},
      );

      this.redemptionStatus.set('success');

      if (result.alreadyMember) {
        toast.info('You are already a member of this community.');
      } else if (result.alreadyRedeemed) {
        toast.success("You've already used this link");
      } else {
        toast.success('Welcome! You are now part of the community.');
      }

      // Redirect to home after a brief delay so the user sees the success state
      this.clearRedirectTimeout();
      const scheduledToken = token;
      const timeoutId = setTimeout(() => {
        if (this.redirectTimeoutId !== timeoutId) return;
        if (this.viewState() !== 'success') return;
        if (this.token() !== scheduledToken) return;

        this.redirectTimeoutId = null;
        void this.router.navigate(['/']);
      }, 2000);
      this.redirectTimeoutId = timeoutId;
    } catch (err: unknown) {
      logger.error('[InviteComponent] Redeem failed', err);
      this.redemptionStatus.set('error');
      toast.error('Something went wrong. Please try again.');
    }
  }

  private clearRedirectTimeout(): void {
    if (this.redirectTimeoutId !== null) {
      clearTimeout(this.redirectTimeoutId);
      this.redirectTimeoutId = null;
    }
  }
}
