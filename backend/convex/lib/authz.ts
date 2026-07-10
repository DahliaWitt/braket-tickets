import {Authz, definePermissions, defineRoles} from '@djpanda/convex-authz';

import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../_generated/server';
import {components} from '../_generated/api';

import {logger} from './logger';
import {isPublishedCommunity} from './community_status';
import {assertTrustLinkLimit} from './trust_links';
import {throwAppError} from './errors';

export const AUTHZ_NAMESPACE_ID = 'platform';

export const PERMISSIONS = definePermissions({
  platform: {admin: true},
  community: {view: true, members: true, admin: true},
  event: {
    purchase: true,
    roster: true,
    create: true,
    edit: true,
    manage: true,
    scan: true,
  },
});

// There is no `event:view` permission. Read access to an event is NOT a single
// grant: publicly visible published events need no permission; published
// private events in live communities resolve through `event:purchase` (see
// `resolvePurchaseAccessForUser`); and restricted-visibility events (draft,
// cancelled, orphaned, or in an unpublished community) are gated in
// `canViewEvent` on `event:manage`/`event:edit` — i.e. only organizers who can
// modify the event (community admins, and root admins via the global fallback).
//
// This deliberately withholds restricted-event reads from `member` and
// `community_scanner`. An earlier design granted those roles an `event:view`
// permission that was consulted only by the restricted branch, which let every
// vetted member and door-staff scanner read the full detail of a community's
// unpublished/cancelled events — inverting the visibility ladder (a scanner is
// already denied a published *private* event, yet gained the strictly-less-
// public draft). Gating on manage/edit closes that leak and, unlike a view
// permission, cannot be reopened by stale materialized permission rows: members
// and scanners never held manage/edit. Scanners still work *published* events
// via `event:roster`/`event:scan`, both lifecycle-gated to `published` in
// `canViewEventRoster`/`canScanEvent`.
export const ROLES = defineRoles(PERMISSIONS, {
  root_admin: {
    platform: ['admin'],
    community: ['view', 'members', 'admin'],
    event: ['purchase', 'roster', 'create', 'edit', 'manage', 'scan'],
  },
  community_admin: {
    community: ['view', 'members', 'admin'],
    event: ['purchase', 'roster', 'create', 'edit', 'manage', 'scan'],
  },
  community_scanner: {
    community: ['view'],
    event: ['roster', 'scan'],
  },
  member: {
    community: ['view'],
    event: ['purchase'],
  },
});

export const authz = new Authz(components.authz, {
  permissions: PERMISSIONS,
  roles: ROLES,
  tenantId: AUTHZ_NAMESPACE_ID,
});

export const AUTHZ_RELATION_QUERY_CAP = 1000;
export const AUTHZ_RELATION_QUERY_WARN_THRESHOLD = 800;

export type AuthzScope = {
  type: string;
  id: string;
};

type AuthzCtx = QueryCtx | MutationCtx;
type AuthzQueryCtx = Pick<QueryCtx, 'runQuery'>;
type AuthzWriteOptions = {
  actorId?: Id<'users'>;
};

export function organizerScope(organizerId: Id<'organizers'>): AuthzScope {
  return {type: 'organizer', id: organizerId as string};
}

export function authzUserId(userId: Id<'users'>): string {
  return userId;
}

function dedupeOrganizerIds(
  relations: ReadonlyArray<{objectId?: string; subjectId?: string}>,
): Id<'organizers'>[] {
  const organizerIds = new Set<Id<'organizers'>>();

  for (const relation of relations) {
    const organizerId = relation.objectId ?? relation.subjectId;
    if (!organizerId) continue;
    organizerIds.add(organizerId as Id<'organizers'>);
  }

  return [...organizerIds];
}

async function listOrganizersById(
  ctx: AuthzCtx,
  organizerIds: ReadonlyArray<Id<'organizers'>>,
): Promise<Doc<'organizers'>[]> {
  const organizers = await Promise.all(
    organizerIds.map((organizerId) => ctx.db.get('organizers', organizerId)),
  );

  return organizers.filter(
    (organizer): organizer is Doc<'organizers'> => organizer !== null,
  );
}

async function listRoleUserIds(
  ctx: AuthzQueryCtx,
  role: 'community_admin' | 'community_scanner' | 'member',
  scope: AuthzScope,
): Promise<string[]> {
  const assignments = await ctx.runQuery(
    components.authz.queries.getUsersWithRole,
    {
      tenantId: AUTHZ_NAMESPACE_ID,
      role,
      scope,
    },
  );
  return assignments.map((assignment) => assignment.userId);
}

export async function listOrganizerMembers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<string[]> {
  const userIds = await listRoleUserIds(
    ctx,
    'member',
    organizerScope(organizerId),
  );

  if (userIds.length >= AUTHZ_RELATION_QUERY_CAP) {
    throwAppError(
      'MEMBER_CAP_EXCEEDED',
      `Community ${organizerId} has \u2265${AUTHZ_RELATION_QUERY_CAP} members; results are truncated.`,
    );
  }

  if (userIds.length >= AUTHZ_RELATION_QUERY_WARN_THRESHOLD) {
    logger.warn(
      'authz',
      `Community ${organizerId} approaching member cap: ${userIds.length}/${AUTHZ_RELATION_QUERY_CAP}`,
    );
  }

  return userIds;
}

export async function listDirectTrustedOrganizers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Array<{objectId: string; relation: string}>> {
  const relations = await ctx.runQuery(
    components.authz.rebac.getSubjectRelations,
    {
      tenantId: AUTHZ_NAMESPACE_ID,
      subjectId: organizerId as string,
      subjectType: 'organizer',
    },
  );
  return relations.filter((relation) => relation.relation === 'trusts');
}

export async function listDirectTrustingOrganizers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Array<{subjectId: string; relation: string}>> {
  return await ctx.runQuery(components.authz.rebac.getObjectRelations, {
    tenantId: AUTHZ_NAMESPACE_ID,
    objectId: organizerId as string,
    objectType: 'organizer',
    relation: 'trusts',
  });
}

export async function listOneHopSharedAccessOrganizers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Doc<'organizers'>[]> {
  const organizerIds = dedupeOrganizerIds(
    await listDirectTrustedOrganizers(ctx, organizerId),
  );
  assertTrustLinkLimit(organizerIds.length);
  return listOrganizersById(ctx, organizerIds);
}

export async function listOneHopTrustingAccessOrganizers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Doc<'organizers'>[]> {
  const organizerIds = dedupeOrganizerIds(
    await listDirectTrustingOrganizers(ctx, organizerId),
  );
  return listOrganizersById(ctx, organizerIds);
}

async function findTrustLinkProjection(
  ctx: Pick<MutationCtx, 'db'>,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
) {
  return await ctx.db
    .query('organizer_trust_links')
    .withIndex('by_trustingOrganizerId_and_trustedOrganizerId', (query) =>
      query
        .eq('trustingOrganizerId', trustingOrganizerId)
        .eq('trustedOrganizerId', trustedOrganizerId),
    )
    .unique();
}

export async function upsertTrustLinkProjection(
  ctx: Pick<MutationCtx, 'db'>,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
): Promise<void> {
  const existing = await findTrustLinkProjection(
    ctx,
    trustingOrganizerId,
    trustedOrganizerId,
  );
  if (existing) {
    return;
  }

  await ctx.db.insert('organizer_trust_links', {
    trustingOrganizerId,
    trustedOrganizerId,
  });
}

export async function deleteTrustLinkProjection(
  ctx: Pick<MutationCtx, 'db'>,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
): Promise<void> {
  const existing = await findTrustLinkProjection(
    ctx,
    trustingOrganizerId,
    trustedOrganizerId,
  );
  if (!existing) {
    return;
  }

  await ctx.db.delete('organizer_trust_links', existing._id);
}

export async function paginateTrustingOrganizerIds(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  trustedOrganizerId: Id<'organizers'>,
  paginationOpts: {
    cursor: string | null;
    numItems: number;
  },
) {
  return await ctx.db
    .query('organizer_trust_links')
    .withIndex('by_trustedOrganizerId_and_trustingOrganizerId', (query) =>
      query.eq('trustedOrganizerId', trustedOrganizerId),
    )
    .paginate(paginationOpts);
}

export async function listPublishedTrustedAudienceOrganizers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Doc<'organizers'>[]> {
  const organizers = await listOneHopSharedAccessOrganizers(ctx, organizerId);
  return organizers
    .filter((organizer) => isPublishedCommunity(organizer))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function addMember(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  options?: AuthzWriteOptions,
): Promise<void> {
  if (
    await authz.hasRole(
      ctx,
      authzUserId(userId),
      'member',
      organizerScope(organizerId),
    )
  ) {
    return; // idempotent
  }
  await authz.assignRole(
    ctx,
    authzUserId(userId),
    'member',
    organizerScope(organizerId),
    undefined,
    options?.actorId,
  );
}

export async function removeMember(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  options?: AuthzWriteOptions,
): Promise<void> {
  if (
    !(await authz.hasRole(
      ctx,
      authzUserId(userId),
      'member',
      organizerScope(organizerId),
    ))
  ) {
    return; // idempotent
  }
  await authz.revokeRole(
    ctx,
    authzUserId(userId),
    'member',
    organizerScope(organizerId),
    options?.actorId,
  );
}

/**
 * Grant community admin role AND ensure member edge for a user in an organizer scope.
 *
 * Idempotent. Returns booleans indicating which edges were newly created so callers
 * can gate audit logs, rate limits, and side effects (directory, marketing) on real changes.
 *
 * Preserves the invariant that a community admin is always also a community member.
 */
export async function grantCommunityAdminMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  opts: {actorId: Id<'users'>},
): Promise<{roleAdded: boolean; memberAdded: boolean}> {
  const scope = organizerScope(organizerId);
  const [hasRole, hasMember] = await Promise.all([
    authz.hasRole(ctx, authzUserId(userId), 'community_admin', scope),
    authz.hasRole(ctx, authzUserId(userId), 'member', scope),
  ]);

  if (!hasRole) {
    await authz.assignRole(
      ctx,
      authzUserId(userId),
      'community_admin',
      scope,
      undefined,
      authzUserId(opts.actorId),
    );
  }
  if (!hasMember) {
    await addMember(ctx, userId, organizerId, {
      actorId: opts.actorId,
    });
  }

  return {roleAdded: !hasRole, memberAdded: !hasMember};
}

/**
 * Revoke the community admin role. Leaves the member edge intact — a demoted admin
 * remains a community member.
 */
export async function revokeCommunityAdminRole(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  opts: {actorId: Id<'users'>},
): Promise<{roleRemoved: boolean}> {
  const scope = organizerScope(organizerId);
  const hasRole = await authz.hasRole(
    ctx,
    authzUserId(userId),
    'community_admin',
    scope,
  );
  if (!hasRole) return {roleRemoved: false};
  await authz.revokeRole(
    ctx,
    authzUserId(userId),
    'community_admin',
    scope,
    authzUserId(opts.actorId),
  );
  return {roleRemoved: true};
}

/**
 * Grant the community scanner role. Scanner is a single-edge role (no member coupling).
 */
export async function grantCommunityScannerRole(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  opts: {actorId: Id<'users'>},
): Promise<{roleAdded: boolean}> {
  const scope = organizerScope(organizerId);
  const hasRole = await authz.hasRole(
    ctx,
    authzUserId(userId),
    'community_scanner',
    scope,
  );
  if (hasRole) return {roleAdded: false};
  await authz.assignRole(
    ctx,
    authzUserId(userId),
    'community_scanner',
    scope,
    undefined,
    authzUserId(opts.actorId),
  );
  return {roleAdded: true};
}

/**
 * Revoke the community scanner role. Idempotent; returns whether the role was present.
 */
export async function revokeCommunityScannerRole(
  ctx: MutationCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  opts: {actorId: Id<'users'>},
): Promise<{roleRemoved: boolean}> {
  const scope = organizerScope(organizerId);
  const hasRole = await authz.hasRole(
    ctx,
    authzUserId(userId),
    'community_scanner',
    scope,
  );
  if (!hasRole) return {roleRemoved: false};
  await authz.revokeRole(
    ctx,
    authzUserId(userId),
    'community_scanner',
    scope,
    authzUserId(opts.actorId),
  );
  return {roleRemoved: true};
}

export async function addTrustLink(
  ctx: MutationCtx,
  trustingOrgId: Id<'organizers'>,
  trustedOrgId: Id<'organizers'>,
  options?: AuthzWriteOptions,
): Promise<void> {
  await authz.addRelation(
    ctx,
    {type: 'organizer', id: trustingOrgId as string},
    'trusts',
    {type: 'organizer', id: trustedOrgId as string},
    {createdBy: options?.actorId},
  );
  await upsertTrustLinkProjection(ctx, trustingOrgId, trustedOrgId);
}

export async function removeTrustLink(
  ctx: MutationCtx,
  trustingOrgId: Id<'organizers'>,
  trustedOrgId: Id<'organizers'>,
  options?: AuthzWriteOptions,
): Promise<void> {
  await authz.removeRelation(
    ctx,
    {type: 'organizer', id: trustingOrgId as string},
    'trusts',
    {type: 'organizer', id: trustedOrgId as string},
    options?.actorId,
  );
  await deleteTrustLinkProjection(ctx, trustingOrgId, trustedOrgId);
}

export async function listCommunityAdminIds(
  ctx: AuthzQueryCtx,
  organizerId: Id<'organizers'>,
): Promise<Id<'users'>[]> {
  const userIds = await listRoleUserIds(
    ctx,
    'community_admin',
    organizerScope(organizerId),
  );
  return userIds.map((userId) => userId as Id<'users'>);
}

export async function listCommunityScannerIds(
  ctx: AuthzQueryCtx,
  organizerId: Id<'organizers'>,
): Promise<Id<'users'>[]> {
  const userIds = await listRoleUserIds(
    ctx,
    'community_scanner',
    organizerScope(organizerId),
  );
  return userIds.map((userId) => userId as Id<'users'>);
}

export async function getCommunityMembers(
  ctx: AuthzCtx,
  organizerId: Id<'organizers'>,
): Promise<Doc<'users'>[]> {
  const memberIds = await listOrganizerMembers(ctx, organizerId);
  const users = await Promise.all(
    memberIds.map((id) => ctx.db.get('users', id as Id<'users'>)),
  );
  return users.filter((user): user is Doc<'users'> => user !== null);
}

export async function getUserCommunities(
  ctx: AuthzCtx,
  userId: Id<'users'>,
): Promise<Id<'organizers'>[]> {
  const roles = await authz.getUserRoles(ctx, authzUserId(userId));
  const organizerIds = new Set<Id<'organizers'>>();

  for (const role of roles) {
    if (role.role !== 'community_admin') {
      continue;
    }

    if (role.scope?.type === 'organizer') {
      organizerIds.add(role.scope.id as Id<'organizers'>);
    }
  }

  return [...organizerIds];
}

/**
 * Whether a user currently holds the 'member' role in an organizer.
 *
 * Used by the magic link redemption flow to distinguish between
 * "already redeemed but still a member" and "redeemed then removed".
 */
export async function isCommunityMember(
  ctx: AuthzCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return authz.hasRole(
    ctx,
    authzUserId(userId),
    'member',
    organizerScope(organizerId),
  );
}

/**
 * Whether a user currently holds the 'community_admin' role in an organizer.
 *
 * Used by the community admin grant/revoke flow to short-circuit idempotent
 * operations without leaking role membership through observable response
 * differences.
 */
export async function isCommunityAdmin(
  ctx: AuthzCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return authz.hasRole(
    ctx,
    authzUserId(userId),
    'community_admin',
    organizerScope(organizerId),
  );
}

/**
 * Whether a user currently holds the 'community_scanner' role in an organizer.
 *
 * Used by the community scanner grant/revoke flow to short-circuit idempotent
 * operations without leaking role membership through observable response
 * differences.
 */
export async function isCommunityScanner(
  ctx: AuthzCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return authz.hasRole(
    ctx,
    authzUserId(userId),
    'community_scanner',
    organizerScope(organizerId),
  );
}
