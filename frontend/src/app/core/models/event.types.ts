import {type api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';

/**
 * Chunk size for api.events.public.getBatchAvailability subscriptions.
 * The backend accepts unbounded eventIds arrays; this is a frontend batching
 * heuristic to keep individual query payloads and invalidation scopes small.
 * Single source of truth — do not redeclare locally.
 */
export const MAX_EVENT_IDS_PER_BATCH = 50;

export type EventListItem = FunctionReturnType<
  typeof api.events.public.list
>[number];
export type UpcomingEvent = FunctionReturnType<
  typeof api.events.public.upcoming
>[number];
export type AdminEventListItem = FunctionReturnType<
  typeof api.events.management.adminList
>[number];
export type EventDetail = NonNullable<
  FunctionReturnType<typeof api.events.public.get>
>;
export type EditableEvent = FunctionReturnType<
  typeof api.events.management.getForEdit
>;
