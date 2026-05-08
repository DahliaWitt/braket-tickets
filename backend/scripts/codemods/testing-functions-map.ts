/**
 * Canonical name→domain map for the testing_functions god-file split.
 *
 * `backend/convex/testing_functions.ts` is being split into
 * `backend/convex/testing/<domain>.ts` files. Every registered export keeps
 * its function name; only the module path changes. This table is the single
 * source of truth for the codemod that rewrites callers.
 *
 * Before: api.testing_functions.seedEvent
 * After:  api.testing.events.seedEvent
 */

export type TestingFunctionDomain =
  | 'events'
  | 'communities'
  | 'users'
  | 'users_node'
  | 'applications'
  | 'tickets'
  | 'orders'
  | 'guests'
  | 'resale'
  | 'trust_links'
  | 'magic_links'
  | 'marketing'
  | 'admin'
  | 'email'
  | 'utilities'
  | 'demo';

export const TESTING_FUNCTIONS_DOMAIN_MAP = {
  // events.ts
  seedEvent: 'events',
  seedEventWithInventory: 'events',
  seedEventWithoutInventory: 'events',
  seedEventWithMismatchedInventory: 'events',
  getEvent: 'events',
  getEventAvailability: 'events',
  getEventRevenueByTier: 'events',

  // communities.ts
  seedOrganizer: 'communities',
  seedOrganizerNoVetting: 'communities',
  verifyOrganizer: 'communities',
  setOrganizerStripeAccount: 'communities',
  setOrganizerStripeAccountBySlug: 'communities',
  getOrganizerStripeAccountBySlug: 'communities',
  seedCommunityAdmin: 'communities',
  seedCommunityScanner: 'communities',

  // users.ts
  verifyAccountAndUser: 'users',
  getUserByEmail: 'users',
  getByEmail: 'users',
  createUserDirectly: 'users',
  seedAppUser: 'users',
  setRootAdminStatus: 'users',
  makeUserRootAdmin: 'users',
  makeUserVetted: 'users',
  _getByEmailInternal: 'users',
  _createUserDirectlyInternal: 'users',

  // users_node.ts (action; "use node")
  seedUserAndGetTokens: 'users_node',

  // applications.ts
  seedApplication: 'applications',
  seedApprovedApplication: 'applications',
  clearUserApplications: 'applications',

  // tickets.ts
  seedTicket: 'tickets',
  getTicket: 'tickets',
  getTicketsForUser: 'tickets',

  // orders.ts
  seedPayment: 'orders',
  seedSandboxPurchaseFixture: 'orders',
  releaseOpenOrdersForEvent: 'orders',

  // guests.ts
  seedGuest: 'guests',
  getGuest: 'guests',
  listGuestsByEvent: 'guests',

  // resale.ts
  seedResaleListing: 'resale',
  getResaleListing: 'resale',
  getResaleListingsByEvent: 'resale',

  // trust_links.ts
  seedTrustLink: 'trust_links',
  getTrustLink: 'trust_links',

  // magic_links.ts
  seedMagicLink: 'magic_links',
  seedMagicLinkRedemption: 'magic_links',

  // marketing.ts
  seedMarketingPreference: 'marketing',
  seedAddressMarketingPreference: 'marketing',
  getAnnouncementStatusForTest: 'marketing',

  // admin.ts
  seedAdminInvite: 'admin',
  seedAdminNotificationPreference: 'admin',
  seedAuditLog: 'admin',
  getLatestAuditLog: 'admin',

  // email.ts
  logSentEmail: 'email',
  getSentEmails: 'email',
  getLatestVerificationCode: 'email',

  // utilities.ts
  clearAll: 'utilities',
  clearBetterAuthUsers: 'utilities',
  checkSeedExists: 'utilities',
  generateSeedUploadUrl: 'utilities',

  // demo.ts
  seedDemoData: 'demo',
} as const satisfies Record<string, TestingFunctionDomain>;

export type KnownTestingFunctionName =
  keyof typeof TESTING_FUNCTIONS_DOMAIN_MAP;

export function isKnownTestingFunction(
  name: string,
): name is KnownTestingFunctionName {
  return Object.prototype.hasOwnProperty.call(
    TESTING_FUNCTIONS_DOMAIN_MAP,
    name,
  );
}
