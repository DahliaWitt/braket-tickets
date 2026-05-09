/**
 * CallerIdentity abstraction for endpoints serving both users and guests.
 *
 * Order checkout and guest checkout use this abstraction to resolve ownership
 * once at the mutation/action boundary.
 *
 * @see PRD v1.5 constraint #7 for the design rationale.
 *
 * ## Design Principle
 *
 * CallerIdentity is resolved ONCE at the mutation/action boundary.
 * Downstream code operates on CallerIdentity without branching on
 * user vs guest — it uses helper methods like `getEmail()` and
 * `getOwnerFields()` to get the data it needs.
 *
 * ## Resolution Order
 *
 * 1. Check for authenticated user (via Better Auth session / JWT).
 * 2. Fall back to guest session token (verified, non-expired).
 * 3. Throw if neither succeeds.
 *
 * ## Security Invariants
 *
 * - Guest sessions must be email-verified and within expiry window.
 * - Sliding inactivity window (2h) is enforced during resolution.
 * - lastActiveAt is bumped on every successful guest resolution.
 */

import type {MutationCtx, ActionCtx} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {getAuthUser} from './auth_identity';
import {internal} from '../_generated/api';
import {throwUnauthenticated} from './errors';
import {
  getActiveGuestSession,
  updateGuestSessionLastActive,
} from './guest_sessions/lifecycle';

export type CallerIdentity =
  | {type: 'user'; userId: Id<'users'>; email: string}
  | {
      type: 'guest';
      guestSessionId: Id<'guest_sessions'>;
      email: string;
      guestOwnerKey: string;
    };

export function getCallerEmail(identity: CallerIdentity): string {
  return identity.email;
}

/**
 * Build the ownership fields for a payment or ticket record.
 * - Authenticated users get `{ userId }`.
 * - Guest sessions get `{ guestSessionId }`.
 */
export function getOwnerFields(
  identity: CallerIdentity,
): {userId: Id<'users'>} | {guestSessionId: Id<'guest_sessions'>} {
  if (identity.type === 'user') {
    return {userId: identity.userId};
  }
  return {guestSessionId: identity.guestSessionId};
}

/**
 * Resolve the caller's identity in a mutation context.
 *
 * Checks authenticated user first (via auth session), then falls back
 * to guest session token. Throws if neither auth method succeeds.
 *
 * @param ctx - Mutation context (has direct DB access)
 * @param sessionToken - Optional guest session token from the frontend
 * @returns CallerIdentity
 * @throws {Error} If neither authenticated user nor valid guest session found
 */
export async function resolveCallerIdentity(
  ctx: MutationCtx,
  sessionToken?: string,
): Promise<CallerIdentity> {
  const user = await getAuthUser(ctx);
  if (user?.email) {
    return {type: 'user', userId: user._id, email: user.email};
  }

  if (sessionToken) {
    const now = Date.now();
    const session = await getActiveGuestSession(ctx, sessionToken, now);

    if (session) {
      await updateGuestSessionLastActive(ctx, session._id);
      return {
        type: 'guest',
        guestSessionId: session._id,
        email: session.email,
        guestOwnerKey: `session:${session._id}`,
      };
    }
  }

  throwUnauthenticated();
}

/**
 * Resolve caller identity in an action context.
 *
 * Actions cannot query the DB directly, so this uses internal queries
 * to validate the guest session. For authenticated users, it delegates
 * to the shared internal auth helper query.
 *
 * @param ctx - Action context
 * @param sessionToken - Optional guest session token from the frontend
 * @returns CallerIdentity
 * @throws {Error} If neither authenticated user nor valid guest session found
 */
export async function resolveCallerIdentityAction(
  ctx: ActionCtx,
  sessionToken?: string,
): Promise<CallerIdentity> {
  // Actions must use an internal query to resolve authenticated users.
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (userId) {
    const user = await ctx.runQuery(internal.users.profile.getInternal, {
      id: userId,
    });
    if (user?.email) {
      return {type: 'user', userId, email: user.email};
    }
  }

  if (sessionToken) {
    const session = await ctx.runQuery(
      internal.guest_sessions.core.getBySessionToken,
      {sessionToken, now: Date.now()},
    );
    if (session) {
      await ctx.runMutation(internal.guest_sessions.core.updateLastActive, {
        sessionId: session._id,
      });
      return {
        type: 'guest',
        guestSessionId: session._id,
        email: session.email,
        guestOwnerKey: `session:${session._id}`,
      };
    }
  }

  throwUnauthenticated();
}
