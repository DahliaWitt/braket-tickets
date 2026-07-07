import {
  type CanActivateFn,
  type CanMatchFn,
  Router,
  type RouterStateSnapshot,
} from '@angular/router';
import {inject} from '@angular/core';
import {toObservable} from '@angular/core/rxjs-interop';
import {of, type Observable} from 'rxjs';
import {catchError, filter, map, take, timeout} from 'rxjs/operators';
import {AuthService} from '@/core/services/auth.service';
import {
  AUTH_SETTLE_TIMEOUT_MS,
  requiresSocialSignupCompletion,
  type SettledUser,
} from '@/core/services/auth.service.helpers';
import type {BraToastService} from '@ui/components/composites/toast/toast.service';
import {logger} from '@/utils/logger';

// Re-exported for the admin/scanner route guards that import these from here.
export {
  AUTH_SETTLE_TIMEOUT_MS,
  requiresSocialSignupCompletion,
  type SettledUser,
};

export function createSocialSignupCompletionUrlTree(
  router: Router,
  state: RouterStateSnapshot,
) {
  return router.createUrlTree(['/confirm/social-signup-complete'], {
    queryParams: {returnUrl: state.url},
  });
}

export function createAccessDeniedRedirect(
  router: Router,
  toast: BraToastService,
) {
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
export function waitForAuthSettled$(
  auth: AuthService,
): Observable<SettledUser> {
  return toObservable(auth.authSettled).pipe(
    filter(Boolean),
    take(1),
    timeout({first: AUTH_SETTLE_TIMEOUT_MS}),
    map(() => auth.user() as SettledUser),
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
      queryParams: {...route.queryParams, returnUrl: state.url},
    });
  const redirectToPublicHome = () => router.createUrlTree(['/']);

  // Synchronous fast paths, only while auth has not settled — once live state
  // exists it is authoritative and the async path below emits immediately.
  // In crossDomain mode the localStorage credential IS the credential:
  //   - empty/expired → provably logged out → redirect to login now
  //   - present       → optimistically allow; reconciliation re-runs these
  //                      guards after settle if the guess was wrong
  // Cookie/E2E mode (peek.known === false) always defers to the settle.
  if (!auth.authSettled()) {
    const peek = auth.peekCachedSession();
    if (peek.known && !peek.hasCredential) {
      return redirectToLogin();
    }
    if (peek.known && peek.hasCredential) {
      auth.scheduleOptimisticReconciliation();
      return true;
    }
  }

  return waitForAuthSettled$(auth).pipe(
    map((user) => {
      if (!auth.isAuthenticated()) return redirectToLogin();
      if (requiresSocialSignupCompletion(user)) {
        return createSocialSignupCompletionUrlTree(router, state);
      }
      if (!user) {
        // authenticated + sync-failed: the session is live, but protected
        // routes cannot safely render without the user profile.
        logger.warn(
          '[AuthGuard] authenticated session with no user profile (sync failed)',
        );
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

  // Synchronous fast paths, only while auth has not settled — once live state
  // exists it is authoritative and the async path below emits immediately.
  //   - empty/expired credential → provably logged out → landing matches with
  //     zero network wait (the buyer default, and the main win)
  //   - credential present → optimistically match the dashboard; if the
  //     session turns out stale, reconciliation re-runs these guards and the
  //     user is redirected with a toast
  // Cookie/E2E mode (peek.known === false) always defers to the settle.
  if (!auth.authSettled()) {
    const peek = auth.peekCachedSession();
    if (peek.known && !peek.hasCredential) {
      return false;
    }
    if (peek.known && peek.hasCredential) {
      auth.scheduleOptimisticReconciliation();
      return true;
    }
  }

  return waitForAuthSettled$(auth).pipe(
    map((user) => auth.isAuthenticated() && !!user),
    catchError((err) => {
      logger.error('[authenticatedMatch] Error waiting for auth', err);
      return of(false);
    }),
  );
};
