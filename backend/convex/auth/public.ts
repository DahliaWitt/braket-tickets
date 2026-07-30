/**
 * Public authentication utilities for Better Auth integration.
 *
 * These functions provide frontend-accessible wrappers for internal auth operations.
 */

import {v} from 'convex/values';

import {action, internalMutation, mutation} from '../_generated/server';
import {
  cancelEmailChangeHandler,
  changePasswordHandler,
  changePasswordV2Handler,
  completeSocialSignupOnboardingHandler,
  linkSocialAccountHandler,
  requestEmailChangeHandler,
  setPasswordHandler,
  syncCurrentUserHandler,
  unlinkSocialAccountHandler,
} from './_impl/public';
import {rateLimiter} from '../lib/rate_limits';

const socialProviderValidator = v.union(
  v.literal('google'),
  v.literal('discord'),
);

const socialSyncBlockedReasonValidator = v.union(
  v.literal('provider_email_missing'),
  v.literal('provider_email_unverified'),
);

export const syncCurrentUser = mutation({
  args: {},
  returns: v.object({
    status: v.union(v.literal('synced'), v.literal('blocked')),
    reason: v.optional(socialSyncBlockedReasonValidator),
    requiresSocialSignupCompletion: v.optional(v.boolean()),
  }),
  handler: syncCurrentUserHandler,
});

export const completeSocialSignupOnboarding = mutation({
  args: {},
  returns: v.null(),
  handler: completeSocialSignupOnboardingHandler,
});

export const changePassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
    revokeOtherSessions: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: changePasswordHandler,
});

/**
 * Action-based password change for the current client contract. Better Auth
 * uses scrypt password verification/hashing, which can exceed Convex's
 * one-second mutation budget. The legacy mutation above remains addressable
 * for stale generated clients but fails closed with a refresh instruction;
 * only this action services password changes and durably charges failed
 * current-password attempts against the rate limit.
 */
export const changePasswordV2 = action({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
    revokeOtherSessions: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: changePasswordV2Handler,
});

export const applyChangePasswordRateLimit = internalMutation({
  args: {userId: v.id('users')},
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimiter.limit(ctx, 'changePassword', {
      key: args.userId,
      throws: true,
    });
    return null;
  },
});

export const linkSocialAccount = mutation({
  args: {
    provider: socialProviderValidator,
    callbackURL: v.optional(v.string()),
  },
  returns: v.object({
    url: v.string(),
  }),
  handler: linkSocialAccountHandler,
});

export const unlinkSocialAccount = mutation({
  args: {
    provider: socialProviderValidator,
    accountId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: unlinkSocialAccountHandler,
});

export const setPassword = mutation({
  args: {
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: setPasswordHandler,
});

export const cancelEmailChange = mutation({
  args: {},
  returns: v.null(),
  handler: cancelEmailChangeHandler,
});

export const requestEmailChange = mutation({
  args: {
    newEmail: v.string(),
    callbackURL: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.optional(v.string()),
  }),
  handler: requestEmailChangeHandler,
});
