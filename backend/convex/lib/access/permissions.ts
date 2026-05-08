import type {PermissionArg} from '@djpanda/convex-authz';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {authz, type AuthzScope, PERMISSIONS} from '../authz';

export type AccessCtx = QueryCtx | MutationCtx;

/**
 * Per-request memo for the `platform:admin` probe.
 *
 * `canWithFallback` runs inside query/mutation handlers that resolve access
 * for many entities in a single call. Each of those entity-level checks would
 * otherwise re-issue the same "is this user a root_admin?" component query.
 * The WeakMap keys on the live ctx so the cache is scoped to one Convex
 * function invocation.
 */
const platformAdminCache = new WeakMap<
  AccessCtx,
  Map<string, Promise<boolean>>
>();

export function isPlatformAdminCached(
  ctx: AccessCtx,
  userId: string,
): Promise<boolean> {
  let perCtx = platformAdminCache.get(ctx);
  if (perCtx === undefined) {
    perCtx = new Map();
    platformAdminCache.set(ctx, perCtx);
  }
  let cached = perCtx.get(userId);
  if (cached === undefined) {
    cached = authz.can(ctx, userId, 'platform:admin');
    perCtx.set(userId, cached);
  }
  return cached;
}

/**
 * Check a scoped permission with automatic fallback to the global
 * `platform:admin` grant.
 */
export async function canWithFallback(
  ctx: AccessCtx,
  userId: string,
  permission: PermissionArg<typeof PERMISSIONS>,
  scope: AuthzScope,
): Promise<boolean> {
  if (await authz.can(ctx, userId, permission, scope)) return true;
  return isPlatformAdminCached(ctx, userId);
}
