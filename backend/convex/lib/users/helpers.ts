import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {requireManageCommunity} from '../../lib/access';
import {getUserCommunities} from '../../lib/authz';
import {batchGetUsers} from '../../lib/batch_utils';
import {takeFromQuery} from '../query_scan';
import {throwAppError} from '../errors';

type UsersDb = QueryCtx['db'] | MutationCtx['db'];

/**
 * Hard cap on how many global `users` rows a directory email-prefix search may
 * scan before stopping.
 *
 * Directory searches match a term against two indexes on the global `users`
 * table: the `search_name_email` search index (name branch) and the `email`
 * btree index (email branch). Convex caps full-text search results at ~1024, so
 * the name branch is implicitly bounded. The email btree range has no such cap:
 * a raw prefix stream (e.g. term `"a"`) walks every platform user whose email
 * starts with the term, which grows without bound as the users table grows and
 * can exceed Convex's per-query document-read limit — breaking the search.
 *
 * Bounding the email branch to the same order as the search index keeps the two
 * branches symmetric: both perform a bounded, best-effort top-N scan of the
 * global table and then scope-filter to the caller's community. Callers MUST
 * still apply their own membership/scoping filter — this only bounds the scan;
 * it does not by itself scope results to a community.
 */
export const DIRECTORY_EMAIL_PREFIX_SCAN_LIMIT = 1024;

/**
 * Reads a bounded window of global users whose (lowercased) email starts with
 * `lowerTerm`, capped at `scanLimit`. Returns at most `scanLimit` users in
 * ascending email order.
 *
 * This replaces the unbounded email-prefix `for await` streams that previously
 * drained the entire global email range in directory searches (using the same
 * `gte(term)..lt(term + '\uffff')` prefix bounds). Callers still apply their
 * own community/membership filter to the returned users. See
 * {@link DIRECTORY_EMAIL_PREFIX_SCAN_LIMIT}.
 */
export async function takeUsersByEmailPrefix(
  db: UsersDb,
  lowerTerm: string,
  scanLimit: number = DIRECTORY_EMAIL_PREFIX_SCAN_LIMIT,
): Promise<Doc<'users'>[]> {
  return await takeFromQuery(
    db
      .query('users')
      .withIndex('email', (q) =>
        q.gte('email', lowerTerm).lt('email', lowerTerm + '\uffff'),
      ),
    scanLimit,
  );
}

/**
 * Represents a user row in community admin/scanner lists.
 * Single source of truth for community membership display rows.
 *
 * Design note: Both `_id` and `userId` fields contain the same value but serve
 * different purposes in the frontend:
 * - `_id`: Used by Angular's track function for identity tracking in @for loops
 * - `userId`: Used for domain semantics, display fallback, and action handlers
 *
 * This dual-field design is intentional for frontend consumption patterns.
 */
export type CommunityUserRow = {
  /** User ID - used by Angular for identity tracking in @for loops */
  _id: Id<'users'>;
  /** User ID - used for domain semantics and action handlers */
  userId: Id<'users'>;
  organizerId: Id<'organizers'>;
  displayName: string;
  email?: string;
};

/**
 * Builds user rows for community admin/scanner lists.
 * Centralizes the displayName fallback logic and batch user fetching.
 *
 * DisplayName fallback chain:
 * 1. user.name (preferred)
 * 2. user.email (secondary)
 * 3. userId display string (fallback - ensures always displayable)
 *
 * Note: The userId fallback produces a non-user-friendly string, but ensures
 * the UI always has a value to display. Consider improving UX by requiring
 * either name or email at user creation time.
 *
 * @param ctx - Query context
 * @param organizerId - The community/organizer ID
 * @param userIds - Array of user IDs to build rows for
 * @returns Array of user rows with displayName and email
 */
export async function buildCommunityUserRows(
  ctx: QueryCtx,
  organizerId: Id<'organizers'>,
  userIds: Id<'users'>[],
): Promise<CommunityUserRow[]> {
  const userMap = await batchGetUsers(ctx, userIds);
  return userIds.map((userId) => {
    const user = userMap.get(userId);
    return {
      _id: userId,
      userId,
      organizerId,
      displayName: user?.name ?? user?.email ?? userId,
      email: user?.email,
    };
  });
}

export function stripSensitiveUserFields(u: Doc<'users'>) {
  const {
    emailChangeToken: _ect,
    emailChangeTokenExpiry: _ecte,
    authEmailVerified: _aev,
    betterAuthUserId: _buid,
    defaultCommunityAdminOrganizerId: _dcaoid,
    ...safe
  } = u;
  void _aev;
  void _buid;
  void _dcaoid;
  return safe;
}

export function stripCommunityAdminFields(
  u: ReturnType<typeof stripSensitiveUserFields>,
) {
  // Community admins don't need to see pending emails or verification timestamps.
  const {pendingEmail: _pe, emailVerificationTime: _evt, ...safe} = u;
  return safe;
}

export function throwMissingOrganizerScope(): never {
  throwAppError('MISSING_ARG', 'organizerId required for non-root admins');
}

export async function resolveNonRootOrganizerScope(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  organizerId: Doc<'organizers'>['_id'] | undefined,
): Promise<Doc<'organizers'>['_id'] | null> {
  if (organizerId) {
    await requireManageCommunity(ctx, user._id, organizerId);
    return organizerId;
  }

  const communities = await getUserCommunities(ctx, user._id);
  if (communities.length > 0) {
    throwMissingOrganizerScope();
  }
  return null;
}
