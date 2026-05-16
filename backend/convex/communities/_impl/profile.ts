import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  requirePlatformAdmin,
  isPlatformAdmin,
  canManageCommunity,
} from '../../lib/access';
import {requireUser} from '../../lib/auth_identity';
import {derivePublicationStatus} from '../../lib/community_status';
import {rateLimiter} from '../../lib/rate_limits';
import {
  cascadeUnpublishEvents,
  deleteOrganizerTrustLinks,
} from '../../lib/communities/lifecycle';
import {mapAdminCommunitiesWithLogoUrls} from '../../lib/communities/read_models';
import {
  cleanupRemovedVettingQuestionAnswers,
  getRemovedVettingQuestionIds,
} from '../../lib/communities/vetting';
import {
  type CommunityCreateFields,
  type CommunityUpdateFields,
  buildCommunityUpdatePatch,
  prepareCommunityCreateData,
} from '../../lib/communities/writes';
import {throwAppError, throwInvalidState} from '../../lib/errors';
import {cleanupReplacedUpload} from '../../lib/upload_validation';

export async function getAdminCommunity(
  ctx: QueryCtx,
  args: {id: Id<'organizers'>},
) {
  const {_id: userId} = await requireUser(ctx);

  const organizer = await ctx.db.get('organizers', args.id);
  if (!organizer) return null;

  if (!(await canManageCommunity(ctx, userId, organizer._id))) {
    return null;
  }

  const [communityWithLogoUrl] = await mapAdminCommunitiesWithLogoUrls(ctx, [
    organizer,
  ]);
  return communityWithLogoUrl ?? null;
}

export async function createCommunity(
  ctx: MutationCtx,
  args: CommunityCreateFields,
): Promise<Id<'organizers'>> {
  const {_id: userId} = await requireUser(ctx);
  await requirePlatformAdmin(ctx, userId);

  const organizerId = await ctx.db.insert(
    'organizers',
    await prepareCommunityCreateData(ctx.db, args),
  );
  return organizerId;
}

export async function updateCommunity(
  ctx: MutationCtx,
  args: CommunityUpdateFields & {id: Id<'organizers'>},
): Promise<null> {
  const {_id: userId} = await requireUser(ctx);

  const organizer = await ctx.db.get('organizers', args.id);
  if (!organizer) {
    throwAppError('NOT_FOUND', 'Community not found');
  }

  if (!(await isPlatformAdmin(ctx, userId))) {
    const hasCommunityAdminAccess = await canManageCommunity(
      ctx,
      userId,
      args.id,
    );
    if (!hasCommunityAdminAccess) {
      throwAppError('NOT_FOUND', 'Community not found');
    }
  }

  await rateLimiter.limit(ctx, 'updateOrganizer', {
    key: userId,
    throws: true,
  });

  const updates = await buildCommunityUpdatePatch(
    ctx.db,
    ctx.db,
    userId,
    organizer,
    args.id,
    args,
  );

  if (Object.keys(updates).length > 0) {
    await ctx.db.patch('organizers', args.id, updates);
  }

  if (
    updates.logoStorageId !== undefined &&
    organizer.logoStorageId &&
    organizer.logoStorageId !== updates.logoStorageId
  ) {
    await cleanupReplacedUpload(ctx, organizer.logoStorageId);
  }

  if (args.status === 'draft') {
    const previousStatus = derivePublicationStatus(organizer);
    if (previousStatus === 'published') {
      const unpublishedCount = await cascadeUnpublishEvents({
        db: ctx.db,
        scheduler: ctx.scheduler,
        organizerId: args.id,
      });
      if (unpublishedCount > 0) {
        await insertAdminAuditLog(ctx, {
          adminId: userId,
          action: 'organizer.cascadeUnpublishEvents',
          organizerId: args.id,
          reason: `Unpublished ${unpublishedCount} event(s) due to community draft transition`,
        });
      }
    }
  }

  if (args.vettingQuestions !== undefined) {
    const removedIds = getRemovedVettingQuestionIds(
      organizer.vettingQuestions,
      args.vettingQuestions,
    );

    if (removedIds.length > 0) {
      const cleanedCount = await cleanupRemovedVettingQuestionAnswers(
        ctx.db,
        args.id,
        new Set(removedIds),
      );

      if (cleanedCount > 0) {
        await insertAdminAuditLog(ctx, {
          adminId: userId,
          action: 'organizer.cleanupOrphanedAnswers',
          organizerId: args.id,
          reason: `Cleaned ${cleanedCount} application(s): removed answer keys [${removedIds.join(', ')}]`,
        });
      }
    }
  }

  await insertAdminAuditLog(ctx, {
    adminId: userId,
    action: 'organizer.update',
    organizerId: args.id,
  });

  return null;
}

export async function removeCommunity(
  ctx: MutationCtx,
  args: {id: Id<'organizers'>},
): Promise<null> {
  const {_id: userId} = await requireUser(ctx);
  await requirePlatformAdmin(ctx, userId);

  const organizer = await ctx.db.get('organizers', args.id);
  if (!organizer) {
    throwAppError('NOT_FOUND', 'Community not found');
  }

  const events = await ctx.db
    .query('events')
    .withIndex('by_organizer_status', (q) => q.eq('organizerId', args.id))
    .first();

  if (events) {
    throwInvalidState('Cannot delete community with associated events');
  }

  await deleteOrganizerTrustLinks({
    ctx,
    db: ctx.db,
    adminId: userId,
    organizerId: args.id,
  });

  await ctx.db.delete('organizers', args.id);

  if (organizer.logoStorageId) {
    await cleanupReplacedUpload(ctx, organizer.logoStorageId);
  }

  return null;
}

export async function setPlatformOrganizer(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    isPlatformOrganizer: boolean;
  },
): Promise<null> {
  const {_id: userId} = await requireUser(ctx);
  await requirePlatformAdmin(ctx, userId);

  await ctx.db.patch('organizers', args.organizerId, {
    isPlatformOrganizer: args.isPlatformOrganizer,
  });

  await ctx.runMutation(internal.communities.management.audit.logAdminAccess, {
    adminId: userId,
    action: args.isPlatformOrganizer
      ? ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_TRUE
      : ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_FALSE,
    organizerId: args.organizerId,
    source: 'admin-ui',
  });

  return null;
}
