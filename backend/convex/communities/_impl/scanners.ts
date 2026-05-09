import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {requireUser} from '../../lib/auth_identity';
import {
  authz,
  authzUserId,
  grantCommunityScannerRole,
  isCommunityAdmin,
  isCommunityScanner,
  listCommunityScannerIds,
  revokeCommunityScannerRole,
} from '../../lib/authz';
import {requireManageCommunity} from '../../lib/access';
import {rateLimiter} from '../../lib/rate_limits';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {mapEventsWithPosterUrls} from '../../lib/events/read_models';
import {buildCommunityUserRows} from '../../lib/users/helpers';
import {throwAppError} from '../../lib/errors';

export async function grantCommunityScanner(
  ctx: MutationCtx,
  args: {userId: Id<'users'>; organizerId: Id<'organizers'>},
): Promise<null> {
  const {_id: callerId} = await requireUser(ctx);

  await requireManageCommunity(ctx, callerId, args.organizerId);

  if (await isCommunityAdmin(ctx, args.userId, args.organizerId)) {
    throwAppError(
      'ALREADY_COMMUNITY_ADMIN',
      'This user is already an admin. Admins can already check in guests.',
    );
  }

  const roleAdded = !(await isCommunityScanner(
    ctx,
    args.userId,
    args.organizerId,
  ));
  if (!roleAdded) return null;

  await rateLimiter.limit(ctx, 'grantCommunityScanner', {
    key: callerId,
    throws: true,
  });

  await grantCommunityScannerRole(ctx, args.userId, args.organizerId, {
    actorId: callerId,
  });

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: callerId,
      action: 'community_scanner.grant',
      organizerId: args.organizerId,
      source: `target:${args.userId}`,
    },
  );

  return null;
}

export async function revokeCommunityScanner(
  ctx: MutationCtx,
  args: {userId: Id<'users'>; organizerId: Id<'organizers'>},
): Promise<null> {
  const {_id: callerId} = await requireUser(ctx);

  const isSelfResign = callerId === args.userId;
  if (!isSelfResign) {
    await requireManageCommunity(ctx, callerId, args.organizerId);
  }

  const roleRemoved = await isCommunityScanner(
    ctx,
    args.userId,
    args.organizerId,
  );
  if (!roleRemoved) return null;

  await rateLimiter.limit(ctx, 'revokeCommunityScanner', {
    key: callerId,
    throws: true,
  });

  await revokeCommunityScannerRole(ctx, args.userId, args.organizerId, {
    actorId: callerId,
  });

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: callerId,
      action: 'community_scanner.revoke',
      organizerId: args.organizerId,
      source: `target:${args.userId}`,
    },
  );

  return null;
}

export async function listCommunityScanners(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<
  Array<{
    _id: Id<'users'>;
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
    displayName: string;
    email?: string;
  }>
> {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.organizerId);
  return await buildCommunityUserRows(
    ctx,
    args.organizerId,
    await listCommunityScannerIds(ctx, args.organizerId),
  );
}

async function getScannableCommunityIds(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<Id<'organizers'>[]> {
  const roles = await authz.getUserRoles(ctx, authzUserId(userId));
  const organizerIds = new Set<Id<'organizers'>>();

  for (const role of roles) {
    if (role.role !== 'community_scanner' && role.role !== 'community_admin') {
      continue;
    }
    if (role.scope?.type !== 'organizer') {
      continue;
    }
    organizerIds.add(role.scope.id as Id<'organizers'>);
  }

  return [...organizerIds];
}

export async function hasAnyAssignment(ctx: QueryCtx): Promise<boolean> {
  const {_id: callerId} = await requireUser(ctx);
  return (await getScannableCommunityIds(ctx, callerId)).length > 0;
}

export async function listMyScannerEvents(
  ctx: QueryCtx,
): Promise<Awaited<ReturnType<typeof mapEventsWithPosterUrls>>> {
  const {_id: callerId} = await requireUser(ctx);

  const organizerIds = await getScannableCommunityIds(ctx, callerId);
  if (organizerIds.length === 0) return [];

  const eventArrays = await Promise.all(
    organizerIds.map((organizerId) =>
      ctx.db
        .query('events')
        .withIndex('by_organizer_status', (q) =>
          q.eq('organizerId', organizerId).eq('status', 'published'),
        )
        .take(200),
    ),
  );

  return await mapEventsWithPosterUrls(ctx, eventArrays.flat());
}
