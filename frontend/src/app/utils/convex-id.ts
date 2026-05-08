import type {Id} from '@convex/_generated/dataModel';

/** Cast a string event ID to the branded Convex `Id<'events'>` type. */
export function toEventId(eventId: string): Id<'events'> {
  return eventId as Id<'events'>;
}
