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
import { CommunityContextService } from '@/features/admin/services/community-context.service';
import { unsavedChangesGuard } from '@/features/admin/guards/unsaved-changes.guard';
import { BraToastService } from '@ui/components/composites/toast/toast.service';
import { logger } from '@/utils/logger';

/**
 * Community admin guard that allows admins and users with the community_admin role.
 * Follows the same auth initialization pattern as adminGuard to prevent
 * race conditions where the roles array hasn't loaded yet.
 *
 * Tri-state decision (same as adminGuard — fail closed on authz when user
 * profile sync failed, but do not send a live session back to /login):
 *   - unauthenticated             → /login
 *   - authenticated + sync-failed → /home with access-denied toast
 *   - authenticated + profile     → role check
 */
const communityAdminGuard: CanActivateFn = (route, state: RouterStateSnapshot) => {
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
        logger.debug('CommunityAdminGuard: unauthenticated, redirecting to login');
        return redirectToLogin();
      }
      if (!user) {
        logger.warn(
          'CommunityAdminGuard: authenticated session with no user profile (sync failed); denying access without re-login',
        );
        return createAccessDeniedRedirect(router, toast);
      }
      if (requiresSocialSignupCompletion(user)) {
        logger.debug('CommunityAdminGuard: user must complete social signup, redirecting');
        return createSocialSignupCompletionUrlTree(router, state);
      }
      const role = auth.userRole();
      if (role !== 'root_admin' && role !== 'community_admin') {
        logger.debug('CommunityAdminGuard: not root_admin or community_admin, redirecting to dashboard');
        return createAccessDeniedRedirect(router, toast);
      }
      logger.debug('CommunityAdminGuard: authorized, allowing access');
      return true;
    }),
    catchError((err) => {
      logger.error('CommunityAdminGuard: Error during auth check', err);
      return of(redirectToLogin());
    }),
  );
};

const COMMUNITY_ADMIN_VALID_TABS = new Set([
  'magic-links',
  'pending',
  'history',
  'members',
  'events',
  'audit-log',
  'settings',
  'shared-vetting',
]);

const communityAdminTabGuard: CanMatchFn = (_route, segments) => {
  const tab = segments[0]?.path;
  return !!tab && COMMUNITY_ADMIN_VALID_TABS.has(tab);
};

const eventIdMatchGuard: CanMatchFn = (_route, segments) => {
  return segments.length >= 2 && isConvexId(segments[1]?.path);
};

export const COMMUNITY_ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [communityAdminGuard],
    providers: [CommunityContextService],
    children: [
      { path: '', redirectTo: 'pending', pathMatch: 'full' },
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
      {
        path: ':tab',
        canMatch: [communityAdminTabGuard],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./pages/community-admin/community-admin.component').then((m) => m.CommunityAdminComponent),
      },
      { path: '**', redirectTo: '/not-found' },
    ],
  },
];
