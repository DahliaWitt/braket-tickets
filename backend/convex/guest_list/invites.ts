'use node';

import {v} from 'convex/values';
import {internal} from '../_generated/api';
import {internalAction} from '../_generated/server';
import {sendEmailDeliveryNow} from '../lib/email_delivery_wrapper';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../lib/token_digests';
import {guestListInviteTemplate} from '../email/templates';

export const sendInviteAttempt = internalAction({
  args: {assignmentId: v.id('guestListAssignments'), attemptId: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = generateBearerToken();
    const prepared = await ctx.runMutation(
      internal.guest_list.invite_state.prepareAttempt,
      {
        assignmentId: args.assignmentId,
        attemptId: args.attemptId,
        tokenDigest: await digestBearerToken('guest_list_assignment', token),
        tokenPrefix: tokenPrefix(token),
      },
    );
    if (!prepared) return null;
    const attempt = await ctx.runQuery(
      internal.guest_list.invite_state.loadAttempt,
      args,
    );
    if (!attempt) {
      await ctx.runMutation(internal.guest_list.invite_state.abortAttempt, {
        ...args,
        failureCode: 'event_inactive',
      });
      return null;
    }
    try {
      const baseUrl = (process.env['SITE_URL'] ?? 'https://braket.gay').replace(
        /\/$/,
        '',
      );
      const url = `${baseUrl}/guest-list/manage#token=${encodeURIComponent(token)}`;
      const message = guestListInviteTemplate({
        displayName: attempt.displayName,
        eventTitle: attempt.eventTitle,
        manageUrl: url,
      });
      await sendEmailDeliveryNow(
        ctx,
        {
          to: attempt.email,
          subject: message.subject,
          html: message.html,
        },
        {
          source: 'guest_list_invite',
          sourceId: args.assignmentId,
          recipient: attempt.email,
          critical: true,
          requireDelivery: true,
        },
      );
      const promoted = await ctx.runMutation(
        internal.guest_list.invite_state.promoteAttempt,
        args,
      );
      if (!promoted) {
        await ctx.runMutation(internal.guest_list.invite_state.abortAttempt, {
          ...args,
          failureCode: 'event_inactive',
        });
      }
    } catch (error) {
      await ctx.runMutation(internal.guest_list.invite_state.failAttempt, {
        assignmentId: args.assignmentId,
        attemptId: args.attemptId,
        failureCode: error instanceof Error ? error.name : 'unknown',
      });
    }
    return null;
  },
});
