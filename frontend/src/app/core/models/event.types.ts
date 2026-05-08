import { type api } from '@convex/_generated/api';
import { type FunctionReturnType } from 'convex/server';

export type EventListItem = FunctionReturnType<typeof api.events.public.list>[number];
export type UpcomingEvent = FunctionReturnType<typeof api.events.public.upcoming>[number];
export type AdminEventListItem = FunctionReturnType<typeof api.events.management.adminList>[number];
export type EventDetail = NonNullable<FunctionReturnType<typeof api.events.public.get>>;
export type EditableEvent = FunctionReturnType<typeof api.events.management.getForEdit>;
