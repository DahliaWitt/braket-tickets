import {v} from 'convex/values';
import {
  applicationAnswersValidator,
  applicationStatusValidator,
} from '../../lib/validators/applications';

export const userProfileFields = {
  _id: v.id('users'),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  betterAuthUserId: v.optional(v.string()),
  authEmailVerified: v.optional(v.boolean()),
  pendingEmail: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  termsAcceptedAt: v.optional(v.number()),
  socialSignupCompletionRequired: v.optional(v.boolean()),
  globalMarketingOptOut: v.optional(v.boolean()),
};

export const currentUserFields = {
  ...userProfileFields,
  isRootAdmin: v.boolean(),
  communityAdminOrganizerIds: v.array(v.id('organizers')),
  defaultCommunityAdminOrganizerId: v.optional(v.id('organizers')),
};

export const userProfileValidator = v.object(userProfileFields);

export const currentUserValidator = v.object({
  ...currentUserFields,
  id: v.id('users'),
});

export const internalUserValidator = v.object({
  ...userProfileFields,
  emailChangeToken: v.optional(v.string()),
  emailChangeTokenExpiry: v.optional(v.number()),
});

export const connectedAccountValidator = v.object({
  id: v.string(),
  provider: v.string(),
  providerId: v.string(),
  providerEmail: v.optional(v.string()),
  isEmailVerified: v.optional(v.boolean()),
  created: v.string(),
  updated: v.optional(v.string()),
});

export const communityAccessSourceValidator = v.union(
  v.literal('approved_application'),
  v.literal('magic_link'),
  v.literal('direct_member'),
  v.literal('shared'),
);

export const userApplicationValidator = v.object({
  _id: v.id('applications'),
  _creationTime: v.number(),
  userId: v.id('users'),
  organizerId: v.optional(v.id('organizers')),
  status: applicationStatusValidator,
  processedBy: v.optional(v.id('users')),
  denyReason: v.optional(v.string()),
  reason: v.optional(v.string()),
  answers: applicationAnswersValidator,
});

export const userApplicationRowValidator = v.object({
  user: userProfileValidator,
  application: v.union(userApplicationValidator, v.null()),
  isCommunityAdmin: v.optional(v.boolean()),
  communityAccessSource: v.optional(communityAccessSourceValidator),
  trustedViaOrganizerName: v.optional(v.string()),
});

export const userApplicationPageValidator = v.object({
  page: v.array(userApplicationRowValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const communityUserRowValidator = v.object({
  _id: v.id('users'),
  userId: v.id('users'),
  organizerId: v.id('organizers'),
  displayName: v.string(),
  email: v.optional(v.string()),
});
