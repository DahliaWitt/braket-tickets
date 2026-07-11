import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {requireManageCommunity} from '../../lib/access';
import {getUserCommunities} from '../../lib/authz';
import {batchGetUsers} from '../../lib/batch_utils';
import {throwAppError} from '../errors';

type UsersDb = QueryCtx['db'] | MutationCtx['db'];

/**
 * Loads the given community members and returns those whose (lowercased) email
 * starts with `lowerTerm`, in ascending email order.
 *
 * Directory email search matches the term WITHIN a community's bounded
 * membership set instead of scanning the global `users` `email` index and then
 * scope-filtering the results. Scanning the global index first is unsafe: a
 * short or common prefix can match an unbounded number of unrelated platform
 * users, and any cap on that scan silently drops an in-scope member whenever
 * enough of those users share the prefix and sort ahead of them (the member
 * lands beyond the scanned window). Matching within the membership set cannot
 * drop a member for that reason, and reads stay bounded by community size (the
 * legitimate working set) rather than by total platform users.
 *
 * `memberUserIds` MUST already be scoped to the caller's community (e.g. the
 * organizer's directory rows or approved applications). This helper filters by
 * email only; it does not itself enforce membership.
 */
export async function filterMembersByEmailPrefix(
  db: UsersDb,
  memberUserIds: Iterable<Id<'users'>>,
  lowerTerm: string,
): Promise<Doc<'users'>[]> {
  const memberUsers = await batchGetUsers({db}, memberUserIds);
  return [...memberUsers.values()]
    .filter((user) => user.email?.toLowerCase().startsWith(lowerTerm) ?? false)
    .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
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
