import {type Routes} from '@angular/router';
import {authGuard, authenticatedMatch} from '@/core/guards/auth.guards';
import {HELP_CENTER_ROUTES} from './features/help/help-center.routes.generated';

// LINT.IfChange
export const routes: Routes = [
  // === Chrome-less routes (no header/footer) ===
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/pages/login/login.component').then(
        (m) => m.LoginComponent,
      ),
  },
  {
    path: 'confirm/verification',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-verification.component').then(
        (m) => m.ConfirmVerificationComponent,
      ),
  },
  {
    path: 'confirm/verification/:token',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-verification.component').then(
        (m) => m.ConfirmVerificationComponent,
      ),
  },
  {
    path: 'confirm/password-reset',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-password-reset.component').then(
        (m) => m.ConfirmPasswordResetComponent,
      ),
  },
  {
    path: 'confirm/email-change',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-email-change.component').then(
        (m) => m.ConfirmEmailChangeComponent,
      ),
  },
  {
    path: 'confirm/social-signin',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-social-signin.component').then(
        (m) => m.ConfirmSocialSigninComponent,
      ),
  },
  {
    path: 'confirm/social-link',
    loadComponent: () =>
      import('./features/auth/pages/confirm/confirm-social-link.component').then(
        (m) => m.ConfirmSocialLinkComponent,
      ),
  },
  {
    path: 'confirm/social-signup-complete',
    loadComponent: () =>
      import('./features/auth/pages/confirm/complete-social-signup.component').then(
        (m) => m.CompleteSocialSignupComponent,
      ),
  },
  // Redirect legacy/alternative verification paths to the correct route.
  // Must use RedirectFunction to preserve query params (?token=, ?code=) —
  // static redirectTo strings silently drop them.
  {
    path: 'verify-email',
    redirectTo: ({queryParams}) => {
      const qs = new URLSearchParams(
        queryParams as Record<string, string>,
      ).toString();
      return qs ? `/confirm/verification?${qs}` : '/confirm/verification';
    },
    pathMatch: 'full',
  },
  // Better Auth verification links use /api/auth/verify-email — redirect to SPA handler
  {
    path: 'api/auth/verify-email',
    redirectTo: ({queryParams}) => {
      const qs = new URLSearchParams(
        queryParams as Record<string, string>,
      ).toString();
      return qs ? `/confirm/verification?${qs}` : '/confirm/verification';
    },
    pathMatch: 'full',
  },
  // Redirect legacy /join/ and /apply/ paths to /invite/ (BRA-127).
  // Must use RedirectFunction to carry the route param.
  {
    path: 'join/:token',
    redirectTo: ({params}) => `/invite/${params['token']}`,
    pathMatch: 'full',
  },
  {
    path: 'apply/:token',
    redirectTo: ({params}) => `/invite/${params['token']}`,
    pathMatch: 'full',
  },
  {
    path: 'invite/:token',
    loadComponent: () =>
      import('./features/invite/pages/invite/invite.component').then(
        (m) => m.InviteComponent,
      ),
  },
  {
    path: 'admin-invite/:token',
    loadComponent: () =>
      import('./features/invite-redeem/invite-redeem.component').then(
        (m) => m.InviteRedeemComponent,
      ),
  },
  {
    path: 'vetting/:id',
    loadComponent: () =>
      import('./features/vetting/pages/vetting/vetting.component').then(
        (m) => m.VettingComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'scanner',
    loadChildren: () =>
      import('./features/admin/scanner.routes').then((m) => m.SCANNER_ROUTES),
  },
  // Redirect short community-events URLs to the canonical events page with query param.
  {
    path: 'c/:slug',
    redirectTo: ({params}) => `/events?community=${params['slug']}`,
    pathMatch: 'full',
  },
  {
    path: 'communities/:slug',
    redirectTo: ({params}) => `/events?community=${params['slug']}`,
    pathMatch: 'full',
  },
  // === Layout routes (shared header + footer via MainLayoutComponent) ===
  {
    path: '',
    loadComponent: () =>
      import('./layout/main-layout/main-layout.component').then(
        (m) => m.MainLayoutComponent,
      ),
    children: [
      // canMatch selects this route for authenticated users.
      // canActivate handles edge cases: social signup completion redirect, session expiry.
      {
        path: '',
        canMatch: [authenticatedMatch],
        loadComponent: () =>
          import('./features/dashboard/pages/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
        canActivate: [authGuard],
      },
      // Unauthenticated users see landing page at /
      {
        path: '',
        loadComponent: () =>
          import('./features/landing/pages/landing/landing.component').then(
            (m) => m.LandingComponent,
          ),
      },
      {
        path: 'about',
        loadComponent: () =>
          import('./features/about/pages/about/about.component').then(
            (m) => m.AboutComponent,
          ),
      },
      {
        path: 'support',
        loadComponent: () =>
          import('./features/support/pages/support/support.component').then(
            (m) => m.SupportComponent,
          ),
      },
      {
        path: 'privacy',
        loadComponent: () =>
          import('./features/legal/pages/privacy-policy/privacy-policy').then(
            (m) => m.PrivacyPolicyComponent,
          ),
      },
      {
        path: 'terms',
        loadComponent: () =>
          import('./features/legal/pages/terms-of-service/terms-of-service').then(
            (m) => m.TermsOfServiceComponent,
          ),
      },
      {
        path: 'unsubscribe',
        loadComponent: () =>
          import('./features/legal/pages/unsubscribe/unsubscribe').then(
            (m) => m.UnsubscribeComponent,
          ),
      },
      {
        path: 'vetting-info',
        redirectTo: 'communities',
        pathMatch: 'full',
      },
      {
        path: 'events',
        loadComponent: () =>
          import('./features/tickets/pages/community-events/community-events.component').then(
            (m) => m.CommunityEventsComponent,
          ),
      },
      {
        path: 'events/:id',
        loadComponent: () =>
          import('./features/tickets/pages/event-details/event-details.component').then(
            (m) => m.EventDetailsComponent,
          ),
      },
      {
        path: 'communities',
        loadComponent: () =>
          import('./features/communities/pages/community-directory/community-directory.component').then(
            (m) => m.CommunityDirectoryComponent,
          ),
      },
      {
        path: 'dashboard',
        redirectTo: '/',
        pathMatch: 'full',
      },
      {
        path: 'tickets',
        loadComponent: () =>
          import('./features/tickets/pages/tickets/tickets.component').then(
            (m) => m.TicketsComponent,
          ),
        canActivate: [authGuard],
      },
      ...HELP_CENTER_ROUTES,
      {
        path: 'admin',
        loadChildren: () =>
          import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./features/auth/pages/account/account.component').then(
            (m) => m.AccountComponent,
          ),
        canActivate: [authGuard],
      },
      {
        path: 'community-admin',
        loadChildren: () =>
          import('./features/admin/community-admin.routes').then(
            (m) => m.COMMUNITY_ADMIN_ROUTES,
          ),
      },
      {
        path: 'not-found',
        loadComponent: () =>
          import('./features/not-found/not-found.component').then(
            (m) => m.NotFoundComponent,
          ),
      },
    ],
  },

  // Wildcard — MUST be last. Redirects to layout child so 404 gets chrome.
  {path: '**', redirectTo: 'not-found'},
];
// LINT.ThenChange("../../e2e/audit/audit-routes.ts")
