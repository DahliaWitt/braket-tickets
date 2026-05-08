import { type CanActivateFn, type CanMatchFn, Router, type RouterStateSnapshot, type Routes } from '@angular/router';
import { inject } from '@angular/core';
import { isConvexId } from '@/core/utils/convex-id';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '@/core/services/auth.service';
import {
  createAccessDeniedRedirect,
  createSocialSignupCompletionUrlTree,
  requiresSocialSignupCompletion,
  waitForAuthSettled$,
} from '@/core/guards/auth.guards';
import { unsavedChangesGuard } from '@/features/admin/guards/unsaved-changes.guard';
import { BraToastService } from '@ui/components/composites/toast/toast.service';
import { logger } from '@/utils/logger';

/**
 * Admin guard that waits for auth to fully settle before checking permissions.
 *
 * Tri-state decision:
 *   - unauthenticated             → /login (returnUrl preserved)
 *   - authenticated + sync-failed → /home with access-denied toast. We cannot
 *                                   verify the role without a user profile, so
 *                                   fail closed on authz. Do NOT redirect to
 *                                   /login — the session is live.
 *   - authenticated + profile     → role check, allow root_admin only.
 */
const adminGuard: CanActivateFn = (route, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(BraToastService);

  const redirectToLogin = () =>
    router.createUrlTree(['/login'], {
      queryParams: { ...route.queryParams, returnUrl: state.url },
    });

  return waitForAuthSettled$(auth).pipe(
    map((user) => {
      if (!auth.isAuthenticated()) {
        logger.debug('AdminGuard: unauthenticated, redirecting to login');
        return redirectToLogin();
      }
      if (!user) {
        logger.warn(
          'AdminGuard: authenticated session with no user profile (sync failed); denying admin access without re-login',
        );
        return createAccessDeniedRedirect(router, toast);
      }
      if (requiresSocialSignupCompletion(user)) {
        logger.debug('AdminGuard: user must complete social signup, redirecting');
        return createSocialSignupCompletionUrlTree(router, state);
      }
      if (auth.userRole() !== 'root_admin') {
        logger.debug('AdminGuard: User is not admin, redirecting to dashboard');
        return createAccessDeniedRedirect(router, toast);
      }
      logger.debug('AdminGuard: Admin user authenticated, allowing access');
      return true;
    }),
    catchError((err) => {
      logger.error('AdminGuard: Error during auth check', err);
      return of(redirectToLogin());
    }),
  );
};

const ADMIN_VALID_TABS = new Set(['communities']);

const adminTabGuard: CanMatchFn = (_route, segments) => {
  const tab = segments[0]?.path;
  return !!tab && ADMIN_VALID_TABS.has(tab);
};

const eventIdMatchGuard: CanMatchFn = (_route, segments) => {
  return segments.length >= 2 && isConvexId(segments[1]?.path);
};

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [adminGuard],
    children: [
      { path: '', redirectTo: 'communities', pathMatch: 'full' },
      {
        path: 'check-in',
        redirectTo: '/scanner',
        pathMatch: 'full',
      },
      {
        path: 'communities/new',
        loadComponent: () =>
          import('./pages/communities/community-editor/community-editor.component').then(
            (m) => m.AdminCommunityEditorComponent,
          ),
      },
      {
        path: 'communities/:id/edit',
        loadComponent: () =>
          import('./pages/communities/community-editor/community-editor.component').then(
            (m) => m.AdminCommunityEditorComponent,
          ),
      },
      {
        path: 'events/new',
        loadComponent: () =>
          import('./pages/event-editor/event-editor.component').then((m) => m.EventEditorComponent),
        canDeactivate: [unsavedChangesGuard],
      },
      {
        path: 'events/:id/manage',
        canMatch: [eventIdMatchGuard],
        loadComponent: () =>
          import('./pages/event-management/event-management').then((m) => m.EventManagement),
      },
      {
        path: 'events/:id/edit',
        canMatch: [eventIdMatchGuard],
        loadComponent: () =>
          import('./pages/event-editor/event-editor.component').then((m) => m.EventEditorComponent),
        canDeactivate: [unsavedChangesGuard],
      },
      { path: 'reminders', redirectTo: '/admin', pathMatch: 'full' },
      {
        path: ':tab',
        canMatch: [adminTabGuard],
        loadComponent: () => import('./pages/admin.component').then((m) => m.AdminComponent),
      },
      { path: '**', redirectTo: '/not-found' },
    ],
  },
];
