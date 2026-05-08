import {v, type Infer} from 'convex/values';
import {EVENT_STATUSES, type EventStatus as SharedEventStatus} from '@shared/domain/event-status';
import {
  EVENT_VISIBILITIES,
  type EventVisibility as SharedEventVisibility,
} from '@shared/domain/event-visibility';
import {
  TICKET_SALES_STATUSES,
  type TicketSalesStatus as SharedTicketSalesStatus,
} from '@shared/domain/ticket-sales-status';
import type {AssertEqual} from '../type_utils';

export type EventVisibility = SharedEventVisibility;
export type {EventStatus} from '@shared/domain/event-status';
export type TicketSalesStatus = SharedTicketSalesStatus;

export const eventVisibilityValueValidator = v.union(
  v.literal(EVENT_VISIBILITIES[0]),
  v.literal(EVENT_VISIBILITIES[1]),
  v.literal(EVENT_VISIBILITIES[2]),
);

export const eventVisibilityValidator = v.optional(
  eventVisibilityValueValidator,
);

export const eventStatusValidator = v.union(
  v.literal(EVENT_STATUSES[0]),
  v.literal(EVENT_STATUSES[1]),
  v.literal(EVENT_STATUSES[2]),
);

const _eventStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof eventStatusValidator>,
  SharedEventStatus
> = true;

const _eventVisibilityValidatorMatchesShared: AssertEqual<
  Infer<typeof eventVisibilityValueValidator>,
  SharedEventVisibility
> = true;

export const ticketSalesStatusValueValidator = v.union(
  v.literal(TICKET_SALES_STATUSES[0]),
  v.literal(TICKET_SALES_STATUSES[1]),
  v.literal(TICKET_SALES_STATUSES[2]),
);

export const ticketSalesStatusValidator = v.optional(
  ticketSalesStatusValueValidator,
);

const _ticketSalesStatusValidatorMatchesShared: AssertEqual<
  Infer<typeof ticketSalesStatusValueValidator>,
  SharedTicketSalesStatus
> = true;
