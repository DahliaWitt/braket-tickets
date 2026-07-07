import {v} from 'convex/values';

import {internalMutation, mutation, query} from '../_generated/server';
import {
  deliverMissedBroadcasts,
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
  args: {
    eventId: v.id('events'),
    // Mirrors the send toggle (default ON). When false, imported entries are
    // excluded from the previewed recipient count.
    includeExternalTicketHolders: v.optional(v.boolean()),
  },
  returns: v.object({
    recipientCount: v.number(),
    exceedsCap: v.boolean(),
    // Reachability split for imported (external) ticket holders so the compose
    // flow can render "includes N external ticket holders". `reachable` = with
    // email (join the audience when included); `unreachable` = without email.
    importedReachableCount: v.number(),
    importedUnreachableCount: v.number(),
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
    // Include imported (external) ticket holders WITH an email in the audience.
    // Defaults to true. Recipients are deduped by normalized email across
    // native purchasers, guests, and imported entries regardless of this flag.
    includeExternalTicketHolders: v.optional(v.boolean()),
  },
  returns: sendResultValidator,
  handler: async (ctx, args) => await sendBroadcast(ctx, args),
});

/**
 * Scheduled by ticket-acquisition mutations (primary completion, resale
 * settlement, guest add) to deliver broadcasts the recipient missed.
 */
export const deliverMissed = internalMutation({
  args: {
    eventId: v.id('events'),
    email: v.string(),
    userId: v.optional(v.id('users')),
  },
  returns: v.null(),
  handler: async (ctx, args) => await deliverMissedBroadcasts(ctx, args),
});
