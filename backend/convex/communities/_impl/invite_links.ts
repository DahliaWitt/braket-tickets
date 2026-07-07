import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getAuthUserId, requireUser} from '../../lib/auth_identity';
import {canManageCommunity} from '../../lib/access';
import {
  throwForbidden,
  throwInvalidState,
  throwNotFound,
} from '../../lib/errors';
import {rateLimiter} from '../../lib/rate_limits';
import {
  createMagicLink,
  type MagicLinkCreateResult,
} from '../../lib/magic_links/creation';
import {
  type MagicLinkValidationResult,
  validateMagicLinkToken,
} from '../../lib/magic_links/validation';
import {redeemMagicLink} from '../../lib/magic_links/redemption';
import {
  getMagicLinksForCommunityAdmin,
  getPastMagicLinksForCommunityAdmin,
  resolveMagicLinkTransition,
  type MagicLinkStatusAction,
  type MagicLinksListItem,
  type PastMagicLinksListItem,
} from '../../lib/magic_links/read_models';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';

export async function validateTokenHandler(
  ctx: QueryCtx,
  args: {
    token: string;
    now?: number;
  },
): Promise<MagicLinkValidationResult> {
  return await validateMagicLinkToken(ctx.db, args);
}

export async function createMagicLinkHandler(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    label?: string;
    expiresAt?: number;
    maxRedemptions?: number;
  },
): Promise<MagicLinkCreateResult> {
  const actor = await requireUser(ctx);
  const actorId = actor._id;

  await rateLimiter.limit(ctx, 'createMagicLink', {
    key: actorId,
    throws: true,
  });

  const result = await createMagicLink(ctx, actor, args);

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: actorId,
      action: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_CREATE,
      organizerId: args.organizerId,
      magicLinkId: result.linkId,
      source: 'admin-ui',
    },
  );

  return result;
}

export async function redeemMagicLinkHandler(
  ctx: MutationCtx,
  args: {
    token: string;
  },
) {
  const {_id: userId} = await requireUser(ctx);

  await rateLimiter.limit(ctx, 'redeemMagicLink', {
    key: userId,
    throws: true,
  });

  return redeemMagicLink(ctx, userId, args.token);
}

const ACTION_TO_AUDIT: Record<
  MagicLinkStatusAction,
  (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS]
> = {
  pause: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_PAUSE,
  resume: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_RESUME,
  disable: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_DISABLE,
  delete: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_DELETE,
};

export async function updateMagicLinkStatusHandler(
  ctx: MutationCtx,
  args: {
    linkId: Id<'magic_links'>;
    action: MagicLinkStatusAction;
  },
): Promise<{success: boolean}> {
  const {_id: actorId} = await requireUser(ctx);

  const link = await ctx.db.get('magic_links', args.linkId);
  if (!link) throwNotFound('Link');
  if (link.deletedAt) throwInvalidState('Link has been deleted');

  const isAdmin = await canManageCommunity(ctx, actorId, link.organizerId);
  if (!isAdmin) {
    throwForbidden('Not authorized to modify this link');
  }
  // TODO: Revisit creator-status coupling for community-scoped magic links.
  // Current behavior disables management when the original creator loses access.
  if (!(await canManageCommunity(ctx, link.createdBy, link.organizerId))) {
    throwForbidden('The link creator no longer manages this community');
  }

  const transition = resolveMagicLinkTransition(link.status, args.action);
  await ctx.db.patch('magic_links', args.linkId, transition);

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: actorId,
      action: ACTION_TO_AUDIT[args.action],
      organizerId: link.organizerId,
      magicLinkId: args.linkId,
      source: 'admin-ui',
    },
  );

  return {success: true};
}

export async function listMyLinksHandler(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<MagicLinksListItem[]> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  return getMagicLinksForCommunityAdmin(ctx, userId, args.organizerId);
}

export async function listPastMyLinksHandler(
  ctx: QueryCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<PastMagicLinksListItem[]> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  return getPastMagicLinksForCommunityAdmin(ctx, userId, args.organizerId);
}
