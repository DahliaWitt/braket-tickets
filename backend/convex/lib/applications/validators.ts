import {v} from 'convex/values';
import {userProfileValidator} from '../users/validators';
import {vettingQuestionValidator} from '../communities/validators';
import {communityPublicationStatusValueValidator} from '../validators/communities';
import {
  applicationAnswersValidator,
  applicationStatusValidator,
} from '../../lib/validators/applications';

export {
  applicationAnswersValidator,
  applicationStatusValidator,
  type ApplicationStatus,
} from '../../lib/validators/applications';

export const applicationDocValidator = v.object({
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

export const applicationWithOrganizerValidator = v.object({
  _id: v.id('applications'),
  _creationTime: v.number(),
  organizerId: v.optional(v.id('organizers')),
  organizerName: v.string(),
  organizerSlug: v.optional(v.string()),
  organizerStatus: v.optional(communityPublicationStatusValueValidator),
  organizerLogoUrl: v.optional(v.string()),
  status: applicationStatusValidator,
  denyReason: v.optional(v.string()),
  reason: v.optional(v.string()),
});

export const applicationOrganizerValidator = v.object({
  _id: v.id('organizers'),
  _creationTime: v.number(),
  name: v.string(),
  email: v.optional(v.string()),
  contactInfo: v.optional(v.string()),
  vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
});

export const applicationListRowValidator = v.object({
  _id: v.id('applications'),
  _creationTime: v.number(),
  userId: v.id('users'),
  organizerId: v.optional(v.id('organizers')),
  status: applicationStatusValidator,
  processedBy: v.optional(v.id('users')),
  denyReason: v.optional(v.string()),
  reason: v.optional(v.string()),
  answers: applicationAnswersValidator,
  user: v.union(userProfileValidator, v.null()),
  processor: v.union(userProfileValidator, v.null()),
  organizer: v.union(applicationOrganizerValidator, v.null()),
});

export const applicationListPageValidator = v.object({
  page: v.array(applicationListRowValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
