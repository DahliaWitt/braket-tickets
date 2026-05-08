/**
 * Better Auth helper utilities for Convex.
 *
 * This module provides compatibility helpers for migrating from @convex-dev/auth to Better Auth.
 */

import {v} from 'convex/values';
import {authComponent} from './better_auth';
import {internalQuery} from '../_generated/server';
import type {QueryCtx, MutationCtx, ActionCtx} from '../_generated/server';
import type {Id, Doc} from '../_generated/dataModel';
import {collectMatchingInQuery} from './query_scan';
import {throwAppError, throwUnauthenticated} from './errors';
import {normalizeEmail} from './validation';

type UserLookupResult = {
  user: Doc<'users'> | null;
  collision: boolean;
};

// ---------------------------------------------------------------------------
// User lookup helpers with collision detection
// ---------------------------------------------------------------------------

export async function lookupUserByBetterAuthUserId(
  ctx: QueryCtx | MutationCtx | Pick<MutationCtx, 'db'>,
  betterAuthUserId: string,
): Promise<UserLookupResult> {
  const matches = await collectMatchingInQuery(
    ctx.db
      .query('users')
      .withIndex('by_betterAuthUserId', (q) =>
        q.eq('betterAuthUserId', betterAuthUserId),
      ),
    () => true,
    2,
  );

  // Strong invariant: non-null `user` implies exactly one match. Callers that
  // destructure `user` without checking `collision` still get safe behavior
  // (they see `null` and fall through to the no-match branch) instead of
  // silently acting on an arbitrary collision winner.
  return {
    user: matches.length === 1 ? matches[0]! : null,
    collision: matches.length > 1,
  };
}

export async function lookupUserByNormalizedEmail(
  ctx: QueryCtx | MutationCtx | Pick<MutationCtx, 'db'>,
  normalizedEmail: string,
): Promise<UserLookupResult> {
  const matches = await collectMatchingInQuery(
    ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', normalizedEmail)),
    (user) =>
      user.email !== undefined &&
      normalizeEmail(user.email) === normalizedEmail,
    2,
  );

  // See lookupUserByBetterAuthUserId for invariant rationale.
  return {
    user: matches.length === 1 ? matches[0]! : null,
    collision: matches.length > 1,
  };
}

export async function lookupUserByBetterAuthUserIdOrThrow(
  ctx: QueryCtx | MutationCtx | Pick<MutationCtx, 'db'>,
  betterAuthUserId: string,
): Promise<Doc<'users'> | null> {
  const {user, collision} = await lookupUserByBetterAuthUserId(
    ctx,
    betterAuthUserId,
  );
  if (collision) {
    // Message omits the Better Auth user id — it leaks to client-visible
    // ConvexError payloads and server logs. Forensic detail belongs in
    // structured `data`, which stays server-side unless the caller explicitly
    // surfaces it.
    throwAppError(
      'AUTH_IDENTITY_COLLISION',
      'Data integrity error: multiple app users share a Better Auth identity',
      {reason: 'betterAuthUserId'},
    );
  }
  return user;
}

export async function lookupUserByNormalizedEmailOrThrow(
  ctx: QueryCtx | MutationCtx | Pick<MutationCtx, 'db'>,
  normalizedEmail: string,
): Promise<Doc<'users'> | null> {
  const {user, collision} = await lookupUserByNormalizedEmail(
    ctx,
    normalizedEmail,
  );
  if (collision) {
    // Email intentionally omitted from the message — it is PII and propagates
    // to client error payloads + logs. See lib/logger.ts for the project's
    // scrubbing policy.
    throwAppError(
      'AUTH_IDENTITY_COLLISION',
      'Data integrity error: multiple app users share an email',
      {reason: 'email'},
    );
  }
  return user;
}

/**
 * Returns any *other* app user that owns the given normalized email. Use when
 * blocking a mutation that would otherwise create a second owner for the same
 * email (email change, auth sync, etc.). Callers throw their own domain-
 * specific message on non-null.
 */
export async function findConflictingEmailOwner(
  ctx: QueryCtx | MutationCtx | Pick<MutationCtx, 'db'>,
  normalizedEmail: string,
  excludeUserId: Id<'users'>,
): Promise<Doc<'users'> | null> {
  const matches = await collectMatchingInQuery(
    ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', normalizedEmail)),
    (user) =>
      user._id !== excludeUserId &&
      user.email !== undefined &&
      normalizeEmail(user.email) === normalizedEmail,
    1,
  );
  return matches[0] ?? null;
}

type ConvexCtx = QueryCtx | MutationCtx;

/**
 * Get the currently authenticated app user from the Better Auth session.
 *
 * Use this when unauthenticated access is allowed but the caller needs the
 * user document. Use `requireUser(ctx)` when authentication is mandatory, and
 * `getAuthUserId(ctx)` when only the id is needed.
 */
export async function getAuthUser(
  ctx: ConvexCtx,
): Promise<Doc<'users'> | null> {
  // In test environment, many call sites use convex-test's `withIdentity`
  // and set `identity.subject` to the app user id. Prefer that fast-path
  // when it's available, but fall back to Better Auth session resolution so
  // unit tests can still mock `authComponent.safeGetAuthUser(...)`.
  if (typeof process !== 'undefined' && process.env?.VITEST) {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.subject) {
      const normalizedUserId = ctx.db.normalizeId('users', identity.subject);
      if (normalizedUserId) {
        const user = await ctx.db.get('users', normalizedUserId);
        if (user) return user;
      }
    }
  }

  // First check if we have a basic auth identity (from JWT)
  const betterAuthUser = await authComponent.safeGetAuthUser(ctx);
  if (!betterAuthUser?._id) return null;

  const user = await lookupUserByBetterAuthUserIdOrThrow(
    ctx,
    betterAuthUser._id,
  );
  return user;
}

/**
 * Get the currently authenticated user ID from Better Auth session.
 *
 * Maps from Better Auth's `user` table to our application's `users` table.
 *
 * Note: For use in queries and mutations only. In actions, call
 * `getAuthUserInAction` (returns the Better Auth user) and/or
 * `getAuthUserIdInternal` via `ctx.runQuery` (returns the app user id).
 *
 * Throws a `ConvexError` with code `AUTH_IDENTITY_COLLISION` if two app users
 * are linked to the same Better Auth identity.
 *
 * @param ctx - Convex query or mutation context
 * @returns User ID if authenticated, null otherwise
 */
export async function getAuthUserId(
  ctx: ConvexCtx,
): Promise<Id<'users'> | null> {
  const user = await getAuthUser(ctx);
  return user?._id ?? null;
}

/**
 * Get the currently authenticated user from Better Auth session in an action context.
 *
 * Returns the Better Auth user directly since actions don't have db access.
 * Use this in actions that need basic auth info before calling queries/mutations.
 *
 * @param ctx - Convex action context
 * @returns Better Auth user object if authenticated, null otherwise
 */
export async function getAuthUserInAction(ctx: ActionCtx) {
  return await authComponent.safeGetAuthUser(ctx);
}

export async function requireUser(ctx: ConvexCtx): Promise<Doc<'users'>> {
  const user = await getAuthUser(ctx);
  if (!user) throwUnauthenticated();
  return user;
}

/**
 * Internal query to get the current user ID from auth context.
 * For use by actions that need the user ID.
 */
export const getAuthUserIdInternal = internalQuery({
  args: {},
  returns: v.union(v.id('users'), v.null()),
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});
