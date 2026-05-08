import {
  type CanActivateFn,
  type CanMatchFn,
  Router,
  type RouterStateSnapshot,
} from '@angular/router';
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, of, type Observable } from 'rxjs';
import { catchError, filter, map, take, timeout } from 'rxjs/operators';
import { AuthService } from '@/core/services/auth.service';
import type { BraToastService } from '@ui/components/composites/toast/toast.service';
import { logger } from '@/utils/logger';

/**
 * Hard upper bound for the auth-settled race. If `authInitialized` never
 * fires (Convex WebSocket died mid-handshake, browser went offline during
 * cold load, etc.) the guard would otherwise hang the route forever with no
 * error UI. We surface a TimeoutError instead so `catchError` branches in
 * each guard can redirect sensibly. 15s is comfortably above the normal
 * cold-connect budget for Convex + Better Auth + user profile sync.
 */
export const AUTH_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Minimal shape every guard needs from the authenticated user. Kept loose so
 * individual callers can read other fields without a new cast.
 */
type SettledUser = { socialSignupCompletionRequired?: boolean; _id?: string } | null | undefined;

export function requiresSocialSignupCompletion(user: SettledUser): boolean {
  return user?.socialSignupCompletionRequired === true;
}

export function createSocialSignupCompletionUrlTree(
  router: Router,
  state: RouterStateSnapshot,
) {
  return router.createUrlTree(['/confirm/social-signup-complete'], {
    queryParams: { returnUrl: state.url },
  });
}

export function createAccessDeniedRedirect(router: Router, toast: BraToastService) {
  toast.error('Access denied');
  return router.createUrlTree(['/']);
}

/**
 * Waits for auth to reach a decidable state: initialized, and either
 * unauthenticated or user-synced (or sync explicitly gave up). Emits once,
 * then completes. Centralized so every role guard settles on the same rules
 * instead of hand-rolling the combineLatest pipeline.
 *
 * Throws `TimeoutError` after `AUTH_SETTLE_TIMEOUT_MS` if the auth stream
 * never reaches a decidable state — callers handle this in `catchError`.
 */
export function waitForAuthSettled$(auth: AuthService): Observable<SettledUser> {
  return combineLatest([
    toObservable(auth.authInitialized),
    toObservable(auth.user),
    toObservable(auth.authSyncFailed),
  ]).pipe(
    filter(([initialized, user, syncFailed]) => {
      if (!initialized) return false;
      if (!auth.isAuthenticated()) return true;
      if (user) return true;
      return syncFailed;
    }),
    take(1),
    timeout({ first: AUTH_SETTLE_TIMEOUT_MS }),
    map(([, user]) => user as SettledUser),
  );
}

/**
 * Auth guard that waits for both auth initialization and the current-user query
 * to settle before deciding whether to redirect.
 *
 * Tri-state decision:
 *   - unauthenticated         → redirect to /login with returnUrl
 *   - authenticated + profile → allow (check social-signup gate first)
 *   - authenticated + no      → fail closed to public home. `waitForAuthSettled$`
 *     profile (sync failed)     emits here when `authSyncFailed` fires while
 *                               the session is still authenticated. The route
 *                               cannot enforce protected-page profile policy
 *                               without a user document, so do not allow it.
 */
export const authGuard: CanActivateFn = (route, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const redirectToLogin = () =>
    router.createUrlTree(['/login'], {
      queryParams: { ...route.queryParams, returnUrl: state.url },
    });
  const redirectToPublicHome = () => router.createUrlTree(['/']);

  return waitForAuthSettled$(auth).pipe(
    map((user) => {
      if (!auth.isAuthenticated()) return redirectToLogin();
      if (requiresSocialSignupCompletion(user)) {
        return createSocialSignupCompletionUrlTree(router, state);
      }
      if (!user) {
        // authenticated + sync-failed: the session is live, but protected
        // routes cannot safely render without the user profile.
        logger.warn('[AuthGuard] authenticated session with no user profile (sync failed)');
        return redirectToPublicHome();
      }
      return true;
    }),
    catchError((err) => {
      logger.error('[AuthGuard] Error during auth check', err);
      return of(redirectToLogin());
    }),
  );
};

/**
 * canMatch guard that routes authenticated users to the dashboard view
 * and falls through to the landing page for unauthenticated users.
 * Waits for auth initialization to avoid flashing the wrong component;
 * falls through to `false` on timeout or any downstream error so the
 * landing page still renders when auth is unreachable.
 */
export const authenticatedMatch: CanMatchFn = () => {
  const auth = inject(AuthService);

  return waitForAuthSettled$(auth).pipe(
    map((user) => auth.isAuthenticated() && !!user),
    catchError((err) => {
      logger.error('[authenticatedMatch] Error waiting for auth', err);
      return of(false);
    }),
  );
};
