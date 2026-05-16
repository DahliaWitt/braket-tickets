import {v} from 'convex/values';
import {mutation} from '../_generated/server';
import {requireUser} from '../lib/auth_identity';
import {requirePlatformAdmin, isPlatformAdmin} from '../lib/access';
import {insertAdminAuditLog} from '../lib/admin_audit_log';
import {
  createAndSendAdminInvite,
  normalizeInviteEmail,
} from '../lib/admin_invites';
import {throwAppError} from '../lib/errors';
import {rateLimiter} from '../lib/rate_limits';
import {prepareCommunityCreateData} from '../lib/communities/writes';

/**
 * Create a new community and admin invite in a single atomic mutation.
 * Root admin only. Schedules an invite email to the provided address.
 *
 * Returns the invite ID, organizer ID, and the full invite URL (already emailed to the recipient).
 */
export const createWithCommunity = mutation({
  args: {
    email: v.string(),
    communityName: v.string(),
  },
  returns: v.object({
    inviteId: v.id('admin_invites'),
    organizerId: v.id('organizers'),
    inviteUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    const {_id: userId, name: callerName} = await requireUser(ctx);

    await requirePlatformAdmin(ctx, userId);

    await rateLimiter.limit(ctx, 'createAdminInvite', {
      key: userId,
      throws: true,
    });

    const trimmedName = args.communityName.trim();
    if (!trimmedName) {
      throwAppError('INVALID_INPUT', 'Community name cannot be empty');
    }
    const email = normalizeInviteEmail(args.email);

    const organizerId = await ctx.db.insert(
      'organizers',
      await prepareCommunityCreateData(ctx.db, {name: trimmedName}),
    );

    const {inviteId, inviteUrl} = await createAndSendAdminInvite(ctx, {
      email,
      organizerId,
      communityName: trimmedName,
      invitedBy: userId,
      inviterName: callerName ?? 'Braket Admin',
    });

    return {inviteId, organizerId, inviteUrl};
  },
});

/**
 * Cancel a pending admin invite. Root admin only. Idempotent.
 * Non-pending invites are silently ignored (no error).
 */
export const cancel = mutation({
  args: {
    inviteId: v.id('admin_invites'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    if (!(await isPlatformAdmin(ctx, userId))) {
      throwAppError('FORBIDDEN', 'Only root admins can cancel invites');
    }

    const invite = await ctx.db.get('admin_invites', args.inviteId);
    if (!invite || invite.status !== 'pending') {
      return null;
    }

    await ctx.db.patch('admin_invites', args.inviteId, {
      status: 'cancelled',
    });

    await insertAdminAuditLog(ctx, {
      adminId: userId,
      action: 'admin_invite.cancel',
      organizerId: invite.organizerId,
      source: `invite:${args.inviteId}`,
    });

    return null;
  },
});
