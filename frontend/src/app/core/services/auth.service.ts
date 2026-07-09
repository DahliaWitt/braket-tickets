import {DestroyRef, Injectable, computed, inject, signal} from '@angular/core';
import {toObservable} from '@angular/core/rxjs-interop';
import {firstValueFrom, TimeoutError} from 'rxjs';
import {filter, timeout} from 'rxjs/operators';
import {Router} from '@angular/router';
import {
  injectConvex,
  injectQuery,
  skipToken,
  type ConvexAuthProvider,
} from 'convex-angular';
import {type MutationOptions} from 'convex/browser';
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server';
import {api} from '@convex/_generated/api';
import {
  type ExternalAuth,
  type SocialProvider,
} from '@/features/auth/models/external-auth.model';
import {logger} from '@/utils/logger';
import {retryWithDelays} from '@/utils/async-control';
import {
  extractErrorMessage,
  isRetryableAuthBackendError,
} from '@/core/utils/auth.utils';
import {
  isDuplicateSignupError,
  isVerificationRequiredError,
} from '@/core/utils/auth-error-codes';
import {PasswordService} from '@/core/services/password.service';
import {UserProfileService} from '@/core/services/user-profile.service';
import {
  buildAuthCallbackUrl,
  sanitizeInternalReturnUrl,
} from '@/core/services/auth-navigation';
import {AuthSessionSync} from './auth-session-sync';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  AUTH_SETTLE_TIMEOUT_MS,
  type ConvexActionMethod,
  type ConvexClientWithErrorHandling,
  type ConvexMutationMethod,
  type ConvexQueryMethod,
  type SessionChannelMessage,
  requiresSocialSignupCompletion,
} from './auth.service.helpers';
import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {AUTH_CLIENT} from './auth-client.token';
import {
  narrowCachedSession,
  type CachedSessionPeek,
} from '../../../lib/auth-storage';
import {environment} from '../../../environments/environment';

/**
 * Error thrown when a user attempts to log in with an unverified email address.
 * The error includes the email so the UI can offer to resend verification.
 */
export class UnverifiedEmailError extends Error {
  constructor(public readonly email: string) {
    super('Account unverified. A verification email has been sent.');
    this.name = 'UnverifiedEmailError';
  }
}

export class SocialAuthBlockedError extends Error {
  constructor(
    public readonly reason:
      | 'provider_email_missing'
      | 'provider_email_unverified',
  ) {
    super(
      reason === 'provider_email_missing'
        ? 'This provider did not return an email address. Sign in with your existing account first, then link it from account settings.'
        : 'This provider did not return a verified email address. Verify the provider email first or sign in with your existing account and link it manually.',
    );
    this.name = 'SocialAuthBlockedError';
  }
}

export interface SocialAuthCompletionState {
  requiresSocialSignupCompletion: boolean;
}

interface BetterAuthSession {
  user: {email: string; name?: string; image?: string | null};
  session?: {id?: string | null} | null;
}

class SessionNotReadyError extends Error {
  constructor(context: string) {
    super(`${context} session is not ready yet`);
    this.name = 'SessionNotReadyError';
  }
}

/**
 * Authentication service handling all user authentication flows.
 *
 * Provides reactive authentication state via signals and supports:
 * - Email/password authentication with verification
 * - Discord OAuth integration
 * - Password reset and email change flows
 * - Role-based access control (root_admin, community_admin, user)
 *
 * @example
 * ```typescript
 * // Check if user is authenticated
 * if (authService.isAuthenticated()) {
 *   console.log('User:', authService.currentUser()?.name);
 * }
 *
 * // Login with email/password
 * await authService.loginWithPassword(email, password);
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService implements ConvexAuthProvider {
  private readonly destroyRef = inject(DestroyRef);
  private readonly convex = injectConvex();
  private readonly router = inject(Router);
  private readonly passwordService = inject(PasswordService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly browser = inject(BrowserPlatformService);
  private readonly toast = inject(BraToastService);

  private sessionSync: AuthSessionSync | null = null;

  /**
   * Better Auth session data.
   * Contains user and session information from Better Auth.
   */
  private readonly session = signal<BetterAuthSession | null>(null);
  private sessionStateVersion = 0;

  /**
   * Signal indicating whether auth initialization has completed.
   * Auth guards should wait for this before checking user state.
   */
  readonly authInitialized = signal(false);
  readonly isLoading = computed(() => !this.authInitialized());
  readonly error = signal<Error | undefined>(undefined);
  readonly reauthVersion = signal(0);
  readonly isSyncingUser = signal(false);
  readonly authSyncFailed = signal(false);

  /**
   * Give-up latch: set when the auth-settle wait times out (session reported
   * but profile never resolved, or init itself hung). Forces `authSettled` true
   * so route guards leave the optimistic path and take their authoritative
   * failure branch, recovering the user off a stuck skeleton instead of
   * stranding them.
   *
   * Scoped to the failed settle attempt: `setSessionState` clears it on any
   * fresh session transition (login, refresh, logout, or a deferred init that
   * finally resolves). Otherwise a later valid session would inherit the stale
   * give-up and be bounced from protected routes while its own profile query is
   * still in flight.
   */
  private readonly authSettleTimedOut = signal(false);

  /**
   * Whether auth has reached a decidable state: initialized, and either
   * unauthenticated or user-synced (or sync explicitly gave up). Single source
   * of truth for the settle predicate — `waitForAuthSettled$` (route guards)
   * and optimistic reconciliation both derive from it, and guarded pages use
   * it to keep skeletons up during the optimistic window instead of flashing
   * empty states.
   */
  readonly authSettled = computed(() => {
    if (this.authSettleTimedOut()) return true;
    if (!this.authInitialized()) return false;
    if (!this.isAuthenticated()) return true;
    if (this.user()) return true;
    return this.authSyncFailed();
  });
  private missingUserRepairSessionKey: string | null = null;
  private missingUserRepairQueuedSessionKey: string | null = null;
  private missingUserRepairInFlightSessionKey: string | null = null;

  /**
   * Reactive query to the current user's profile data.
   * Returns `null` when not authenticated, user data when logged in.
   * Auto-updates via Convex subscription when user data changes.
   */
  private readonly userQuery = injectQuery(api.users.profile['current'], () =>
    this.isAuthenticated() ? {} : skipToken,
  );

  readonly user = computed(() => {
    if (!this.session()) return undefined;
    return this.userQuery.data();
  });

  /**
   * Convenience computed that maps `_id` to `id` for component compatibility.
   * Some components expect `.id` instead of Convex's `._id` format.
   */
  readonly currentUser = computed(() => {
    const u = this.user();
    if (!u) return null;
    return {
      ...u,
      id: u._id,
    };
  });

  /**
   * Reactive signal indicating if the user is currently authenticated.
   * Derived from Better Auth session state.
   */
  readonly isAuthenticated = computed(() => this.session() !== null);

  /** Authenticated user's email, preferring the synced app user record over the session snapshot. */
  readonly email = computed(
    () => this.user()?.email ?? this.session()?.user?.email ?? null,
  );

  /**
   * Computed user role based on permission flags.
   * @returns 'root_admin' | 'community_admin' | 'user'
   */
  readonly userRole = computed(() => {
    const u = this.user();
    if (u?.isRootAdmin) return 'root_admin';
    if ((u?.communityAdminOrganizerIds?.length ?? 0) > 0)
      return 'community_admin';
    return 'user';
  });

  private readonly scannerStaffQuery = injectQuery(
    api.communities.scanners.hasAnyAssignment,
    () => (this.isAuthenticated() && !!this.user() ? {} : skipToken),
  );

  /** Whether the scanner staff query is still loading. */
  readonly isScannerStaffLoading = computed(() =>
    this.scannerStaffQuery.isLoading(),
  );

  /** Whether the current user has the community admin role. */
  readonly isCommunityAdmin = computed(() => {
    const u = this.user();
    return (u?.communityAdminOrganizerIds?.length ?? 0) > 0;
  });

  /** Whether the current user has any community scanner assignments. */
  readonly isScannerStaff = computed(() => {
    if (!this.isAuthenticated()) return false;
    return this.scannerStaffQuery.data() ?? false;
  });

  constructor() {
    this.installConvexErrorHandling();

    // Initialize session on service creation
    void this.initSession();

    // Set up cross-tab session synchronization
    this.sessionSync = new AuthSessionSync({
      onLogin: () => {
        void this.refreshSessionFromStorage();
      },
      onLogout: () => {
        this.clearLocalAuthState({broadcast: false});
        void this.router.navigate(['/'], {replaceUrl: true});
      },
    });

    this.destroyRef.onDestroy(() => {
      this.sessionSync?.disconnect();
    });
  }

  /**
   * Synchronously peeks at the persisted Better Auth crossDomain state so route
   * guards can decide the common cases without awaiting the async
   * `getSession()` round-trip.
   *
   * Reads through the crossDomain plugin's own client actions —
   * `getCookie()` (serialized non-expired cookies, `''` when none is usable)
   * and `getSessionData()` (the cached `/get-session` snapshot, `null` for
   * `{}`/corrupt) — so the peek can never disagree with what the plugin would
   * actually send on a request. `getCookie() !== ''` mirrors the plugin's own
   * expiry filter, so an all-expired credential provably reads as logged out.
   *
   * Only meaningful in crossDomain mode. In cookie/E2E mode the credential is
   * an httpOnly cookie invisible to JS, the crossDomain plugin is not
   * registered, and its actions are absent — this returns `known: false` and
   * callers must fall back to the authoritative async settle. The
   * `isE2E || !hasLocalStorage()` guard mirrors the plugin registration
   * condition in `auth.client.ts`; the action-presence check below is a
   * defensive backstop against those two conditions drifting apart.
   *
   * This drives routing UX only — never authorization. Every Convex call is
   * still authorized server-side, so a forged snapshot buys nothing but a
   * dashboard shell whose queries fail.
   */
  peekCachedSession(): CachedSessionPeek {
    if (environment.isE2E || !this.browser.hasLocalStorage()) {
      return {known: false, hasCredential: false, session: null};
    }

    const client = this.authClient;
    if (
      typeof client.getCookie !== 'function' ||
      typeof client.getSessionData !== 'function'
    ) {
      return {known: false, hasCredential: false, session: null};
    }

    return {
      known: true,
      hasCredential: client.getCookie() !== '',
      session: narrowCachedSession(client.getSessionData()),
    };
  }

  /**
   * `authSettled` as an observable, created eagerly in the field initializer
   * so `scheduleOptimisticReconciliation` never depends on the caller's
   * injection context.
   */
  private readonly authSettled$ = toObservable(this.authSettled);
  private optimisticReconciliationScheduled = false;

  /**
   * Called by a route guard that admitted a navigation optimistically (cached
   * credential present, auth not yet settled). When the authoritative session
   * settles, checks whether the optimistic guess was right; if not, re-runs
   * the current URL's guards via a same-URL navigation (`onSameUrlNavigation:
   * 'reload'` is configured app-wide) so the normal guard logic issues the
   * correct redirect — login, landing, or social-signup completion — without
   * duplicating any of it here.
   *
   * Idempotent per settle window: canMatch and canActivate both firing
   * optimistically in one navigation schedule a single reconciliation.
   *
   * Bounded by `AUTH_SETTLE_TIMEOUT_MS` (parity with `waitForAuthSettled$`): if
   * auth never settles — init hung, or a session was reported but its profile
   * query never resolved — we must not strand the user on the optimistic
   * page's skeleton (the pages gate on `authSettled`). On timeout we latch
   * `authSettleTimedOut`, which forces `authSettled` true, then re-run the
   * guards: they leave the optimistic path and take their authoritative failure
   * branch (login when unauthenticated, public home when authenticated without a
   * profile) — the same recovery the non-optimistic guards gave before this
   * feature.
   */
  scheduleOptimisticReconciliation(): void {
    if (this.optimisticReconciliationScheduled) {
      return;
    }
    this.optimisticReconciliationScheduled = true;

    void firstValueFrom(
      this.authSettled$.pipe(
        filter(Boolean),
        timeout({first: AUTH_SETTLE_TIMEOUT_MS}),
      ),
    )
      .then(() => {
        const user = this.user();
        const guessWasCorrect =
          this.isAuthenticated() &&
          !!user &&
          !requiresSocialSignupCompletion(user);
        if (guessWasCorrect) {
          return;
        }

        if (!this.isAuthenticated()) {
          logger.info(
            '[AuthService] Optimistic session was stale; re-running route guards',
          );
          this.toast.error('session expired. please log in again.');
        }

        // Re-run the current URL's guards; replaceUrl keeps the stale optimistic
        // entry out of history so Back does not re-trigger the optimistic cycle.
        return this.router.navigateByUrl(this.router.url, {replaceUrl: true});
      })
      .catch((err: unknown) => {
        if (!(err instanceof TimeoutError)) {
          logger.error('[AuthService] Optimistic reconciliation failed', err);
          return;
        }

        // Auth never reached a decidable state. Latch the give-up so the guards
        // stop admitting optimistically, then re-run them: authSettled is now
        // true, so they take the authoritative failure branch instead of
        // leaving the user on an indefinite skeleton.
        logger.warn(
          '[AuthService] Auth did not settle within the budget; recovering off the optimistic route',
        );
        this.authSettleTimedOut.set(true);
        this.toast.error('could not confirm your session. please try again.');
        return this.router.navigateByUrl(this.router.url, {replaceUrl: true});
      })
      .finally(() => {
        this.optimisticReconciliationScheduled = false;
      });
  }

  private installConvexErrorHandling(): void {
    const convex = this.convex as ConvexClientWithErrorHandling;
    if (convex.__braketAuthWrapped) {
      return;
    }

    const originalQuery = convex.query as ConvexQueryMethod;
    convex.query = (async <Query extends FunctionReference<'query'>>(
      query: Query,
      args: Query['_args'],
    ): Promise<Awaited<Query['_returnType']>> => {
      try {
        return await originalQuery.call(convex, query, args);
      } catch (err) {
        this.handleFatalConvexAuthError(err);
        throw err;
      }
    }) as typeof convex.query;

    const originalMutation = convex.mutation as ConvexMutationMethod;
    convex.mutation = (async <Mutation extends FunctionReference<'mutation'>>(
      mutation: Mutation,
      args: FunctionArgs<Mutation>,
      options?: MutationOptions,
    ): Promise<Awaited<FunctionReturnType<Mutation>>> => {
      try {
        return await originalMutation.call(convex, mutation, args, options);
      } catch (err) {
        this.handleFatalConvexAuthError(err);
        throw err;
      }
    }) as typeof convex.mutation;

    const originalAction = convex.action as ConvexActionMethod;
    convex.action = (async <Action extends FunctionReference<'action'>>(
      action: Action,
      args: FunctionArgs<Action>,
    ): Promise<Awaited<FunctionReturnType<Action>>> => {
      try {
        return await originalAction.call(convex, action, args);
      } catch (err) {
        this.handleFatalConvexAuthError(err);
        throw err;
      }
    }) as typeof convex.action;

    const originalOnUpdate = convex.onUpdate.bind(convex);
    convex.onUpdate = ((query, args, onResult, onError) =>
      originalOnUpdate(query, args, onResult, (err) => {
        this.handleFatalConvexAuthError(err);
        onError?.(err);
      })) as typeof convex.onUpdate;

    const originalOnPaginatedUpdate =
      convex.onPaginatedUpdate_experimental.bind(convex);
    convex.onPaginatedUpdate_experimental = ((
      query,
      args,
      options,
      onResult,
      onError,
    ) =>
      originalOnPaginatedUpdate(query, args, options, onResult, (err) => {
        this.handleFatalConvexAuthError(err);
        onError?.(err);
      })) as typeof convex.onPaginatedUpdate_experimental;

    Object.defineProperty(convex, '__braketAuthWrapped', {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  }

  private triggerRecoveryReload(reason: string, details?: unknown): never {
    logger.error(`[AuthService] Recovery reload triggered: ${reason}`, details);
    this.setSessionState(null);
    this.error.set(undefined);
    this.browser.reload();
    throw new Error(reason);
  }

  private setSessionState(session: BetterAuthSession | null): void {
    this.sessionStateVersion += 1;
    this.session.set(session);
    // A fresh session transition is new information: drop any prior give-up
    // latch so guards wait for this session's own profile query (or an explicit
    // sync failure) instead of inheriting a stale timeout decision.
    this.authSettleTimedOut.set(false);
    if (!session) {
      this.missingUserRepairSessionKey = null;
      this.missingUserRepairQueuedSessionKey = null;
      this.missingUserRepairInFlightSessionKey = null;
    }
  }

  private handleFatalConvexAuthError(err: unknown): void {
    const message = extractErrorMessage(err);
    const isFatalAuthError =
      message.includes('Could not verify OIDC token claim') ||
      message.includes('JWT signature is invalid') ||
      message.includes('JWT has expired');

    if (!isFatalAuthError) {
      return;
    }

    this.triggerRecoveryReload('Fatal OIDC/JWT error detected', err);
  }

  private notifyConvexAuthChanged(): void {
    this.error.set(undefined);
    this.reauthVersion.update((version) => version + 1);
  }

  private scheduleMissingUserRepair(session: BetterAuthSession): void {
    const sessionKey = this.getMissingUserRepairSessionKey(session);
    if (
      this.missingUserRepairSessionKey === sessionKey ||
      this.missingUserRepairQueuedSessionKey === sessionKey ||
      this.missingUserRepairInFlightSessionKey === sessionKey
    ) {
      return;
    }

    this.missingUserRepairQueuedSessionKey = sessionKey;
    this.missingUserRepairInFlightSessionKey = sessionKey;
    void this.repairMissingUserForSession(sessionKey)
      .catch((err) => {
        logger.warn(
          '[AuthService] Failed to repair missing app user for active session',
          err,
        );
      })
      .finally(() => {
        if (this.missingUserRepairQueuedSessionKey === sessionKey) {
          this.missingUserRepairQueuedSessionKey = null;
        }
        if (this.missingUserRepairInFlightSessionKey === sessionKey) {
          this.missingUserRepairInFlightSessionKey = null;
        }
      });
  }

  private async repairMissingUserForSession(sessionKey: string): Promise<void> {
    let waitMs = 0;

    for (;;) {
      const repairDecision = this.getMissingUserRepairDecision(sessionKey);
      if (repairDecision === 'skip') {
        return;
      }
      if (repairDecision === 'repair') {
        this.missingUserRepairSessionKey = sessionKey;
        await this.syncUserToApp({markAuthSyncFailedOnError: false});
        return;
      }

      waitMs = waitMs === 0 ? 50 : Math.min(waitMs * 2, 1000);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private getMissingUserRepairDecision(
    sessionKey: string,
  ): 'pending' | 'repair' | 'skip' {
    const session = this.session();
    if (
      !session ||
      this.getMissingUserRepairSessionKey(session) !== sessionKey
    ) {
      return 'skip';
    }

    if (
      !this.authInitialized() ||
      this.userQuery.isLoading() ||
      this.isSyncingUser()
    ) {
      return 'pending';
    }

    if (this.authSyncFailed()) {
      return 'skip';
    }

    const currentUser = this.userQuery.data();
    if (currentUser === undefined) {
      return 'pending';
    }

    if (
      currentUser !== null ||
      this.missingUserRepairSessionKey === sessionKey
    ) {
      return 'skip';
    }

    return 'repair';
  }

  private getMissingUserRepairSessionKey(session: BetterAuthSession): string {
    return session.session?.id ?? session.user.email;
  }

  async fetchAccessToken(args: {
    forceRefreshToken: boolean;
  }): Promise<string | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    try {
      if (args.forceRefreshToken) {
        // Stateless contract: we do not memoize access tokens in this service.
        // Convex may request a forced refresh, but that is just a signal to fetch
        // a fresh Better Auth token on demand.
        logger.debug(
          '[AuthService] forceRefreshToken requested; fetching a fresh Better Auth Convex token',
        );
      }

      const retryDelaysMs = [0, 250, 750, 1500, 3000] as const;
      const token = await retryWithDelays({
        delaysMs: retryDelaysMs,
        run: async () => {
          const {data, error} = await this.authClient.convex.token();
          if (error) {
            throw error instanceof Error
              ? error
              : new Error(error.message || 'Failed to retrieve Convex token');
          }
          return data?.token ?? null;
        },
        shouldRetry: (err, attemptIndex) => {
          const shouldRetry =
            isRetryableAuthBackendError(err) &&
            attemptIndex < retryDelaysMs.length - 1;
          if (shouldRetry) {
            logger.warn(
              `[AuthService] Token fetch attempt ${attemptIndex + 1}/${retryDelaysMs.length} failed; retrying`,
              err,
            );
          }
          return shouldRetry;
        },
      });
      this.error.set(undefined);
      return token;
    } catch (err) {
      const authError =
        err instanceof Error
          ? err
          : new Error(extractErrorMessage(err) || 'Token fetch failed');
      this.error.set(authError);
      logger.error('Exception fetching Convex token from Better Auth:', err);
      this.handleFatalConvexAuthError(authError);
      return null;
    }
  }

  /**
   * Refreshes session state from Better Auth (used for cross-tab login sync).
   */
  private async refreshSessionFromStorage(): Promise<void> {
    try {
      const session = await this.loadSessionAfterAuth('cross-tab login', [
        0, 100, 250, 500, 1000, 2000, 4000,
      ] as const);
      this.setSessionState(session);
      this.notifyConvexAuthChanged();
      this.scheduleMissingUserRepair(session);
    } catch (err) {
      logger.warn('[AuthService] Failed to refresh session from storage:', err);
    }
  }

  async refreshSessionFromServer(
    options: {syncUser?: boolean} = {},
  ): Promise<void> {
    const {syncUser = true} = options;
    const {data, error} = await this.authClient.getSession();
    if (error) {
      throw new Error(error.message || 'Failed to refresh session');
    }

    this.setSessionState(data);
    if (!data) {
      this.authSyncFailed.set(false);
      return;
    }

    this.notifyConvexAuthChanged();
    if (syncUser) {
      await this.syncUserToApp();
      return;
    }

    this.scheduleMissingUserRepair(data);
  }

  private async handleBlockedSocialAuth(
    reason: 'provider_email_missing' | 'provider_email_unverified',
  ): Promise<never> {
    this.clearLocalAuthState({broadcast: false});
    await this.signOutRemotely();
    throw new SocialAuthBlockedError(reason);
  }

  /**
   * Initializes the session by fetching current Better Auth session.
   * Updates the session signal which triggers authentication state.
   */
  private async initSession() {
    const retryDelaysMs = [0, 500, 1000, 2000, 4000] as const;
    const initSessionVersion = this.sessionStateVersion;
    try {
      await retryWithDelays({
        delaysMs: retryDelaysMs,
        run: async () => {
          logger.info('[initSession] Starting session initialization');
          const {data} = await this.authClient.getSession();
          logger.info(
            '[initSession] getSession returned:',
            data ? 'session found' : 'no session',
          );
          if (this.sessionStateVersion !== initSessionVersion) {
            logger.info(
              '[initSession] Ignoring stale session initialization result',
            );
            this.authInitialized.set(true);
            return;
          }

          if (data) {
            this.setSessionState(data);
          } else {
            this.setSessionState(null);
          }

          if (data) {
            this.notifyConvexAuthChanged();
          }
          logger.info('[initSession] Initialization complete');
          this.authInitialized.set(true);
          if (data) {
            this.scheduleMissingUserRepair(data);
          }
        },
        shouldRetry: (err, attemptIndex) => {
          const isNetworkError =
            err instanceof TypeError && err.message.includes('fetch');
          const shouldRetry =
            isNetworkError && attemptIndex < retryDelaysMs.length - 1;
          if (shouldRetry) {
            logger.warn(
              `[initSession] Network error on attempt ${attemptIndex + 1}/${retryDelaysMs.length}, retrying...`,
            );
          }
          return shouldRetry;
        },
      });
    } catch (err) {
      logger.error('Failed to initialize session', err);
      if (!this.session()) {
        this.setSessionState(null);
        this.authSyncFailed.set(false);
      }
      this.authInitialized.set(true);
    }
  }

  /**
   * Authenticates user with email and password.
   * On success, navigates to `returnUrl` if provided, otherwise to the home page.
   *
   * @param email - User's email address
   * @param pass - User's password
   * @param returnUrl - Optional URL to redirect to after login
   * @throws {UnverifiedEmailError} If account exists but email is not verified
   * @throws {Error} If credentials are invalid
   */
  async loginWithPassword(email: string, pass: string, returnUrl?: string) {
    try {
      const destination = sanitizeInternalReturnUrl(returnUrl);
      // Pass an absolute callbackURL to prevent the crossDomain server plugin
      // from rewriting it to the deployed SITE_URL. Without this, the plugin rewrites
      // undefined/relative callbackURL to the Convex deployment's SITE_URL (e.g.,
      // https://dev.community.braket.gay), causing a redirect away from localhost during
      // local development. Absolute URLs are not rewritten by the crossDomain plugin.
      // When a returnUrl is provided, use it so that any server-side redirect respects the
      // original destination instead of always landing on /.
      const {error} = await this.authClient.signIn.email({
        email,
        password: pass,
        callbackURL: this.browser.absoluteUrl(destination),
      });

      if (error) {
        // Check if this is an email verification error
        if (isVerificationRequiredError(error)) {
          throw new UnverifiedEmailError(email);
        }
        throw new Error('Invalid email or password');
      }

      const session = await this.loadSessionAfterAuth('password sign-in');

      this.setSessionState(session);

      // Configure Convex client with Better Auth token
      this.notifyConvexAuthChanged();
      this.scheduleMissingUserRepair(session);
      // Notify other tabs about login
      this.broadcastSessionChange('LOGIN');

      await this.router.navigateByUrl(destination);
    } catch (err) {
      if (err instanceof UnverifiedEmailError) {
        throw err;
      }
      // Only log actual errors, not email verification which is expected behavior
      if (!isVerificationRequiredError(err)) {
        logger.error('Login failed', err);
      }
      throw err;
    }
  }

  /**
   * Registers a new user account with email/password.
   * Sends verification email and redirects to login page on success.
   *
   * @param email - User's email address
   * @param pass - Chosen password
   * @param passConfirm - Password confirmation (must match pass)
   * @param name - User's display name
   * @throws {Error} If passwords don't match
   * @param returnUrl - Optional URL to preserve through email verification and login
   * Duplicate-email and verification-required responses intentionally navigate
   * to the neutral registration-success state to avoid email enumeration.
   * @throws {Error} If registration fails for any other reason
   */
  async signup(
    email: string,
    pass: string,
    passConfirm: string,
    name: string,
    returnUrl?: string,
  ) {
    if (pass !== passConfirm) {
      throw new Error('Passwords do not match');
    }

    const destination = sanitizeInternalReturnUrl(returnUrl);
    const registeredQueryParams =
      destination === '/'
        ? {registered: 'true'}
        : {registered: 'true', returnUrl: destination};

    // Destructure directly from the auth client call so TypeScript infers the
    // return type from the SDK (BetterFetchResponse<Data, Error>).  No hand-
    // maintained interface needed — the contract stays locked to the SDK.
    //
    // No throws inside the try block — the catch only handles errors thrown
    // by the auth client itself.  Failures from the returned-error path are
    // captured in `registrationError` and thrown after the catch, avoiding a
    // fragile string-match re-throw.
    let registrationError: Error | null = null;
    try {
      const {data, error} = await this.authClient.signUp.email({
        email,
        password: pass,
        name,
        callbackURL: buildAuthCallbackUrl(
          '/confirm/verification',
          {returnUrl: destination === '/' ? undefined : destination},
          this.browser.absoluteUrl('/'),
        ),
      });

      if (error) {
        // Check if this is an email verification error
        if (isVerificationRequiredError(error)) {
          await this.router.navigate(['/login'], {
            queryParams: registeredQueryParams,
          });
          return;
        }

        // Check for existing account errors — treat silently to prevent email enumeration.
        // Navigate to the same success destination instead of throwing so the response
        // is indistinguishable from a successful new-account registration.
        if (isDuplicateSignupError(error)) {
          await this.router.navigate(['/login'], {
            queryParams: registeredQueryParams,
          });
          return;
        }

        logger.error('Signup failed', error);
        registrationError = new Error('Registration failed', {cause: error});
      } else {
        // If signup returned session data and user is verified, sync to app
        // With requireEmailVerification: true, user won't be verified yet
        if (data?.user.emailVerified) {
          try {
            const session = await this.loadSessionAfterAuth('post-signup');
            this.setSessionState(session);
            this.notifyConvexAuthChanged();
            this.scheduleMissingUserRepair(session);
          } catch (syncErr) {
            logger.warn('Post-signup session refresh failed:', syncErr);
          }
        } else {
          // User not verified - Better Auth's sendOnSignUp handles verification email automatically
          logger.info(
            '[signup] User not verified, verification email sent by Better Auth sendOnSignUp',
          );
        }

        // Navigate to login with success message - signup was successful
        await this.router.navigate(['/login'], {
          queryParams: registeredQueryParams,
        });
      }
    } catch (err) {
      // Handle errors thrown by the auth client itself (network errors, etc.)
      if (isVerificationRequiredError(err)) {
        await this.router.navigate(['/login'], {
          queryParams: registeredQueryParams,
        });
        return;
      }

      if (isDuplicateSignupError(err)) {
        await this.router.navigate(['/login'], {
          queryParams: registeredQueryParams,
        });
        return;
      }

      logger.error('Signup failed', err);
      registrationError = new Error('Registration failed', {cause: err});
    }

    if (registrationError) {
      throw registrationError;
    }
  }

  async loginWithSocial(
    provider: SocialProvider,
    returnUrl?: string,
  ): Promise<void> {
    const destination = sanitizeInternalReturnUrl(returnUrl);

    await this.authClient.signIn.social({
      provider,
      callbackURL: buildAuthCallbackUrl(
        '/confirm/social-signin',
        {returnUrl: destination},
        this.browser.absoluteUrl('/'),
      ),
    });
  }

  /**
   * Signs out the current user and navigates to the landing page.
   * Also broadcasts logout to other tabs for session synchronization.
   */
  logout(): void {
    logger.info('[logout] Starting logout...');
    // Clear local state first so zoneless UI reacts immediately.
    this.clearLocalAuthState();

    // Fire-and-forget remote signout so slow/invalid sessions can't block UI.
    void this.signOutRemotely();

    void this.router
      .navigate(['/'], {replaceUrl: true})
      .then(() => {
        logger.info('[logout] Logged out, navigated to home');
      })
      .catch((err) => {
        logger.warn('[logout] Failed to navigate after logout:', err);
      });
  }

  /**
   * Broadcasts a session change event to other tabs.
   * @param type - 'LOGIN' or 'LOGOUT'
   */
  private broadcastSessionChange(type: SessionChannelMessage['type']): void {
    this.sessionSync?.broadcast(type);
  }

  private clearLocalAuthState(options: {broadcast?: boolean} = {}): void {
    const {broadcast = true} = options;

    this.setSessionState(null);
    this.authSyncFailed.set(false);
    // Let convex-angular auth sync clear the Convex token when `isAuthenticated` becomes false.
    // This keeps this service provider-agnostic and compatible with Convex auth wiring.
    logger.debug('[logout] Local auth state cleared');

    if (broadcast) {
      this.broadcastSessionChange('LOGOUT');
    }
  }

  private async signOutRemotely(): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        this.authClient.signOut(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Remote signout timed out')),
            5000,
          );
        }),
      ]);
      logger.debug('[logout] Better Auth signOut complete');
    } catch (err) {
      logger.warn('[logout] Error during signOut (continuing anyway):', err);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private redirectToExternalUrl(url: string): void {
    this.browser.assign(url);
  }

  /**
   * Verifies user's email address using the token from verification email.
   * On success, updates the session state.
   *
   * Lives here (not PasswordService) because it writes to private session
   * signal and triggers Convex auth re-sync.
   */
  async confirmVerification(token: string): Promise<void> {
    const {error} = await this.authClient.verifyEmail({
      query: {token},
    });

    if (error) {
      logger.error('Email verification failed:', error);
      const message = error.message || '';
      if (
        message.toLowerCase().includes('expired') ||
        message.toLowerCase().includes('invalid')
      ) {
        throw new Error(
          'Verification link has expired. Please request a new one.',
        );
      }
      throw new Error(error.message || 'Failed to verify email');
    }

    logger.info('Email verified successfully');

    const session = await this.loadSessionAfterAuth('email verification');
    this.setSessionState(session);
    this.notifyConvexAuthChanged();
    // Critical: do not swallow a failed sync here. The rest of the app (route guards)
    // depends on `auth.user()` becoming non-null after verification. If we "succeed"
    // without syncing, navigation to / can deadlock indefinitely.
    await this.syncUserToApp();
  }

  // --- Delegates to PasswordService (logic extracted, API preserved) ---

  requestPasswordReset(email: string): Promise<void> {
    return this.passwordService.requestPasswordReset(email);
  }

  confirmPasswordReset(
    token: string,
    password: string,
    confirmPassword: string,
    emailArg?: string,
  ): Promise<void> {
    return this.passwordService.confirmPasswordReset(
      token,
      password,
      confirmPassword,
      emailArg,
    );
  }

  updatePassword(
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<void> {
    return this.passwordService.updatePassword(
      oldPassword,
      newPassword,
      confirmPassword,
    );
  }

  requestVerificationEmail(email: string): Promise<void> {
    return this.passwordService.requestVerificationEmail(email);
  }

  // --- Delegates to UserProfileService (logic extracted, API preserved) ---

  getExternalAuths(): Promise<ExternalAuth[]> {
    return this.userProfileService.getExternalAuths();
  }

  async linkSocial(provider: SocialProvider): Promise<void> {
    const result = await this.convex.mutation(
      api.auth.public.linkSocialAccount,
      {
        provider,
        callbackURL: buildAuthCallbackUrl(
          '/confirm/social-link',
          {provider},
          this.browser.absoluteUrl('/'),
        ),
      },
    );
    this.redirectToExternalUrl(result.url);
  }

  async unlinkAccount(
    provider: SocialProvider,
    accountId?: string,
  ): Promise<void> {
    await this.convex.mutation(api.auth.public.unlinkSocialAccount, {
      provider,
      accountId,
    });
  }

  async setPassword(password: string, confirmPassword: string): Promise<void> {
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    await this.convex.mutation(api.auth.public.setPassword, {
      newPassword: password,
    });
  }

  async completeSocialSignupOnboarding(): Promise<void> {
    await this.convex.mutation(
      api.auth.public.completeSocialSignupOnboarding,
      {},
    );
  }

  updateProfile(profile: {name?: string}): Promise<void> {
    return this.userProfileService.updateProfile(profile);
  }

  requestEmailChange(newEmail: string): Promise<void> {
    return this.userProfileService.requestEmailChange(newEmail);
  }

  cancelEmailChange(): Promise<void> {
    return this.userProfileService.cancelEmailChange();
  }

  getFileUrl(record: unknown, filename: string, options?: unknown): string {
    return this.userProfileService.getFileUrl(record, filename, options);
  }

  /**
   * Handles the OAuth callback with one-time token (OTT) from crossDomain plugin.
   * Makes a request through the authClient to verify the OTT, allowing the
   * crossDomainClient plugin's hooks to intercept and store the session.
   *
   * @param ott - One-time token from the OAuth callback
   * @throws {Error} If token is invalid or account already exists with different auth method
   */
  async handleOAuthCallback(
    ott: string,
    options: {navigateOnSuccess?: boolean; syncUserToApp?: boolean} = {},
  ): Promise<SocialAuthCompletionState> {
    try {
      const navigateOnSuccess = options.navigateOnSuccess ?? true;
      const shouldSyncUserToApp = options.syncUserToApp ?? true;
      let completionState: SocialAuthCompletionState = {
        requiresSocialSignupCompletion: false,
      };

      // Use the authClient's $fetch to call the OTT verification endpoint
      // This ensures the crossDomainClient plugin's hooks can intercept the response
      // Note: Better Auth client automatically prepends /api/auth to all paths
      await this.authClient.$fetch('/cross-domain/one-time-token/verify', {
        method: 'POST',
        body: {token: ott},
      });

      // Give the plugin a moment to process and store the session
      const session = await this.loadSessionAfterAuth('OAuth callback');

      if (session) {
        this.setSessionState(session);
        this.notifyConvexAuthChanged();

        if (shouldSyncUserToApp) {
          completionState = await this.syncUserToApp();
        }

        // Notify other tabs about login
        this.broadcastSessionChange('LOGIN');

        if (navigateOnSuccess) {
          await this.router.navigate(['/']);
        }
        return completionState;
      } else {
        throw new Error('No session data available after OTT processing');
      }
    } catch (err: unknown) {
      logger.error('OAuth callback handling failed', err);
      const message = extractErrorMessage(err);
      if (err instanceof SocialAuthBlockedError) {
        throw err;
      }
      if (
        message.includes('Account with this email already exists') ||
        message.includes('via Discord') ||
        message.includes('already linked')
      ) {
        throw new Error('This sign-in could not be completed.', {cause: err});
      }
      throw err;
    }
  }

  /**
   * Legacy method for manual user refresh.
   * With Convex subscriptions, user data auto-refreshes, so this is a no-op.
   *
   * @returns null (kept for API compatibility)
   * @deprecated User data refreshes automatically via Convex subscriptions
   */
  refreshUser(): Promise<null> {
    // Convex queries auto-refresh via subscriptions
    return Promise.resolve(null);
  }

  /**
   * Explicit sync path for auth callback and verification flows that need the
   * backend's resolved onboarding state immediately. Routine user materialization
   * is owned by Better Auth backend triggers.
   */
  private async syncUserToApp(
    options: {markAuthSyncFailedOnError?: boolean} = {},
  ): Promise<SocialAuthCompletionState> {
    const {markAuthSyncFailedOnError = true} = options;
    this.isSyncingUser.set(true);
    this.authSyncFailed.set(false);
    try {
      // Retries are fallback-only. In CI/E2E, Better Auth session propagation + Convex auth
      // acceptance can lag; give the sync mutation a bounded retry window before failing.
      const retryDelaysMs = [0, 100, 250, 500, 1000, 2000, 4000] as const;
      let completionState: SocialAuthCompletionState = {
        requiresSocialSignupCompletion: false,
      };
      await retryWithDelays({
        delaysMs: retryDelaysMs,
        run: async () => {
          const freshToken = await this.fetchAccessToken({
            forceRefreshToken: true,
          });
          if (!freshToken) {
            throw new SessionNotReadyError('Convex auth');
          }

          const result = await this.convex.mutation(
            api.auth.public.syncCurrentUser,
            {},
          );
          if (result.status === 'blocked' && result.reason) {
            await this.handleBlockedSocialAuth(result.reason);
          }
          completionState = {
            requiresSocialSignupCompletion:
              result.requiresSocialSignupCompletion === true,
          };
        },
        shouldRetry: (err, attemptIndex) => {
          const shouldRetry =
            (err instanceof SessionNotReadyError ||
              isRetryableAuthBackendError(err) ||
              extractErrorMessage(err)
                .toLowerCase()
                .includes('unauthenticated')) &&
            attemptIndex < retryDelaysMs.length - 1;
          if (shouldRetry) {
            logger.warn(
              `[syncUserToApp] Attempt ${attemptIndex + 1}/${retryDelaysMs.length} failed; retrying`,
              err,
            );
          }
          return shouldRetry;
        },
      });
      this.authSyncFailed.set(false);
      return completionState;
    } catch (err) {
      logger.error('Failed to sync user to app database', err);
      if (
        markAuthSyncFailedOnError &&
        this.isAuthenticated() &&
        this.session()
      ) {
        this.authSyncFailed.set(true);
      }
      throw err;
    } finally {
      this.isSyncingUser.set(false);
    }
  }

  private async loadSessionAfterAuth(
    context: string,
    retryDelaysMs: readonly number[] = [
      0, 100, 250, 500, 1000, 2000, 4000,
    ] as const,
  ): Promise<BetterAuthSession> {
    return retryWithDelays({
      delaysMs: retryDelaysMs,
      run: async () => {
        const {data, error} = await this.authClient.getSession();
        if (error) {
          throw error instanceof Error
            ? error
            : new Error(
                error.message || `Failed to establish session after ${context}`,
              );
        }

        if (!data) {
          throw new SessionNotReadyError(context);
        }

        return data;
      },
      shouldRetry: (err, attemptIndex) => {
        const shouldRetry =
          (err instanceof SessionNotReadyError ||
            isRetryableAuthBackendError(err)) &&
          attemptIndex < retryDelaysMs.length - 1;
        if (shouldRetry) {
          logger.debug(
            `[AuthService] Waiting for Better Auth session after ${context} (attempt ${attemptIndex + 1}/${retryDelaysMs.length})`,
            err,
          );
        }
        return shouldRetry;
      },
    });
  }
}
