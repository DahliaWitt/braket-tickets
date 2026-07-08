import {v} from 'convex/values';
import {
  eventStatusValidator,
  eventVisibilityValueValidator,
  eventVisibilityValidator,
  ticketSalesStatusValidator,
} from '../../lib/validators/events';
import {
  ticketStatusValidator,
  tierValidator,
} from '../../lib/validators/ticketing';
import {guestTypeValidator} from '../../lib/validators/guests';
import {resaleListingFields} from '../../lib/resale/validators';
export {publicEventCardValidator} from '@shared/contracts/public-event';

export const eventDocFields = {
  _id: v.id('events'),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  date: v.string(),
  endDate: v.optional(v.string()),
  location: v.optional(v.string()),
  poster: v.optional(v.string()),
  price: v.number(),
  slidingScaleEnabled: v.optional(v.boolean()),
  slidingScaleMin: v.optional(v.number()),
  slidingScaleMax: v.optional(v.number()),
  totalTickets: v.number(),
  supporterDefaultPrice: v.optional(v.number()),
  maxTicketsPerUser: v.optional(v.number()),
  organizerId: v.id('organizers'),
  ticketSalesStatus: ticketSalesStatusValidator,
  status: eventStatusValidator,
  resaleEnabled: v.optional(v.boolean()),
  resaleFeePct: v.optional(v.number()),
  visibility: eventVisibilityValueValidator,
  inventoryId: v.optional(v.id('event_inventory')),
  checkedInCount: v.optional(v.number()),
  lastCheckInAt: v.optional(v.union(v.number(), v.null())),
  paidOutAt: v.optional(v.number()),
};

export const eventDocValidator = v.object(eventDocFields);

const canonicalEventFields = {
  ...eventDocFields,
};

export const canonicalEventDocValidator = v.object(canonicalEventFields);

export const eventWithPosterUrlValidator = v.object({
  ...canonicalEventFields,
  posterUrl: v.union(v.string(), v.null()),
  isSoldOut: v.optional(v.boolean()),
  soldCount: v.optional(v.number()),
});

export const adminEventListItemValidator = v.object({
  ...canonicalEventFields,
  posterUrl: v.union(v.string(), v.null()),
  isSoldOut: v.optional(v.boolean()),
  soldCount: v.optional(v.number()),
  hasAnyTickets: v.optional(v.boolean()),
  hasCompletedOrders: v.optional(v.boolean()),
});

export const eventGetDetailValidator = v.object({
  ...canonicalEventFields,
  posterUrl: v.union(v.string(), v.null()),
  organizer: v.union(
    v.object({
      _id: v.id('organizers'),
      name: v.string(),
      slug: v.optional(v.string()),
      logoUrl: v.optional(v.string()),
      email: v.optional(v.string()),
      contactInfo: v.optional(v.string()),
      codeOfConduct: v.optional(v.string()),
    }),
    v.null(),
  ),
  guestCount: v.number(),
  organizerPaymentReady: v.boolean(),
  isPlatformOrganizer: v.boolean(),
});

export const eventEditDetailValidator = v.object({
  ...canonicalEventFields,
  posterUrl: v.union(v.string(), v.null()),
  organizerPaymentReady: v.boolean(),
  isPlatformOrganizer: v.boolean(),
});

export const guestFields = {
  _id: v.id('guests'),
  _creationTime: v.number(),
  eventId: v.id('events'),
  name: v.string(),
  email: v.optional(v.string()),
  type: guestTypeValidator,
  notes: v.optional(v.string()),
  emailedAt: v.optional(v.number()),
  emailSendLockedAt: v.optional(v.union(v.number(), v.null())),
  checkedInAt: v.optional(v.number()),
  checkedInBy: v.optional(v.id('users')),
};

export const guestValidator = v.object(guestFields);

const revenueObject = v.object({
  grossCents: v.number(),
  processingFeeCents: v.number(),
  platformFeeCents: v.number(),
  refundedCents: v.number(),
  lostProcessingFeeCents: v.number(),
  netCents: v.number(),
});

const revenueByTierObject = v.object({
  regular: v.object({
    grossCents: v.number(),
    netCents: v.number(),
    quantity: v.number(),
  }),
  notaflof: v.object({
    grossCents: v.number(),
    netCents: v.number(),
    quantity: v.number(),
  }),
  supporter: v.object({
    grossCents: v.number(),
    netCents: v.number(),
    quantity: v.number(),
  }),
});

const checkInStatsObject = v.object({
  checkedIn: v.number(),
  checkInRate: v.number(),
  buckets: v.array(
    v.object({
      time: v.number(),
      count: v.number(),
    }),
  ),
});

const purchaseObject = v.object({
  id: v.id('ticket_orders'),
  userId: v.optional(v.id('users')),
  userName: v.string(),
  userEmail: v.optional(v.string()),
  quantity: v.number(),
  amount: v.number(),
  refundedAmountCents: v.optional(v.number()),
  tier: tierValidator,
  status: v.union(v.literal('completed'), v.literal('refunded')),
  createdAt: v.number(),
  tickets: v.array(
    v.object({
      id: v.id('tickets'),
      status: ticketStatusValidator,
      tier: tierValidator,
    }),
  ),
});

export const managementSummaryValidator = v.object({
  event: canonicalEventDocValidator,
  soldCount: v.number(),
  heldCount: v.number(),
  remainingCount: v.number(),
  isSoldOut: v.boolean(),
  totalTickets: v.number(),
  tierCounts: v.object({
    regular: v.number(),
    notaflof: v.number(),
    supporter: v.number(),
  }),
  revenue: revenueObject,
  revenueByTier: revenueByTierObject,
  salesByDay: v.array(
    v.object({
      date: v.string(),
      quantity: v.number(),
    }),
  ),
  checkInStats: checkInStatsObject,
});

export const managementPurchasesValidator = v.object({
  event: canonicalEventDocValidator,
  purchases: v.array(purchaseObject),
});

export const managementResaleValidator = v.object({
  event: canonicalEventDocValidator,
  resaleMetrics: v.object({
    totalListings: v.number(),
    activeListings: v.number(),
    pendingListings: v.number(),
    completedResales: v.number(),
    cancelledListings: v.number(),
    totalRefundedToSellersCents: v.number(),
    totalResaleFeesCents: v.number(),
    totalLostProcessingFeesCents: v.number(),
    notificationSubscribers: v.number(),
  }),
  resaleListings: v.array(
    v.object({
      ...resaleListingFields,
      sellerName: v.string(),
      sellerEmail: v.optional(v.string()),
      buyerName: v.optional(v.string()),
    }),
  ),
});

export const TICKET_REMINDER_SEGMENT = 'approved_no_ticket' as const;

export const ticketReminderAudienceValidator = v.object({
  segment: v.literal(TICKET_REMINDER_SEGMENT),
  recipientCount: v.number(),
  missingOrganizer: v.boolean(),
});

export const ticketReminderSendResultValidator = v.object({
  segment: v.literal(TICKET_REMINDER_SEGMENT),
  recipientCount: v.number(),
});

export const sliderConfigValidator = v.object({
  enabled: v.boolean(),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
});

export const announcementOptionsValidator = v.union(
  v.object({
    mode: v.literal('skip'),
  }),
  v.object({
    mode: v.literal('now'),
  }),
  v.object({
    mode: v.literal('scheduled'),
    scheduledFor: v.number(),
  }),
);

export const createEventArgs = {
  title: v.string(),
  description: v.optional(v.string()),
  date: v.string(),
  endDate: v.optional(v.string()),
  location: v.optional(v.string()),
  price: v.number(),
  totalTickets: v.number(),
  status: eventStatusValidator,
  poster: v.optional(v.string()),
  organizerId: v.id('organizers'),
  supporterDefaultPrice: v.optional(v.number()),
  maxTicketsPerUser: v.optional(v.number()),
  visibility: eventVisibilityValueValidator,
  sliderConfig: v.optional(sliderConfigValidator),
  announcement: v.optional(announcementOptionsValidator),
};

export const updateEventArgs = {
  id: v.id('events'),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  date: v.optional(v.string()),
  /** New end instant; `null` clears the stored endDate. */
  endDate: v.optional(v.union(v.string(), v.null())),
  status: v.optional(eventStatusValidator),
  totalTickets: v.optional(v.number()),
  price: v.optional(v.number()),
  location: v.optional(v.string()),
  poster: v.optional(v.string()),
  organizerId: v.optional(v.id('organizers')),
  ticketSalesStatus: ticketSalesStatusValidator,
  supporterDefaultPrice: v.optional(v.number()),
  maxTicketsPerUser: v.optional(v.number()),
  slidingScaleEnabled: v.optional(v.boolean()),
  slidingScaleMin: v.optional(v.number()),
  slidingScaleMax: v.optional(v.number()),
  sliderConfig: v.optional(sliderConfigValidator),
  announcement: v.optional(announcementOptionsValidator),
  resaleEnabled: v.optional(v.boolean()),
  resaleFeePct: v.optional(v.number()),
  visibility: eventVisibilityValidator,
};
