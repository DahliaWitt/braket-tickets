import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {removeMember} from '../../lib/authz';
import {requireManageCommunity} from '../../lib/access';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {
  buildApplicationRevocationPatch,
  assertValidApplicationRevocationTransition,
} from '../../lib/application_transitions';
import {refreshOrganizerDirectoryForMembershipChange} from './organizer_directory';

type MembershipMutationCtx = MutationCtx;

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

  await removeMember(ctx, args.userId, args.organizerId, {
    actorId: args.adminId,
  });
  await refreshOrganizerDirectoryForMembershipChange(ctx, {
    organizerId: args.organizerId,
    userId: args.userId,
  });

  await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: 'user.revoke',
    source: 'admin-ui',
    organizerId: args.organizerId,
  });
}
