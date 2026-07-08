import type {Doc} from '../../_generated/dataModel';
import {
  batchGetStorageUrls,
  type StorageUrlContext,
} from '../../lib/storage_urls';
import {isOrganizerChargeReady} from '../../lib/stripe_connect_state';

type EventDoc = Doc<'events'>;
type OrganizerDoc = Doc<'organizers'>;

export interface PublicEventAvailabilitySummary {
  soldCount: number;
  isSoldOut: boolean;
}

export function toEventDocShape(event: EventDoc) {
  return {
    _id: event._id,
    _creationTime: event._creationTime,
    title: event.title,
    description: event.description,
    date: event.date,
    endDate: event.endDate,
    location: event.location,
    poster: event.poster,
    price: event.price,
    slidingScaleEnabled: event.slidingScaleEnabled,
    slidingScaleMin: event.slidingScaleMin,
    slidingScaleMax: event.slidingScaleMax,
    totalTickets: event.totalTickets,
    supporterDefaultPrice: event.supporterDefaultPrice,
    maxTicketsPerUser: event.maxTicketsPerUser,
    organizerId: event.organizerId,
    ticketSalesStatus: event.ticketSalesStatus,
    status: event.status,
    resaleEnabled: event.resaleEnabled,
    resaleFeePct: event.resaleFeePct,
    visibility: event.visibility,
    paidOutAt: event.paidOutAt,
  };
}

export function toEventWithPosterUrl(
  event: EventDoc,
  posterUrlMap: Map<string, string | null>,
  availability?: PublicEventAvailabilitySummary,
) {
  return {
    ...toEventDocShape(event),
    posterUrl: event.poster ? (posterUrlMap.get(event.poster) ?? null) : null,
    ...(availability
      ? {
          soldCount: availability.soldCount,
          isSoldOut: availability.isSoldOut,
        }
      : {}),
  };
}

export async function mapEventsWithPosterUrls(
  ctx: StorageUrlContext,
  events: ReadonlyArray<EventDoc>,
  availabilityByEventId?: Map<string, PublicEventAvailabilitySummary>,
) {
  const posterUrlMap = await batchGetStorageUrls(
    ctx,
    events.map((event) => event.poster),
  );

  return events.map((event) =>
    toEventWithPosterUrl(
      event,
      posterUrlMap,
      availabilityByEventId?.get(event._id),
    ),
  );
}

export function toPublicEventCard(
  event: EventDoc,
  posterUrlMap: Map<string, string | null>,
  availability: PublicEventAvailabilitySummary,
) {
  return {
    _id: event._id,
    title: event.title,
    description: event.description,
    date: event.date,
    endDate: event.endDate,
    location: event.location,
    price: event.price,
    slidingScaleEnabled: event.slidingScaleEnabled,
    slidingScaleMin: event.slidingScaleMin,
    slidingScaleMax: event.slidingScaleMax,
    supporterDefaultPrice: event.supporterDefaultPrice,
    totalTickets: event.totalTickets,
    soldCount: availability.soldCount,
    isSoldOut: availability.isSoldOut,
    ticketSalesStatus: event.ticketSalesStatus,
    visibility: event.visibility,
    posterUrl: event.poster ? (posterUrlMap.get(event.poster) ?? null) : null,
    organizerId: event.organizerId,
  };
}

export async function mapPublicEventCards(
  ctx: StorageUrlContext,
  events: ReadonlyArray<EventDoc>,
  availabilityByEventId: Map<string, PublicEventAvailabilitySummary>,
) {
  const posterUrlMap = await batchGetStorageUrls(
    ctx,
    events.map((event) => event.poster),
  );

  return events.map((event) => {
    const availability = availabilityByEventId.get(event._id);
    if (!availability) {
      throw new Error(`Missing canonical availability for event ${event._id}`);
    }

    return toPublicEventCard(event, posterUrlMap, availability);
  });
}

export async function getPosterUrl(
  ctx: StorageUrlContext,
  posterId: string | undefined,
) {
  if (!posterId) return null;
  // Plain URLs (e.g. from seed data or external sources) are passed through directly.
  // Storage IDs are resolved via Convex file storage.
  if (posterId.startsWith('http://') || posterId.startsWith('https://'))
    return posterId;
  return await ctx.storage.getUrl(posterId);
}

export function buildOrganizerPaymentState(
  organizer: OrganizerDoc | null | undefined,
) {
  const isPlatformOrganizer = organizer?.isPlatformOrganizer ?? false;
  return {
    organizerPaymentReady: isOrganizerChargeReady(organizer),
    isPlatformOrganizer,
  };
}

function toEventOrganizerSummary(
  organizer: OrganizerDoc | null | undefined,
  organizerLogoUrl: string | undefined,
) {
  if (!organizer) {
    return null;
  }

  return {
    _id: organizer._id,
    name: organizer.name,
    slug: organizer.slug,
    logoUrl: organizerLogoUrl,
    email: organizer.email,
    contactInfo: organizer.contactInfo,
    codeOfConduct: organizer.codeOfConduct,
  };
}

export function toEventDetail(
  event: EventDoc,
  args: {
    posterUrl: string | null;
    organizer: OrganizerDoc | null | undefined;
    organizerLogoUrl?: string | undefined;
    guestCount: number;
  },
) {
  const eventData = toEventDocShape(event);

  return {
    ...eventData,
    posterUrl: args.posterUrl,
    organizer: toEventOrganizerSummary(args.organizer, args.organizerLogoUrl),
    ...buildOrganizerPaymentState(args.organizer),
    guestCount: args.guestCount,
  };
}

export function toEditableEventDetail(
  event: EventDoc,
  args: {
    posterUrl: string | null;
    organizer: OrganizerDoc | null | undefined;
  },
) {
  const eventData = toEventDocShape(event);

  return {
    ...eventData,
    posterUrl: args.posterUrl,
    ...buildOrganizerPaymentState(args.organizer),
  };
}
