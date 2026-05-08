/**
 * Helper-only auth identity facade.
 *
 * Import this from feature modules instead of `auth_helpers.ts` so public
 * Convex surfaces do not depend on the internal-query wrapper module.
 */

export {
  lookupUserByBetterAuthUserId,
  lookupUserByNormalizedEmail,
  lookupUserByBetterAuthUserIdOrThrow,
  lookupUserByNormalizedEmailOrThrow,
  findConflictingEmailOwner,
  getAuthUser,
  getAuthUserId,
  getAuthUserInAction,
  requireUser,
} from './auth_helpers';
