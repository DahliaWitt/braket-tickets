import {v} from 'convex/values';
import {mutation} from '../../_generated/server';
import {
  inviteToExisting as inviteToExistingImpl,
  redeemInvite as redeemInviteImpl,
} from './_impl/invites';

/**
 * Invite someone to be a community admin for an EXISTING community.
 * Community admin or root admin can call this.
 * If the email is already a registered user, prefer granting organizer admin via
 * the authz-backed `communities/admins.grant` mutation instead.
 * This is the fallback for when the user doesn't exist yet.
 */
export const inviteToExisting = mutation({
  args: {
    email: v.string(),
    organizerId: v.id('organizers'),
  },
  returns: v.object({
    inviteId: v.id('admin_invites'),
    inviteUrl: v.string(),
  }),
  handler: inviteToExistingImpl,
});

/**
 * Redeem an admin invite token. Authenticated user only.
 * Grants community_admin role for the invite's organizer to the caller.
 */
export const redeem = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    organizerId: v.id('organizers'),
  }),
  handler: redeemInviteImpl,
});
