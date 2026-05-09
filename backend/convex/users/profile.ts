import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {action, internalQuery, mutation, query} from '../_generated/server';
import type {Doc, Id} from '../_generated/dataModel';
import {
  getAuthUser,
  getAuthUserInAction,
  requireUser,
} from '../lib/auth_identity';
import {adapterFindMany} from '../lib/better_auth_adapter';
import {sanitizeName} from '../lib/validation';
import {isPlatformAdmin} from '../lib/access';
import {
  connectedAccountValidator,
  currentUserValidator,
  internalUserValidator,
  userApplicationPageValidator,
  userProfileValidator,
} from '../lib/users/validators';
import {
  resolveNonRootOrganizerScope,
  stripSensitiveUserFields,
} from '../lib/users/helpers';
import {
  listUsersForCommunityAdmin,
  listUsersForRootAdmin,
  searchUsersForAdminScope,
} from '../lib/users/directory';
import {
  assertCanRevokeMembership,
  revokeMembershipAndCreateAuditLog,
} from '../lib/users/membership';
import {getUserCommunities} from '../lib/authz';
import {
  loadUserApplicationPageForOrganizerFromDirectory,
  searchUserApplicationsInDirectory,
} from '../lib/users/organizer_directory';

type UserApplicationRow = {
  user: ReturnType<typeof stripSensitiveUserFields>;
  application: {
    _id: Id<'applications'>;
    _creationTime: number;
    userId: Id<'users'>;
    organizerId?: Id<'organizers'>;
    status: Doc<'applications'>['status'];
    processedBy?: Id<'users'>;
    reason?: string;
    answers: Doc<'applications'>['answers'];
  } | null;
  isCommunityAdmin?: boolean;
  communityAccessSource?:
    | 'approved_application'
    | 'magic_link'
    | 'direct_member'
    | 'shared';
  trustedViaOrganizerName?: string;
};

type UserApplicationPage = {
  page: UserApplicationRow[];
  isDone: boolean;
  continueCursor: string;
};

const EMPTY_USER_APPLICATION_PAGE: UserApplicationPage = {
  page: [],
  isDone: true,
  continueCursor: '',
};

/**
 * Returns the currently authenticated user.
 *
 * @returns The user document if authenticated, otherwise null.
 */
export const current = query({
  args: {},
  returns: v.union(currentUserValidator, v.null()),
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    const safeUser = stripSensitiveUserFields(user);
    const communityAdminOrganizerIds = await getUserCommunities(ctx, user._id);
    const rootAdmin = await isPlatformAdmin(ctx, user._id);
    return {
      ...safeUser,
      isRootAdmin: rootAdmin,
      communityAdminOrganizerIds,
      id: user._id, // Compatibility with frontend expecting .id
    };
  },
});

/**
 * Retrieves a user by ID with privacy controls.
 *
 * - If the requester is the user themselves or an admin, returns the full user object.
 * - If the requester is a third party, returns a filtered "Public Profile" object
 *   containing only non-sensitive fields (name, image).
 * - Throws if unauthenticated; returns null if user is not found.
 *
 * @param id - The ID of the user to fetch.
 */
export const get = query({
  args: {id: v.id('users')},
  returns: v.union(userProfileValidator, v.null()),
  handler: async (ctx, args) => {
    const requester = await requireUser(ctx);

    const user = await ctx.db.get('users', args.id);
    if (!user) return null;

    const safeUser = stripSensitiveUserFields(user);

    if (user._id === requester._id) {
      return safeUser;
    }

    // Check if requester is root admin (only root admins get full profile access)
    if (await isPlatformAdmin(ctx, requester._id)) {
      return safeUser;
    }

    // Public Profile Filtering
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      image: user.image,
      // Explicitly exclude sensitive fields like email and roles.
    };
  },
});

/**
 * Updates the authenticated user's profile information.
 *
 * Enforces strict length limits on inputs to prevent storage abuse:
 * - Name: 100 chars
 * - Username: 50 chars
 *
 * @param name - (Optional) New display name.
 * @param image - (Optional) Profile image URL/ID.
 * @throws Error if any field exceeds its maximum length.
 */
export const update = mutation({
  args: {
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    // Security: Sanitize name (strip HTML) at storage boundary.
    const safeName = sanitizeName(args.name);

    // SECURITY: Explicit field mapping instead of spread to prevent accidental
    // inclusion of new sensitive fields if the args type ever expands.
    await ctx.db.patch('users', userId, {
      name: safeName,
      image: args.image,
    });
  },
});

/**
 * Lists all users. Root admin returns all; community admin returns community members only.
 *
 * @param organizerId - Required for non-root admins to scope results to a community.
 * @returns Array of user documents, ordered by creation time (descending).
 */
export const list = query({
  args: {organizerId: v.optional(v.id('organizers'))},
  returns: v.array(userProfileValidator),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return []; // Access denied

    if (await isPlatformAdmin(ctx, user._id)) {
      return listUsersForRootAdmin(ctx);
    }

    const organizerScope = await resolveNonRootOrganizerScope(
      ctx,
      user,
      args.organizerId,
    );
    if (!organizerScope) {
      // Plain user with no admin role — silent denial
      return [];
    }

    return listUsersForCommunityAdmin(ctx, organizerScope);
  },
});

/**
 * Searches users by name or email. Root admin searches all; community admin searches community members only.
 *
 * Uses a search index for name matching and an email index for exact prefix
 * matching, then merges and deduplicates results.
 *
 * @param query - The search string to match against name or email.
 * @param organizerId - Required for non-root admins to scope results to a community.
 * @returns Array of up to 50 matching users.
 */
export const search = query({
  args: {query: v.string(), organizerId: v.optional(v.id('organizers'))},
  returns: v.array(userProfileValidator),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    let organizerScope: NonNullable<typeof args.organizerId> | null = null;
    if (!(await isPlatformAdmin(ctx, user._id))) {
      organizerScope = await resolveNonRootOrganizerScope(
        ctx,
        user,
        args.organizerId,
      );
      if (!organizerScope) {
        // Plain user — silent denial
        return [];
      }
    }

    return searchUsersForAdminScope(ctx.db, {
      query: args.query,
      organizerId: organizerScope,
    });
  },
});

/**
 * Lists all users and includes their latest application status. Admin only.
 *
 * Always community-scoped. Root admins can pass any organizerId through the
 * same access helper used for community admins; there is intentionally no
 * unscoped all-users application directory.
 *
 * @param paginationOpts - Pagination cursor and page size.
 * @param organizerId - Required organizer scope for the member directory.
 * @returns Array of objects containing `{ user, application }`.
 */
export const listWithApplications = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizerId: v.id('organizers'),
    search: v.optional(v.string()),
  },
  returns: userApplicationPageValidator,
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return EMPTY_USER_APPLICATION_PAGE;

    const organizerScope = await resolveNonRootOrganizerScope(
      ctx,
      user,
      args.organizerId,
    );
    if (!organizerScope) {
      return EMPTY_USER_APPLICATION_PAGE;
    }

    const searchTerm = args.search?.trim();
    if (searchTerm) {
      return await searchUserApplicationsInDirectory(
        ctx,
        organizerScope,
        searchTerm,
      );
    }

    return await loadUserApplicationPageForOrganizerFromDirectory(
      ctx,
      organizerScope,
      args.paginationOpts,
    );
  },
});

/**
 * Revokes a user's membership. Admin only.
 *
 * Community-scoped revocations are recorded on the user's application history.
 * Root admins can revoke for any organizer, and community admins must provide
 * their own organizerId to scope the action.
 *
 * @param userId - The ID of the user to revoke.
 * @param organizerId - Required organizer scope for the revocation.
 */
export const revokeMembership = mutation({
  args: {userId: v.id('users'), organizerId: v.id('organizers')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: adminId} = await requireUser(ctx);

    await assertCanRevokeMembership(ctx, {
      adminId,
      organizerId: args.organizerId,
    });

    await revokeMembershipAndCreateAuditLog(ctx, {
      adminId,
      userId: args.userId,
      organizerId: args.organizerId,
    });
  },
});

/**
 * Retrieves all connected auth accounts (e.g., Google) for the current user.
 *
 * Note: This is an ACTION (not a query) because it needs to use ctx.runQuery()
 * to access the Better Auth component's adapter. Component adapters can only be
 * accessed via runQuery/runMutation from action context.
 *
 * @returns Array of account details including provider name and provider-specific ID.
 */
export const getConnectedAccounts = action({
  args: {},
  returns: v.array(connectedAccountValidator),
  handler: async (ctx) => {
    type ConnectedAccount = {
      id: string;
      provider: string;
      providerId: string;
      providerEmail?: string;
      isEmailVerified?: boolean;
      created: string;
      updated?: string;
    };

    const betterAuthUser = await getAuthUserInAction(ctx);
    if (!betterAuthUser?._id) return [];

    const accounts = await adapterFindMany(ctx, {
      model: 'account',
      where: [{field: 'userId', value: betterAuthUser._id}],
      paginationOpts: {
        numItems: 100,
        cursor: null,
      },
    });

    const normalizedAccounts: ConnectedAccount[] = [];

    for (const [index, account] of accounts.entries()) {
      const connectedProvider = account['providerId'];
      const accountIdentifier = account['accountId'];
      const providerEmail = account['email'];
      const emailVerified = account['emailVerified'];
      const createdAt = account['createdAt'];
      const updatedAt = account['updatedAt'];
      if (
        typeof connectedProvider !== 'string' ||
        typeof accountIdentifier !== 'string' ||
        typeof createdAt !== 'number'
      ) {
        continue;
      }

      normalizedAccounts.push({
        id: `${connectedProvider}-${accountIdentifier}-${index}`,
        provider: connectedProvider,
        providerId: accountIdentifier,
        ...(typeof providerEmail === 'string' ? {providerEmail} : {}),
        ...(typeof emailVerified === 'boolean'
          ? {isEmailVerified: emailVerified}
          : {}),
        created: new Date(createdAt).toISOString(),
        ...(typeof updatedAt === 'number'
          ? {updated: new Date(updatedAt).toISOString()}
          : {}),
      });
    }

    return normalizedAccounts;
  },
});

/**
 * Internal query to fetch a user by ID.
 *
 * @param id - User ID.
 * @returns User document.
 */
export const getInternal = internalQuery({
  args: {id: v.id('users')},
  returns: v.union(internalUserValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get('users', args.id);
  },
});
