import {v} from 'convex/values';
import {mutation, query} from '../_generated/server';
import {
  applicationAnswersValidator,
  applicationDocValidator,
  applicationListRowValidator,
  applicationStatusValidator,
  applicationWithOrganizerValidator,
} from '../lib/applications/validators';
import {
  getMyApplication as getMyApplicationHandler,
  getMyApplicationForOrganizer as getMyApplicationForOrganizerHandler,
  getMyApplications as getMyApplicationsHandler,
  listApplications as listApplicationsHandler,
  revokeApplication as revokeApplicationHandler,
  reviewApplication as reviewApplicationHandler,
  submitApplication as submitApplicationHandler,
} from './_impl/applications';

export const submit = mutation({
  args: {
    organizerId: v.optional(v.id('organizers')),
    answers: applicationAnswersValidator,
  },
  returns: v.id('applications'),
  handler: submitApplicationHandler,
});

export const getMyApplication = query({
  args: {},
  returns: v.union(applicationDocValidator, v.null()),
  handler: getMyApplicationHandler,
});

export const getMyApplicationForOrganizer = query({
  args: {organizerId: v.id('organizers')},
  returns: v.union(applicationDocValidator, v.null()),
  handler: getMyApplicationForOrganizerHandler,
});

export const getMyApplications = query({
  args: {},
  returns: v.array(applicationWithOrganizerValidator),
  handler: getMyApplicationsHandler,
});

export const review = mutation({
  args: {
    applicationId: v.id('applications'),
    status: v.union(v.literal('approved'), v.literal('rejected')),
    denyReason: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: reviewApplicationHandler,
});

export const revoke = mutation({
  args: {
    applicationId: v.id('applications'),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: revokeApplicationHandler,
});

export const list = query({
  args: {
    status: v.optional(applicationStatusValidator),
    organizerId: v.optional(v.id('organizers')),
  },
  returns: v.array(applicationListRowValidator),
  handler: listApplicationsHandler,
});
