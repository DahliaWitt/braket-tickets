import {v} from 'convex/values';
import {mutation} from '../_generated/server';
import {guestTypeValidator} from '../lib/validators/guests';
import {ticketStatusValidator} from '../lib/validators/ticketing';
import {checkIn as checkInImpl, revertCheckIn as revertCheckInImpl} from './_impl/check_in_handlers';

// LINT.IfChange
export const checkIn = mutation({
  args: {
    ticketId: v.optional(v.string()),
    guestId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    ticket: v.optional(
      v.object({
        _id: v.id('tickets'),
        _creationTime: v.number(),
        userId: v.optional(v.id('users')),
        eventId: v.id('events'),
        guestSessionId: v.optional(v.id('guest_sessions')),
        status: ticketStatusValidator,
        tier: v.union(
          v.literal('regular'),
          v.literal('notaflof'),
          v.literal('supporter'),
        ),
        checkedInAt: v.optional(v.number()),
        checkedInBy: v.optional(v.id('users')),
        event: v.optional(
          v.object({
            title: v.string(),
            date: v.string(),
            location: v.optional(v.string()),
          }),
        ),
        user: v.optional(
          v.object({
            name: v.optional(v.string()),
            email: v.optional(v.string()),
          }),
        ),
      }),
    ),
    guest: v.optional(
      v.object({
        _id: v.id('guests'),
        _creationTime: v.number(),
        eventId: v.id('events'),
        name: v.string(),
        email: v.optional(v.string()),
        type: guestTypeValidator,
        notes: v.optional(v.string()),
        checkedInAt: v.optional(v.number()),
        checkedInBy: v.optional(v.id('users')),
        event: v.optional(
          v.object({
            title: v.string(),
            date: v.string(),
            location: v.optional(v.string()),
          }),
        ),
      }),
    ),
  }),
  handler: checkInImpl,
});

// LINT.ThenChange("./analytics.ts")
// LINT.IfChange
export const revertCheckIn = mutation({
  args: {
    ticketId: v.id('tickets'),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: revertCheckInImpl,
});
// LINT.ThenChange("./analytics.ts")
