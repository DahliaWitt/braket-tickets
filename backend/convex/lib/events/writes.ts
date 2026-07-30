import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import type {
  EventStatus,
  EventVisibility,
  TicketSalesStatus,
} from '../../lib/validators/events';
import {assertUploadConfirmed} from '../../lib/upload_validation';
import {
  validateStringLength,
  validateNonNegative,
  validateISODate,
  validateInteger,
  MAX_EVENT_TITLE_LENGTH,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
} from '../../lib/validation';
import {throwInvalidInput} from '../../lib/errors';
import {eventStartInstantMs, parseUtcInstant} from '@shared/event-time';
import {
  MAX_EVENT_DURATION_DAYS,
  MAX_EVENT_DURATION_MS,
} from '@shared/constants';

export interface SliderConfigInput {
  enabled: boolean;
  min?: number;
  max?: number;
}

export type AnnouncementInput =
  {mode: 'skip'} | {mode: 'now'} | {mode: 'scheduled'; scheduledFor: number};

type EventCreateFields = Omit<Doc<'events'>, '_id' | '_creationTime'>;

type EventUpdatePatch = Partial<Doc<'events'>>;

interface EventWriteValidationInput {
  title?: string;
  description?: string;
  date?: string;
  /** ISO UTC end instant; `null` (update only) clears the stored value. */
  endDate?: string | null;
  location?: string;
  price?: number;
  totalTickets?: number;
  maxTicketsPerUser?: number;
}

export interface CreateEventInput extends EventWriteValidationInput {
  title: string;
  date: string;
  endDate?: string;
  price: number;
  totalTickets: number;
  status: EventStatus;
  poster?: string;
  organizerId: Id<'organizers'>;
  supporterDefaultPrice?: number;
  maxTicketsPerUser?: number;
  visibility: EventVisibility;
  sliderConfig?: SliderConfigInput;
  announcement?: AnnouncementInput;
}

export interface UpdateEventInput extends Omit<
  EventWriteValidationInput,
  'description' | 'location' | 'maxTicketsPerUser'
> {
  title?: string;
  // `null` is an explicit clear sentinel on these optional fields (update
  // only). It survives the wire where an omitted key cannot express "remove".
  description?: string | null;
  date?: string;
  endDate?: string | null;
  status?: EventStatus;
  totalTickets?: number;
  price?: number;
  location?: string | null;
  poster?: string;
  organizerId?: Id<'organizers'>;
  ticketSalesStatus?: TicketSalesStatus;
  supporterDefaultPrice?: number | null;
  maxTicketsPerUser?: number | null;
  slidingScaleEnabled?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  sliderConfig?: SliderConfigInput;
  announcement?: AnnouncementInput;
  resaleEnabled?: boolean;
  resaleFeePct?: number;
  visibility?: EventVisibility;
}

function validateBaseEventWriteInput(
  args: Omit<
    EventWriteValidationInput,
    'description' | 'location' | 'maxTicketsPerUser'
  > & {
    // Accept the update path's clearable (`null`) variants; the length/range
    // helpers below all treat `null` as "no value" and skip it.
    description?: string | null;
    location?: string | null;
    maxTicketsPerUser?: number | null;
  },
) {
  validateStringLength(args.title, 'Title', MAX_EVENT_TITLE_LENGTH);
  if (args.title !== undefined && args.title.trim().length === 0) {
    throwInvalidInput('Title cannot be blank', {field: 'title'});
  }
  validateStringLength(
    args.description,
    'Description',
    MAX_EVENT_DESCRIPTION_LENGTH,
  );
  validateStringLength(args.location, 'Location', MAX_EVENT_LOCATION_LENGTH);
  if (args.date !== undefined) {
    validateISODate(args.date);
  }
  if (typeof args.endDate === 'string') {
    validateISODate(args.endDate, 'endDate');
  }

  validateNonNegative(args.price, 'Price', true);
  validateNonNegative(args.totalTickets, 'Total tickets', false);
  validateNonNegative(args.maxTicketsPerUser, 'Max tickets per user', false);
  validateInteger(args.totalTickets, 'Total tickets');
  validateInteger(args.maxTicketsPerUser, 'Max tickets per user');
}

export function validateCreateEventInput(args: CreateEventInput) {
  validateBaseEventWriteInput(args);
  if (args.endDate !== undefined) {
    assertEventEndAfterStart(args.date, args.endDate);
  }
}

/**
 * Requires the end instant to be strictly after the event start and no more
 * than MAX_EVENT_DURATION_DAYS later. The upper bound is a data-integrity guard
 * (see MAX_EVENT_DURATION_DAYS): a typo'd far-future endDate would otherwise
 * keep the event flagged "ongoing" forever. Formats are validated separately
 * (validateISODate); legacy date-key starts resolve to event-local midnight
 * via eventStartInstantMs.
 */
export function assertEventEndAfterStart(
  startsAtUtc: string,
  endsAtUtc: string,
): void {
  const startMs = eventStartInstantMs(startsAtUtc);
  const endMs = parseUtcInstant(endsAtUtc)?.getTime() ?? null;
  if (startMs === null || endMs === null) {
    return;
  }
  if (endMs <= startMs) {
    throwInvalidInput('End date must be after the event start', {
      field: 'endDate',
    });
  }
  if (endMs - startMs > MAX_EVENT_DURATION_MS) {
    throwInvalidInput(
      `End date must be within ${MAX_EVENT_DURATION_DAYS} days of the event start`,
      {field: 'endDate'},
    );
  }
}

export function validateUpdateEventInput(args: UpdateEventInput) {
  validateBaseEventWriteInput(args);
  validateNonNegative(args.slidingScaleMin, 'Sliding scale minimum', true);
  validateNonNegative(args.slidingScaleMax, 'Sliding scale maximum', true);
  validateNonNegative(
    args.supporterDefaultPrice,
    'Supporter default price',
    true,
  );

  if (
    args.resaleFeePct !== undefined &&
    (args.resaleFeePct < 0 || args.resaleFeePct > 100)
  ) {
    throwInvalidInput('Resale fee percentage must be between 0 and 100', {
      field: 'resaleFeePct',
    });
  }
}

export function toEventCreateFields(args: CreateEventInput): EventCreateFields {
  const {sliderConfig, announcement: _announcement, ...rest} = args;

  return {
    ...rest,
    slidingScaleEnabled: sliderConfig?.enabled,
    slidingScaleMin: sliderConfig?.min,
    slidingScaleMax: sliderConfig?.max,
  };
}

export function toEventUpdatePatch(args: UpdateEventInput): EventUpdatePatch {
  const {
    sliderConfig,
    organizerId,
    ticketSalesStatus,
    endDate,
    description,
    location,
    supporterDefaultPrice,
    maxTicketsPerUser,
    announcement: _announcement,
    ...rest
  } = args;
  const updates: Partial<Doc<'events'>> = {...rest};

  // `null` (clear) on these optional fields is handled by the update handler as
  // an explicit field removal; the generic patch only carries new values so it
  // still benefits from pruneNoopEventPatch and never writes `null` into a
  // string/number column.
  if (typeof endDate === 'string') {
    updates.endDate = endDate;
  }
  if (typeof description === 'string') {
    updates.description = description;
  }
  if (typeof location === 'string') {
    updates.location = location;
  }
  if (typeof supporterDefaultPrice === 'number') {
    updates.supporterDefaultPrice = supporterDefaultPrice;
  }
  if (typeof maxTicketsPerUser === 'number') {
    updates.maxTicketsPerUser = maxTicketsPerUser;
  }

  if (sliderConfig !== undefined) {
    updates.slidingScaleEnabled = sliderConfig.enabled;
    updates.slidingScaleMin = sliderConfig.min;
    updates.slidingScaleMax = sliderConfig.max;
  }
  if (organizerId !== undefined) {
    updates.organizerId = organizerId;
  }
  if (ticketSalesStatus !== undefined) {
    updates.ticketSalesStatus = ticketSalesStatus;
  }

  return updates;
}

export async function prepareEventCreateFields(
  db: MutationCtx['db'],
  uploaderUserId: Id<'users'>,
  args: CreateEventInput,
): Promise<EventCreateFields> {
  validateCreateEventInput(args);

  if (args.poster) {
    await assertUploadConfirmed(db, args.poster, 'poster', uploaderUserId);
  }

  return toEventCreateFields(args);
}

export async function prepareEventUpdateFields(
  db: MutationCtx['db'],
  uploaderUserId: Id<'users'>,
  args: UpdateEventInput,
): Promise<EventUpdatePatch> {
  validateUpdateEventInput(args);

  if (args.poster) {
    await assertUploadConfirmed(db, args.poster, 'poster', uploaderUserId);
  }

  return toEventUpdatePatch(args);
}
