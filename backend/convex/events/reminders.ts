import {v} from 'convex/values';

import {mutation, query} from '../_generated/server';
import {
  getTicketReminderAudience as loadTicketReminderAudience,
  sendTicketPurchaseReminder as queueTicketPurchaseReminder,
} from './_impl/reminders_handlers';
import {
  ticketReminderAudienceValidator,
  ticketReminderSendResultValidator,
} from '../lib/events/validators';

export const getTicketReminderAudience = query({
  args: {eventId: v.id('events')},
  returns: ticketReminderAudienceValidator,
  handler: async (ctx, args) => await loadTicketReminderAudience(ctx, args),
});

export const sendTicketPurchaseReminder = mutation({
  args: {
    eventId: v.id('events'),
    subject: v.string(),
    message: v.string(),
    // Optional serialized ProseMirror JSON rich body. When present, the server
    // validates + renders it and derives the canonical plain text from it.
    bodyJson: v.optional(v.string()),
  },
  returns: ticketReminderSendResultValidator,
  handler: async (ctx, args) => await queueTicketPurchaseReminder(ctx, args),
});
