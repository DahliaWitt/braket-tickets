import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {requireUser} from '../../lib/auth_identity';
import {
  grantCommunityAdminMembership,
  revokeCommunityAdminRole,
  listCommunityAdminIds,
  getUserCommunities,
  isCommunityAdmin,
  isCommunityMember,
  isCommunityScanner,
  revokeCommunityScannerRole,
} from '../../lib/authz';
import {
  canManageCommunity,
  isPlatformAdmin,
  requirePlatformAdmin,
  requireManageCommunity,
} from '../../lib/access';
import {rateLimiter} from '../../lib/rate_limits';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {cancelPendingInvitesCreatedBy} from '../../lib/admin_invites';
import {ensureApprovedMarketingPreference} from '../../lib/marketing_emails/preferences';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {
  recomputeOrganizerDirectoryRow,
  refreshOrganizerDirectoryForMembershipChange,
} from '../../lib/users/organizer_directory';
import {throwAppError} from '../../lib/errors';
import {
  buildCommunityUserRows,
  type CommunityUserRow,
} from '../../lib/users/helpers';
import {deactivateActiveMagicLinksForCreator} from '../../lib/magic_links/deactivation';

async function requireCommunityAdminOrganizerTarget(
  ctx: MutationCtx,
  args: {
    callerId: Id<'users'>;
    organizerId?: Id<'organizers'>;
    actionLabel: 'granting' | 'revoking';
  },
): Promise<Id<'organizers'>> {
  if (!args.organizerId) {
    await requirePlatformAdmin(ctx, args.callerId);
    throwAppError(
      'MISSING_ORGANIZER',
      `Select a community before ${args.actionLabel} the community admin role.`,
    );
  }

  return args.organizerId;
}

export async function grantCommunityAdmin(
  ctx: MutationCtx,
  args: {userId: Id<'users'>; organizerId?: Id<'organizers'>},
): Promise<null> {
  const {_id: callerId} = await requireUser(ctx);

  const organizerId = await requireCommunityAdminOrganizerTarget(ctx, {
    callerId,
    organizerId: args.organizerId,
    actionLabel: 'granting',
  });
  await requireManageCommunity(ctx, callerId, organizerId);

  const [hasRole, hasMember] = await Promise.all([
    isCommunityAdmin(ctx, args.userId, organizerId),
    isCommunityMember(ctx, args.userId, organizerId),
  ]);
  const hasScannerRole = await isCommunityScanner(
    ctx,
    args.userId,
    organizerId,
  );
  const roleAdded = !hasRole;
  const memberAdded = !hasMember;

  if (!roleAdded && !memberAdded && !hasScannerRole) {
    return null;
  }

  await rateLimiter.limit(ctx, 'grantCommunityAdmin', {
    key: callerId,
    throws: true,
  });

  await grantCommunityAdminMembership(ctx, args.userId, organizerId, {
    actorId: callerId,
  });

  if (hasScannerRole) {
    await revokeCommunityScannerRole(ctx, args.userId, organizerId, {
      actorId: callerId,
    });
  }

  if (memberAdded) {
    await ensureApprovedMarketingPreference(ctx.db, {
      userId: args.userId,
      organizerId,
    });
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId,
      userId: args.userId,
    });
  }

  if (roleAdded) {
    await insertAdminAuditLog(
      {db: ctx.db, meta: ctx.meta},
      {
        adminId: callerId,
        action: 'community_admin.grant',
        organizerId,
        targetUserId: args.userId,
      },
    );
  } else if (memberAdded) {
    await insertAdminAuditLog(
      {db: ctx.db, meta: ctx.meta},
      {
        adminId: callerId,
        action: 'community_admin.member_repair',
        organizerId,
        targetUserId: args.userId,
      },
    );
  }

  return null;
}

export async function revokeCommunityAdmin(
  ctx: MutationCtx,
  args: {userId: Id<'users'>; organizerId?: Id<'organizers'>},
): Promise<null> {
  const {_id: callerId} = await requireUser(ctx);

  const organizerId = await requireCommunityAdminOrganizerTarget(ctx, {
    callerId,
    organizerId: args.organizerId,
    actionLabel: 'revoking',
  });
  const isSelfResign = callerId === args.userId;
  if (!isSelfResign) {
    await requireManageCommunity(ctx, callerId, organizerId);
  }

  const allAdmins = await listCommunityAdminIds(ctx, organizerId);
  if (allAdmins.length <= 1 && allAdmins.includes(args.userId)) {
    throwAppError(
      'LAST_ADMIN',
      'Cannot remove the last admin. Contact support to delete this community.',
    );
  }

  const roleRemoved = await isCommunityAdmin(ctx, args.userId, organizerId);
  if (!roleRemoved) return null;

  await rateLimiter.limit(ctx, 'revokeCommunityAdmin', {
    key: callerId,
    throws: true,
  });

  await revokeCommunityAdminRole(ctx, args.userId, organizerId, {
    actorId: callerId,
  });
  if (!(await canManageCommunity(ctx, args.userId, organizerId))) {
    await Promise.all([
      cancelPendingInvitesCreatedBy(ctx, {
        organizerId,
        invitedBy: args.userId,
      }),
      deactivateActiveMagicLinksForCreator(ctx, {
        organizerId,
        creatorId: args.userId,
      }),
    ]);
  }

  await recomputeOrganizerDirectoryRow(ctx, {
    organizerId,
    userId: args.userId,
  });

  const notifPref = await ctx.db
    .query('adminNotificationPreferences')
    .withIndex('by_user_and_community', (q) =>
      q.eq('userId', args.userId).eq('organizerId', organizerId),
    )
    .first();
  if (notifPref) {
    await ctx.db.delete('adminNotificationPreferences', notifPref._id);
  }

  const [targetUser, remainingCommunityIds, targetIsPlatformAdmin] =
    await Promise.all([
      ctx.db.get('users', args.userId),
      getUserCommunities(ctx, args.userId),
      isPlatformAdmin(ctx, args.userId),
    ]);
  if (
    targetUser?.defaultCommunityAdminOrganizerId === organizerId &&
    !targetIsPlatformAdmin &&
    !remainingCommunityIds.includes(organizerId)
  ) {
    await ctx.db.patch('users', args.userId, {
      defaultCommunityAdminOrganizerId: undefined,
    });
  }

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: callerId,
      action: 'community_admin.revoke',
      organizerId,
      targetUserId: args.userId,
    },
  );

  return null;
}

export async function listCommunityAdmins(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<CommunityUserRow[]> {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.organizerId);
  return await buildCommunityUserRows(
    ctx,
    args.organizerId,
    await listCommunityAdminIds(ctx, args.organizerId),
  );
}

export async function listMyCommunityIds(
  ctx: QueryCtx,
): Promise<Id<'organizers'>[]> {
  const {_id: callerId} = await requireUser(ctx);

  if (await isPlatformAdmin(ctx, callerId)) {
    // Platform admins need the exact organizer id set for the admin picker.
    const all = await collectAllQueryUnsafe(ctx.db.query('organizers'));
    return all.map((organizer) => organizer._id);
  }

  return await getUserCommunities(ctx, callerId);
}

export async function isCommunityMemberOf(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<boolean> {
  const {_id: callerId} = await requireUser(ctx);
  return await isCommunityMember(ctx, callerId, args.organizerId);
}
