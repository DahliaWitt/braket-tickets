import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {adminInviteTemplate} from '../email/templates';
import {insertAdminAuditLog} from './admin_audit_log';
import {enqueueEmailDelivery} from './email_delivery_wrapper';
import {collectMatchingInQuery} from './query_scan';
import {resolveSiteUrl} from './site_url';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from './token_digests';
import {validateEmail} from './validation';

export const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function cancelPendingInvitesCreatedBy(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    invitedBy: Id<'users'>;
  },
): Promise<number> {
  const pendingInvites = await collectMatchingInQuery(
    ctx.db
      .query('admin_invites')
      .withIndex('by_organizer', (q) => q.eq('organizerId', args.organizerId)),
    (invite) =>
      invite.invitedBy === args.invitedBy && invite.status === 'pending',
  );

  await Promise.all(
    pendingInvites.map((invite) =>
      ctx.db.patch('admin_invites', invite._id, {status: 'cancelled'}),
    ),
  );

  return pendingInvites.length;
}

export function normalizeInviteEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  validateEmail(normalizedEmail, 'Email');
  return normalizedEmail;
}

export async function createAndSendAdminInvite(
  ctx: MutationCtx,
  args: {
    email: string;
    organizerId: Id<'organizers'>;
    communityName: string;
    invitedBy: Id<'users'>;
    inviterName: string;
  },
): Promise<{inviteId: Id<'admin_invites'>; inviteUrl: string}> {
  const token = generateBearerToken();
  const tokenDigest = await digestBearerToken('admin_invite', token);

  const inviteId = await ctx.db.insert('admin_invites', {
    email: args.email,
    organizerId: args.organizerId,
    communityName: args.communityName,
    tokenDigest,
    tokenPrefix: tokenPrefix(token),
    invitedBy: args.invitedBy,
    status: 'pending',
    expiresAt: Date.now() + ADMIN_INVITE_TTL_MS,
  });

  const redeemUrl = `${resolveSiteUrl()}/admin-invite/${token}`;
  const {subject, html} = adminInviteTemplate(
    args.communityName,
    redeemUrl,
    args.inviterName,
  );

  await enqueueEmailDelivery(
    ctx,
    {to: args.email, subject, html},
    {
      source: 'admin_invite',
      sourceId: inviteId as string,
      recipient: args.email,
    },
  );

  await insertAdminAuditLog(ctx, {
    adminId: args.invitedBy,
    action: 'admin_invite.create',
    organizerId: args.organizerId,
    source: `email:${args.email} invite:${inviteId}`,
  });

  return {inviteId, inviteUrl: redeemUrl};
}
