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

export interface SliderConfigInput {
  enabled: boolean;
  min?: number;
  max?: number;
}

export type AnnouncementInput =
  | {mode: 'skip'}
  | {mode: 'now'}
  | {mode: 'scheduled'; scheduledFor: number};

type EventCreateFields = Omit<Doc<'events'>, '_id' | '_creationTime'>;

type EventUpdatePatch = Partial<Doc<'events'>>;

interface EventWriteValidationInput {
  title?: string;
  description?: string;
  date?: string;
  location?: string;
  price?: number;
  totalTickets?: number;
  maxTicketsPerUser?: number;
}

export interface CreateEventInput extends EventWriteValidationInput {
  title: string;
  date: string;
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

export interface UpdateEventInput extends EventWriteValidationInput {
  title?: string;
  description?: string;
  date?: string;
  status?: EventStatus;
  totalTickets?: number;
  price?: number;
  location?: string;
  poster?: string;
  organizerId?: Id<'organizers'>;
  ticketSalesStatus?: TicketSalesStatus;
  supporterDefaultPrice?: number;
  maxTicketsPerUser?: number;
  slidingScaleEnabled?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  sliderConfig?: SliderConfigInput;
  announcement?: AnnouncementInput;
  resaleEnabled?: boolean;
  resaleFeePct?: number;
  visibility?: EventVisibility;
}

function validateBaseEventWriteInput(args: EventWriteValidationInput) {
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

  validateNonNegative(args.price, 'Price', true);
  validateNonNegative(args.totalTickets, 'Total tickets', false);
  validateNonNegative(args.maxTicketsPerUser, 'Max tickets per user', false);
  validateInteger(args.totalTickets, 'Total tickets');
  validateInteger(args.maxTicketsPerUser, 'Max tickets per user');
}

export function validateCreateEventInput(args: CreateEventInput) {
  validateBaseEventWriteInput(args);
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
    announcement: _announcement,
    ...rest
  } = args;
  const updates: Partial<Doc<'events'>> = {...rest};

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
