import {AuditRoute} from './audit-types';
import {HELP_CENTER_AUDIT_ROUTES} from './help-center-audit-routes.generated';

/**
 * Full route matrix for the visual audit suite.
 *
 * Routes with :param placeholders are resolved at runtime using seeded entity
 * IDs. The `seedRequirements` array lists which seed-demo entities are needed.
 * The `readyLocator` is a Playwright locator string signaling meaningful content.
 */
export const AUDIT_ROUTES: AuditRoute[] = [
  // ---------------------------------------------------------------------------
  // Anon routes — no authentication required
  // ---------------------------------------------------------------------------
  {
    label: 'Landing',
    path: '/',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Login',
    path: '/login',
    role: 'anon',
    readyLocator: '[data-testid="login-form"]',
  },
  {
    label: 'Login — Register tab',
    path: '/login',
    role: 'anon',
    readyLocator: '[data-testid="login-form"]',
    postNavAction: 'click-register-tab',
  },
  {
    label: 'Communities Directory',
    path: '/communities',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Public Events',
    path: '/events',
    role: 'anon',
    readyLocator: '[data-testid="community-picker-card"]',
  },
  ...HELP_CENTER_AUDIT_ROUTES,
  {
    label: 'Support',
    path: '/support',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Privacy Policy',
    path: '/privacy',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Terms of Service',
    path: '/terms',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Not Found',
    path: '/not-found',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Event Details',
    path: '/events/:eventId',
    role: 'anon',
    readyLocator: 'role=heading[level=1]',
    seedRequirements: ['publishedEvent'],
  },

  // ---------------------------------------------------------------------------
  // User routes — authGuard
  // ---------------------------------------------------------------------------
  {
    label: 'Dashboard',
    path: '/dashboard',
    role: 'user',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'My Tickets',
    path: '/tickets',
    role: 'user',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Account',
    path: '/account',
    role: 'user',
    readyLocator: 'role=heading[level=1]',
  },

  // ---------------------------------------------------------------------------
  // Community Admin routes — communityAdminGuard
  // ---------------------------------------------------------------------------
  {
    label: 'Pending Applications',
    path: '/community-admin/pending',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Members',
    path: '/community-admin/members',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Events',
    path: '/community-admin/events',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Magic Links',
    path: '/community-admin/magic-links',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Audit Log',
    path: '/community-admin/audit-log',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Settings',
    path: '/community-admin/settings',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Shared Vetting',
    path: '/community-admin/shared-vetting',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'Event Management',
    path: '/community-admin/events/:id/manage',
    role: 'communityAdmin',
    // Wait for the Purchases stat card — rendered only after management data loads,
    // not present in the loading skeleton. This prevents premature screenshots of
    // the SALES PER DAY chart before Convex data is delivered.
    readyLocator: '[data-testid="purchase-count"]',
    seedRequirements: ['communityAdminEvent'],
  },
  {
    label: 'Event Editor',
    path: '/community-admin/events/:id/edit',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
    seedRequirements: ['communityAdminEvent'],
  },
  {
    label: 'New Event',
    path: '/community-admin/events/new',
    role: 'communityAdmin',
    readyLocator: 'role=heading[level=1]',
  },

  // ---------------------------------------------------------------------------
  // Root Admin routes — adminGuard
  // ---------------------------------------------------------------------------
  {
    label: 'Admin Communities',
    path: '/admin/communities',
    role: 'rootAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  {
    label: 'New Community',
    path: '/admin/communities/new',
    role: 'rootAdmin',
    readyLocator: 'role=heading[level=1]',
  },
  // ---------------------------------------------------------------------------
  // Scanner routes — scannerGuard
  // ---------------------------------------------------------------------------
  {
    label: 'Check-In Scanner',
    path: '/scanner',
    role: 'scanner',
    readyLocator: 'role=heading[level=1]',
    seedRequirements: ['publishedEventWithTickets'],
  },
];
