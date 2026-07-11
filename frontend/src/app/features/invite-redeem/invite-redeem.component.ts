import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  input,
} from '@angular/core';
import {RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {AdminInvitesService} from '@/features/admin/services/admin-invites.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';
import {ConvexError} from 'convex/values';

const INVALID_INVITE_MESSAGE =
  'This invitation link is invalid or has expired. Please request a new invite.';

const GENERIC_REDEEM_FAILURE_MESSAGE = 'Failed to accept invitation.';

// LINT.IfChange
const INVITE_ERROR_MESSAGES_BY_CODE = {
  INVITE_CANCELLED: 'This invitation has been cancelled',
  INVITE_ALREADY_REDEEMED: 'This invitation has already been redeemed',
  INVITE_EXPIRED: 'This invitation has expired',
  EMAIL_MISMATCH: 'This invitation was sent to a different email address',
} as const satisfies Record<string, string>;
// LINT.ThenChange("../../../../../backend/convex/communities/management/_impl/invites.ts")

const POLISHED_REDEEM_ERROR_MESSAGES = new Set([
  ...Object.values(INVITE_ERROR_MESSAGES_BY_CODE),
  'No invitation token provided.',
]);

@Component({
  selector: 'app-invite-redeem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent, RouterLink],
  template: `
    <div
      class="flex min-h-screen items-center justify-center bg-background p-6"
    >
      <div
        class="w-full max-w-md space-y-6 text-center"
        data-testid="invite-redeem-page"
      >
        @if (loading()) {
          <div class="space-y-4" data-testid="redeem-loading">
            <div role="status">
              <z-icon
                zType="loader-circle"
                class="mx-auto h-12 w-12 animate-spin text-primary"
              />
              <span class="sr-only">Accepting invitation...</span>
            </div>
            <p class="font-mono text-muted-foreground" aria-hidden="true">
              Accepting invitation...
            </p>
          </div>
        } @else if (success()) {
          <div class="space-y-4" data-testid="redeem-success">
            <z-icon
              zType="circle-check"
              class="mx-auto h-12 w-12 text-success"
            />
            <h1
              class="font-display text-2xl font-bold text-foreground uppercase"
            >
              you're in
            </h1>
            <p class="font-mono text-muted-foreground">
              You're now a community admin.
            </p>
            <a routerLink="/community-admin" z-button class="mt-4">
              Go to Dashboard
            </a>
          </div>
        } @else if (needsLogin()) {
          <div class="space-y-4" data-testid="redeem-needs-login">
            <z-icon
              zType="shield"
              class="mx-auto h-12 w-12 text-muted-foreground"
            />
            <h1
              class="font-display text-2xl font-bold text-foreground uppercase"
            >
              Sign in to accept
            </h1>
            <p class="font-mono text-muted-foreground">
              You need to sign in or create an account to accept this
              invitation.
            </p>
            <div class="mt-4 flex flex-col justify-center gap-4 sm:flex-row">
              <a
                data-testid="redeem-sign-in"
                [routerLink]="['/login']"
                [queryParams]="{returnUrl: returnUrl()}"
                z-button
              >
                Sign In
              </a>
              <a
                data-testid="redeem-create-account"
                [routerLink]="['/login']"
                [queryParams]="{returnUrl: returnUrl(), signup: 'true'}"
                z-button
                zType="outline"
              >
                Create Account
              </a>
            </div>
          </div>
        } @else {
          <div class="space-y-4" data-testid="redeem-error">
            <z-icon
              zType="circle-x"
              class="mx-auto h-12 w-12 text-destructive-text"
            />
            <h1
              class="font-display text-2xl font-bold text-foreground uppercase"
            >
              Invitation Error
            </h1>
            <p class="font-mono text-muted-foreground">{{ error() }}</p>
            <a routerLink="/" z-button zType="ghost" class="mt-4"> Go Home </a>
          </div>
        }
      </div>
    </div>
  `,
})
export class InviteRedeemComponent {
  private auth = inject(AuthService);
  private invitesService = inject(AdminInvitesService);

  readonly token = input<string | undefined>();

  readonly returnUrl = computed(() => {
    const t = this.token();
    return t ? `/admin-invite/${t}` : '';
  });

  /** Tracks the redeem lifecycle to prevent double-calls and drive view state. */
  readonly redeemStatus = signal<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );

  readonly loading = computed(() => this.redeemStatus() === 'loading');
  readonly success = computed(() => this.redeemStatus() === 'success');
  readonly needsLogin = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // One-shot effect: waits for auth to initialize, then redeems or prompts login.
    // The idle guard prevents re-execution if signals change after the first run.
    // This is a one-shot side-effect trigger, not reactive data fetching.
    effect(() => {
      const token = this.token();
      const initialized = this.auth.authInitialized();

      if (!initialized) return;
      if (this.redeemStatus() !== 'idle') return;

      if (!token) {
        this.redeemStatus.set('error');
        this.error.set('No invitation token provided.');
        return;
      }

      if (!this.auth.isAuthenticated()) {
        this.needsLogin.set(true);
        this.redeemStatus.set('error'); // exit idle so this branch doesn't re-run
        return;
      }

      void this.attemptRedeem(token);
    });
  }

  private async attemptRedeem(token: string): Promise<void> {
    this.redeemStatus.set('loading');
    try {
      await this.invitesService.redeem(token);
      this.redeemStatus.set('success');
    } catch (err: unknown) {
      this.error.set(formatRedeemError(err));
      this.redeemStatus.set('error');
      logger.error('Invite redemption failed', err);
    }
  }
}

function formatRedeemError(err: unknown): string {
  const structuredError = getStructuredConvexError(err);
  if (structuredError?.code === 'INVALID_TOKEN') {
    return INVALID_INVITE_MESSAGE;
  }

  if (structuredError) {
    return (
      getKnownInviteErrorMessage(structuredError.code) ??
      GENERIC_REDEEM_FAILURE_MESSAGE
    );
  }

  const message = err instanceof Error ? err.message.trim() : '';

  if (!message) {
    return GENERIC_REDEEM_FAILURE_MESSAGE;
  }

  if (POLISHED_REDEEM_ERROR_MESSAGES.has(message)) {
    return message;
  }

  if (isInvalidInviteError(message)) {
    return INVALID_INVITE_MESSAGE;
  }

  return GENERIC_REDEEM_FAILURE_MESSAGE;
}

function isInvalidInviteError(message: string): boolean {
  return /\bINVALID_TOKEN\b/i.test(message);
}

function getKnownInviteErrorMessage(code: string): string | null {
  return Object.hasOwn(INVITE_ERROR_MESSAGES_BY_CODE, code)
    ? INVITE_ERROR_MESSAGES_BY_CODE[
        code as keyof typeof INVITE_ERROR_MESSAGES_BY_CODE
      ]
    : null;
}

function getStructuredConvexError(err: unknown): {code: string} | null {
  if (!(err instanceof ConvexError)) return null;

  const data: unknown = Reflect.get(err, 'data');
  if (typeof data !== 'object' || data === null) return null;

  const code: unknown = Reflect.get(data, 'code');
  if (typeof code !== 'string') return null;

  return {code};
}
