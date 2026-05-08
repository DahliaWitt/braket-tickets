import {v} from 'convex/values';
import {query, mutation} from '../../_generated/server';
import {
  buildVettingReminderRecipients,
  getVettingReminderAudience as getVettingReminderAudienceImpl,
  sendVettingReminder as sendVettingReminderImpl,
} from './_impl/reminders';

const audienceValidator = v.object({
  segment: v.literal('no_application'),
  recipientCount: v.number(),
});

export {buildVettingReminderRecipients};

export const getVettingReminderAudience = query({
  args: {},
  returns: audienceValidator,
  handler: getVettingReminderAudienceImpl,
});

export const sendVettingReminder = mutation({
  args: {
    subject: v.string(),
    message: v.string(),
  },
  returns: audienceValidator,
  handler: sendVettingReminderImpl,
});
