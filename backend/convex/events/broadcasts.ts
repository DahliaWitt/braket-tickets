import {v} from 'convex/values';

import {mutation, query} from '../_generated/server';
import {
  getBroadcastAudience,
  listBroadcastHistory,
  sendBroadcast,
} from './_impl/broadcasts_handlers';

const sendResultValidator = v.union(
  v.object({success: v.literal(true), recipientCount: v.number()}),
  v.object({
    success: v.literal(false),
    error: v.union(
      v.literal('event_not_found'),
      v.literal('validation_error'),
      v.literal('too_many_recipients'),
      v.literal('no_recipients'),
      v.literal('already_sent'),
    ),
    message: v.optional(v.string()),
    count: v.optional(v.number()),
  }),
);

export const getAudience = query({
  args: {eventId: v.id('events')},
  returns: v.object({
    recipientCount: v.number(),
    exceedsCap: v.boolean(),
  }),
  handler: async (ctx, args) => await getBroadcastAudience(ctx, args),
});

export const listHistory = query({
  args: {eventId: v.id('events')},
  returns: v.array(
    v.object({
      _id: v.id('eventBroadcasts'),
      subject: v.string(),
      recipientCount: v.number(),
      sentAt: v.number(),
      adminName: v.string(),
    }),
  ),
  handler: async (ctx, args) => await listBroadcastHistory(ctx, args),
});

export const send = mutation({
  args: {
    eventId: v.id('events'),
    subject: v.string(),
    message: v.string(),
    // Optional serialized ProseMirror JSON rich body. When present, the server
    // validates + renders it and derives the canonical plain text from it.
    bodyJson: v.optional(v.string()),
  },
  returns: sendResultValidator,
  handler: async (ctx, args) => await sendBroadcast(ctx, args),
});
