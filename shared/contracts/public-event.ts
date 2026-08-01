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
  endDate: v.optional(v.string()),
  location: v.optional(v.string()),
  price: v.number(),
  slidingScaleEnabled: v.optional(v.boolean()),
  slidingScaleMin: v.optional(v.number()),
  slidingScaleMax: v.optional(v.number()),
  supporterDefaultPrice: v.optional(v.number()),
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

/**
 * Public-safe single-event preview shape, returned by GET /api/events/:id.
 * Used to populate OG meta tags for social-media unfurling. No raw `endDate`
 * — `dateLabel` already encodes the range (single-day, overnight, multi-day)
 * and nothing downstream consumes `endDate`.
 */
export const publicEventPreviewValidator = v.object({
  _id: v.id('events'),
  title: v.string(),
  description: v.optional(v.string()), // ALREADY truncated server-side (~300 chars)
  date: v.string(), // ISO 8601 UTC instant (schema contract)
  dateLabel: v.string(), // human-readable range label, formatted server-side
  location: v.optional(v.string()),
  posterUrl: v.union(v.string(), v.null()), // https-only or null
  organizerName: v.string(), // organizer is guaranteed live by the visibility gate
});

export type PublicEventPreview = Infer<typeof publicEventPreviewValidator>;
