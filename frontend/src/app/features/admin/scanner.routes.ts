import { type CanActivateFn, Router, type RouterStateSnapshot, type Routes } from '@angular/router';
import { inject } from '@angular/core';
import { from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { injectConvex } from 'convex-angular';
import { api } from '@convex/_generated/api';
import { AuthService } from '@/core/services/auth.service';
import {
  createSocialSignupCompletionUrlTree,
  requiresSocialSignupCompletion,
  waitForAuthSettled$,
} from '@/core/guards/auth.guards';
import { logger } from '@/utils/logger';

/**
 * Scanner guard that allows both admins and assigned door staff.
 *
 * Scanner-assignment state is fetched as a one-shot Convex RPC rather than
 * sourced from `AuthService.isScannerStaff` (which is subscription-backed).
 * The RPC path avoids a subtle race: `injectQuery(..., skipToken)` reports
 * `isLoading === false` and `data === undefined` until its args flip from
 * `skipToken` to `{}` and the subscription actually runs, and the guard
 * would otherwise either accept the pre-subscription default (false) or
 * time out waiting for `isLoading` to go true-then-false. A single
 * `convex.query(...)` call resolves directly and does not depend on any
 * signal propagation timing.
 *
 * Mid-session role grants still propagate to global UI affordances via
 * `AuthService.isScannerStaff`'s subscription — this guard only runs on
 * navigation, where a fresh RPC is acceptable and strictly more reliable.
 */
const scannerGuard: CanActivateFn = (route, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const convex = injectConvex();

  const redirectToLogin = () =>
    router.createUrlTree(['/login'], {
      queryParams: { ...route.queryParams, returnUrl: state.url },
    });

  return waitForAuthSettled$(auth).pipe(
    switchMap((user) => {
      if (!auth.isAuthenticated()) {
        logger.debug('ScannerGuard: unauthenticated, redirecting to login');
        return of(redirectToLogin());
      }
      if (!user) {
        // authenticated + sync-failed: cannot verify scanner assignment or
        // role without a user profile. Fail closed on authz by redirecting
        // to home rather than to /login — the session is live.
        logger.warn(
          'ScannerGuard: authenticated session with no user profile (sync failed); denying scanner access without re-login',
        );
        return of(router.createUrlTree(['/']));
      }
      if (requiresSocialSignupCompletion(user)) {
        logger.debug('ScannerGuard: user must complete social signup, redirecting');
        return of(createSocialSignupCompletionUrlTree(router, state));
      }
      if (auth.userRole() === 'root_admin') {
        logger.debug('ScannerGuard: Admin user authenticated, allowing access');
        return of(true as const);
      }

      return from(convex.query(api.communities.scanners.hasAnyAssignment, {})).pipe(
        map((hasAssignment: boolean) => {
          if (!hasAssignment) {
            logger.debug(
              'ScannerGuard: User is not admin or scanner staff, redirecting to dashboard',
            );
            return router.createUrlTree(['/']);
          }
          logger.debug('ScannerGuard: Authorized scanner user, allowing access');
          return true as const;
        }),
      );
    }),
    catchError((err) => {
      logger.error('ScannerGuard: Error during auth check', err);
      return of(redirectToLogin());
    }),
  );
};

export const SCANNER_ROUTES: Routes = [
  {
    path: '',
    canActivate: [scannerGuard],
    loadComponent: () =>
      import('./pages/check-in/check-in.component').then((m) => m.CheckInComponent),
  },
];
