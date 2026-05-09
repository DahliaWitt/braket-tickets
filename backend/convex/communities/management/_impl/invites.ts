import type {Doc, Id} from '../../../_generated/dataModel';
import type {MutationCtx} from '../../../_generated/server';
import {requireUser} from '../../../lib/auth_identity';
import {grantCommunityAdminMembership} from '../../../lib/authz';
import {canManageCommunity, requireManageCommunity} from '../../../lib/access';
import {rateLimiter} from '../../../lib/rate_limits';
import {findMatchingInQuery} from '../../../lib/query_scan';
import {insertAdminAuditLog} from '../../../lib/admin_audit_log';
import {
  createAndSendAdminInvite,
  normalizeInviteEmail,
} from '../../../lib/admin_invites';
import {ensureApprovedMarketingPreference} from '../../../lib/marketing_emails/preferences';
import {refreshOrganizerDirectoryForMembershipChange} from '../../../lib/users/organizer_directory';
import {throwAppError} from '../../../lib/errors';
import {digestBearerToken, tokenPrefix} from '../../../lib/token_digests';

async function findAdminInviteByPresentedToken(
  ctx: MutationCtx,
  token: string,
): Promise<Doc<'admin_invites'> | null> {
  const tokenDigest = await digestBearerToken('admin_invite', token);
  const byDigest = await ctx.db
    .query('admin_invites')
    .withIndex('by_tokenDigest', (q) => q.eq('tokenDigest', tokenDigest))
    .first();
  if (byDigest) return byDigest;

  const legacy = await ctx.db
    .query('admin_invites')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();
  if (!legacy) return null;

  await ctx.db.patch('admin_invites', legacy._id, {
    tokenDigest,
    tokenPrefix: tokenPrefix(token),
    token: undefined,
  });
  return legacy;
}

export async function inviteToExisting(
  ctx: MutationCtx,
  args: {
    email: string;
    organizerId: Id<'organizers'>;
  },
): Promise<{inviteId: Id<'admin_invites'>; inviteUrl: string}> {
  const {_id: userId, name: callerName} = await requireUser(ctx);

  // Platform admins pass requireManageCommunity via global-scope fallback.
  await requireManageCommunity(ctx, userId, args.organizerId);

  await rateLimiter.limit(ctx, 'inviteAdminToExisting', {
    key: userId,
    throws: true,
  });

  const email = normalizeInviteEmail(args.email);

  const existingInvite = await findMatchingInQuery(
    ctx.db
      .query('admin_invites')
      .withIndex('by_email', (q) => q.eq('email', email)),
    (invite) =>
      invite.organizerId === args.organizerId && invite.status === 'pending',
  );
  if (existingInvite) {
    throwAppError('CONFLICT', 'A pending invite already exists for this email');
  }

  const organizer = await ctx.db.get('organizers', args.organizerId);
  if (!organizer) {
    throwAppError('NOT_FOUND', 'Community not found');
  }

  return await createAndSendAdminInvite(ctx, {
    email,
    organizerId: args.organizerId,
    communityName: organizer.name,
    invitedBy: userId,
    inviterName: callerName ?? 'Braket Admin',
  });
}

export async function redeemInvite(
  ctx: MutationCtx,
  args: {
    token: string;
  },
): Promise<{organizerId: Id<'organizers'>}> {
  const {_id: userId, email: userEmailRaw} = await requireUser(ctx);

  await rateLimiter.limit(ctx, 'redeemAdminInvite', {
    key: userId,
    throws: true,
  });

  const invite = await findAdminInviteByPresentedToken(ctx, args.token);

  if (!invite) {
    throwAppError(
      'INVALID_TOKEN',
      'This invitation does not exist or has already been used',
    );
  }

  // LINT.IfChange
  if (invite.status === 'cancelled') {
    throwAppError('INVITE_CANCELLED', 'This invitation has been cancelled');
  }

  if (invite.status === 'redeemed') {
    throwAppError(
      'INVITE_ALREADY_REDEEMED',
      'This invitation has already been redeemed',
    );
  }

  if (invite.expiresAt < Date.now()) {
    throwAppError('INVITE_EXPIRED', 'This invitation has expired');
  }

  const userEmail = (userEmailRaw ?? '').toLowerCase();
  if (userEmail !== invite.email) {
    throwAppError(
      'EMAIL_MISMATCH',
      'This invitation was sent to a different email address',
    );
  }

  if (!(await canManageCommunity(ctx, invite.invitedBy, invite.organizerId))) {
    throwAppError('INVITE_CANCELLED', 'This invitation has been cancelled');
  }
  // LINT.ThenChange("../../../../../frontend/src/app/features/invite-redeem/invite-redeem.component.ts")

  await grantCommunityAdminMembership(ctx, userId, invite.organizerId, {
    actorId: invite.invitedBy,
  });
  await ensureApprovedMarketingPreference(ctx.db, {
    userId,
    organizerId: invite.organizerId,
  });
  await refreshOrganizerDirectoryForMembershipChange(ctx, {
    organizerId: invite.organizerId,
    userId,
  });

  await ctx.db.patch('admin_invites', invite._id, {
    status: 'redeemed',
    redeemedBy: userId,
    redeemedAt: Date.now(),
  });

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: invite.invitedBy,
      action: 'admin_invite.redeem',
      organizerId: invite.organizerId,
      source: `redeemer:${userId} invite:${invite._id}`,
    },
  );

  return {organizerId: invite.organizerId};
}
