import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {addMember, isCommunityMember} from '../../lib/authz';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {logger} from '../../lib/logger';
import {loadFirstMagicLinkByToken} from '../../lib/indexed_loaders';
import {ensureApprovedMarketingPreference} from '../marketing_emails/preferences';
import {evaluateMagicLinkState} from './validation';
import {refreshOrganizerDirectoryForMembershipChange} from '../users/organizer_directory';
import {throwAppError} from '../errors';
import {canManageCommunity} from '../access';
import {digestBearerToken, tokenPrefix} from '../token_digests';

type RedemptionCtx = MutationCtx;

type RedeemResult = {
  success: boolean;
  alreadyRedeemed: boolean;
  alreadyMember: boolean;
  message: string;
};

export function logRedemptionFailure(token: string, reason: string): void {
  logger.warn('magic_links', '[SECURITY:REDEEM_FAILED]', {
    reason,
    tokenPrefix: token.slice(0, 8),
    timestamp: Date.now(),
  });
}

async function getExistingRedemption(
  ctx: RedemptionCtx,
  linkId: Id<'magic_links'>,
  userId: Id<'users'>,
): Promise<Doc<'magic_link_redemption_log'> | null> {
  return await ctx.db
    .query('magic_link_redemption_log')
    .withIndex('by_magicLink_user', (q) =>
      q.eq('magicLinkId', linkId).eq('userId', userId),
    )
    .first();
}

function getRedemptionErrorMessage(
  reason: 'invalid' | 'paused' | 'disabled' | 'expired' | 'maxed',
): string {
  switch (reason) {
    case 'invalid':
      return 'This link does not exist or has been removed';
    case 'paused':
      return 'This link has been temporarily paused';
    case 'disabled':
      return 'This link is no longer active';
    case 'expired':
      return 'This link has expired';
    case 'maxed':
      return 'This link has reached its maximum redemptions';
  }
}

async function ensureMarketingOptIn(
  ctx: RedemptionCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await ensureApprovedMarketingPreference(ctx.db, {
    organizerId,
    userId,
  });
}

export async function redeemMagicLink(
  ctx: RedemptionCtx,
  userId: Id<'users'>,
  token: string,
): Promise<RedeemResult> {
  const link = await loadFirstMagicLinkByToken(ctx.db, token);
  const now = Date.now();
  const evaluation = await evaluateMagicLinkState(ctx.db, link, now);
  if (!evaluation.valid) {
    logRedemptionFailure(token, evaluation.error);
    throwAppError(
      `MAGIC_LINK_${evaluation.error.toUpperCase()}`,
      getRedemptionErrorMessage(evaluation.error),
      {reason: evaluation.error},
    );
  }

  const linkDoc = evaluation.link;
  if (!linkDoc.tokenDigest && linkDoc.token === token) {
    await ctx.db.patch('magic_links', linkDoc._id, {
      tokenDigest: await digestBearerToken('magic_link', token),
      tokenPrefix: tokenPrefix(token),
      token: undefined,
    });
  }
  const organizerId = linkDoc.organizerId;
  if (!(await canManageCommunity(ctx, linkDoc.createdBy, organizerId))) {
    logRedemptionFailure(token, 'disabled');
    throwAppError(
      'MAGIC_LINK_DISABLED',
      getRedemptionErrorMessage('disabled'),
      {
        reason: 'disabled',
      },
    );
  }

  const existing = await getExistingRedemption(ctx, linkDoc._id, userId);
  if (existing) {
    const alreadyMember = await isCommunityMember(ctx, userId, organizerId);
    return {
      success: true,
      alreadyRedeemed: true,
      alreadyMember,
      message: alreadyMember
        ? 'You are already a member of this community.'
        : "You've already used this link",
    };
  }

  const alreadyMember = await isCommunityMember(ctx, userId, organizerId);
  await addMember(ctx, userId, organizerId, {actorId: userId});

  await ctx.db.insert('magic_link_redemption_log', {
    magicLinkId: linkDoc._id,
    userId,
    redeemedAt: now,
  });
  await ensureMarketingOptIn(ctx, userId, organizerId);
  await refreshOrganizerDirectoryForMembershipChange(ctx, {
    organizerId,
    userId,
  });

  await insertAdminAuditLog(ctx, {
    adminId: linkDoc.createdBy,
    action: 'magic_link.redemption',
    source: `redeemer:${userId} link:${linkDoc._id} community_admin:${linkDoc.createdBy}`,
    magicLinkId: linkDoc._id,
    organizerId,
  });

  return {
    success: true,
    alreadyRedeemed: false,
    alreadyMember,
    message: alreadyMember
      ? 'You are already a member of this community.'
      : 'Welcome! You are now part of the community.',
  };
}
