import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  removeMember,
  isCommunityAdmin,
  listCommunityAdminIds,
  revokeCommunityAdminRole,
} from '../../lib/authz';
import {requireManageCommunity, canManageCommunity} from '../../lib/access';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {
  buildApplicationRevocationPatch,
  assertValidApplicationRevocationTransition,
} from '../../lib/application_transitions';
import {refreshOrganizerDirectoryForMembershipChange} from './organizer_directory';
import {cancelPendingInvitesCreatedBy} from '../../lib/admin_invites';
import {deactivateActiveMagicLinksForCreator} from '../../lib/magic_links/deactivation';
import {throwAppError} from '../../lib/errors';

type MembershipMutationCtx = MutationCtx;

/**
 * Cascades admin role revocation when a member is being removed from a community.
 *
 * If the user is a community_admin, this function:
 * 1. Blocks the revocation if they are the last admin (throws LAST_ADMIN).
 * 2. Revokes the community_admin role.
 * 3. If they lose manage access as a result, cancels their pending admin invites,
 *    deactivates their magic links, and deletes their admin notification preferences.
 * 4. Logs a community_admin.revoke audit entry.
 * 5. Calls removeMember to remove the member edge.
 *
 * Returns `{adminRevoked: boolean}` so callers can gate additional side effects.
 */
export async function removeMemberWithAdminCascade(
  ctx: MembershipMutationCtx,
  args: {
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
    actorId: Id<'users'>;
    auditSource?: string;
  },
): Promise<{adminRevoked: boolean}> {
  const isAdmin = await isCommunityAdmin(ctx, args.userId, args.organizerId);

  if (isAdmin) {
    const adminIds = await listCommunityAdminIds(ctx, args.organizerId);
    if (adminIds.length <= 1) {
      throwAppError(
        'LAST_ADMIN',
        'Cannot revoke membership for the last community admin. Assign another admin first.',
      );
    }

    await revokeCommunityAdminRole(ctx, args.userId, args.organizerId, {
      actorId: args.actorId,
    });

    const stillHasManage = await canManageCommunity(
      ctx,
      args.userId,
      args.organizerId,
    );
    if (!stillHasManage) {
      await Promise.all([
        cancelPendingInvitesCreatedBy(ctx, {
          organizerId: args.organizerId,
          invitedBy: args.userId,
        }),
        deactivateActiveMagicLinksForCreator(ctx, {
          organizerId: args.organizerId,
          creatorId: args.userId,
        }),
      ]);
    }

    // Notification preferences are tied to the admin role, not manage access.
    // Delete unconditionally — matches revokeCommunityAdmin in admins.ts.
    const prefs = await ctx.db
      .query('adminNotificationPreferences')
      .withIndex('by_user_and_community', (q) =>
        q.eq('userId', args.userId).eq('organizerId', args.organizerId),
      )
      .first();
    if (prefs) {
      await ctx.db.delete('adminNotificationPreferences', prefs._id);
    }

    await insertAdminAuditLog(ctx, {
      adminId: args.actorId,
      action: 'community_admin.revoke',
      organizerId: args.organizerId,
      source: args.auditSource ?? 'membership-cascade',
    });
  }

  await removeMember(ctx, args.userId, args.organizerId, {
    actorId: args.actorId,
  });

  return {adminRevoked: isAdmin};
}

export async function assertCanRevokeMembership(
  ctx: MembershipMutationCtx,
  args: {
    adminId: Id<'users'>;
    organizerId: Id<'organizers'>;
  },
) {
  // Platform admins pass requireManageCommunity via global-scope fallback.
  await requireManageCommunity(ctx, args.adminId, args.organizerId);
}

export async function revokeMembershipAndCreateAuditLog(
  ctx: MembershipMutationCtx,
  args: {
    adminId: Id<'users'>;
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
  },
) {
  const latestApplication = await getLatestApplicationForOrganizer(ctx, {
    userId: args.userId,
    organizerId: args.organizerId,
  });

  if (latestApplication) {
    if (latestApplication.status === 'approved') {
      assertValidApplicationRevocationTransition(latestApplication.status);
      await ctx.db.patch(
        'applications',
        latestApplication._id,
        buildApplicationRevocationPatch(args.adminId),
      );
    } else if (latestApplication.status !== 'revoked') {
      await ctx.db.insert('applications', {
        userId: args.userId,
        organizerId: args.organizerId,
        status: 'revoked',
        processedBy: args.adminId,
        answers: {},
      });
    }
  } else {
    await ctx.db.insert('applications', {
      userId: args.userId,
      organizerId: args.organizerId,
      status: 'revoked',
      processedBy: args.adminId,
      answers: {},
    });
  }

  await removeMemberWithAdminCascade(ctx, {
    userId: args.userId,
    organizerId: args.organizerId,
    actorId: args.adminId,
  });
  await refreshOrganizerDirectoryForMembershipChange(ctx, {
    organizerId: args.organizerId,
    userId: args.userId,
  });

  await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: 'user.revoke',
    targetUserId: args.userId,
    source: 'admin-ui',
    organizerId: args.organizerId,
  });
}
