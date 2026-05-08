/**
 * Public authentication utilities for Better Auth integration.
 *
 * These functions provide frontend-accessible wrappers for internal auth operations.
 */

import {v} from 'convex/values';

import {mutation} from '../_generated/server';
import {
  cancelEmailChangeHandler,
  changePasswordHandler,
  completeSocialSignupOnboardingHandler,
  linkSocialAccountHandler,
  requestEmailChangeHandler,
  setPasswordHandler,
  syncCurrentUserHandler,
  unlinkSocialAccountHandler,
} from './_impl/public';

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
