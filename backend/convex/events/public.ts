import {v} from 'convex/values';
import {publicEventCardValidator} from '@shared/contracts/public-event';

import {internalQuery, query} from '../_generated/server';
import {
  batchEventAvailabilityValidator,
  eventAvailabilityValidator,
} from './_impl/availability';
import {
  eventGetDetailValidator,
  eventWithPosterUrlValidator,
} from '../lib/events/validators';
import {
  getBatchEventAvailability,
  getEventAvailability,
  getEventById,
  listEventsByOrganizer,
  listPublicUpcomingEvents,
  listUpcomingPublishedEvents,
  listVisiblePublishedEvents,
} from './_impl/public';

export const list = query({
  args: {},
  returns: v.array(eventWithPosterUrlValidator),
  handler: async (ctx) => await listVisiblePublishedEvents(ctx),
});

export const upcoming = query({
  args: {},
  returns: v.array(eventWithPosterUrlValidator),
  handler: async (ctx) => await listUpcomingPublishedEvents(ctx),
});

export const listPublicUpcomingInternal = internalQuery({
  args: {},
  returns: v.array(publicEventCardValidator),
  handler: async (ctx) => await listPublicUpcomingEvents(ctx),
});

export const listByOrganizer = query({
  args: {
    organizerId: v.optional(v.id('organizers')),
    slug: v.optional(v.string()),
    communityParam: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      organizerName: v.string(),
      organizerDescription: v.optional(v.string()),
      organizerLogoUrl: v.optional(v.string()),
      organizerCodeOfConduct: v.optional(v.string()),
      events: v.array(eventWithPosterUrlValidator),
    }),
  ),
  handler: async (ctx, args) => await listEventsByOrganizer(ctx, args),
});

export const get = query({
  args: {id: v.id('events')},
  returns: v.union(v.null(), eventGetDetailValidator),
  handler: async (ctx, args) => await getEventById(ctx, args),
});

export const getAvailability = query({
  args: {eventId: v.id('events'), now: v.number()},
  returns: eventAvailabilityValidator,
  handler: async (ctx, args) => await getEventAvailability(ctx, args),
});

export const getBatchAvailability = query({
  args: {eventIds: v.array(v.id('events')), now: v.number()},
  returns: batchEventAvailabilityValidator,
  handler: async (ctx, args) => await getBatchEventAvailability(ctx, args),
});
