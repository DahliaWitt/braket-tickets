import {v, type Infer} from 'convex/values';
import {EVENT_VISIBILITIES} from '@shared/domain/event-visibility';
import {TICKET_SALES_STATUSES} from '@shared/domain/ticket-sales-status';

/**
 * Public-safe event shape shared between Convex HTTP handlers and the
 * frontend HTTP client. Returned by GET /api/events/upcoming.
 */
export const publicEventCardValidator = v.object({
  _id: v.id('events'),
  title: v.string(),
  description: v.optional(v.string()),
  date: v.string(),
  location: v.optional(v.string()),
  price: v.number(),
  totalTickets: v.number(),
  soldCount: v.number(),
  isSoldOut: v.boolean(),
  ticketSalesStatus: v.optional(
    v.union(
      v.literal(TICKET_SALES_STATUSES[0]),
      v.literal(TICKET_SALES_STATUSES[1]),
      v.literal(TICKET_SALES_STATUSES[2]),
    ),
  ),
  visibility: v.union(
    v.literal(EVENT_VISIBILITIES[0]),
    v.literal(EVENT_VISIBILITIES[1]),
    v.literal(EVENT_VISIBILITIES[2]),
  ),
  posterUrl: v.union(v.string(), v.null()),
  organizerId: v.optional(v.union(v.id('organizers'), v.null())),
});

export type PublicEventCard = Infer<typeof publicEventCardValidator>;
