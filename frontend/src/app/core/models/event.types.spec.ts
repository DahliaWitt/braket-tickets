import { describe, expectTypeOf, it } from 'vitest';
import { type api } from '@convex/_generated/api';
import { type FunctionReturnType } from 'convex/server';
import type {
  AdminEventListItem,
  EditableEvent,
  EventDetail,
  EventListItem,
  UpcomingEvent,
} from './event.types';

describe('event.types', () => {
  it('matches Convex-generated event query shapes', () => {
    expectTypeOf<EventListItem>().toEqualTypeOf<FunctionReturnType<typeof api.events.public.list>[number]>();
    expectTypeOf<UpcomingEvent>().toEqualTypeOf<
      FunctionReturnType<typeof api.events.public.upcoming>[number]
    >();
    expectTypeOf<AdminEventListItem>().toEqualTypeOf<
      FunctionReturnType<typeof api.events.management.adminList>[number]
    >();
    expectTypeOf<EventDetail>().toEqualTypeOf<
      NonNullable<FunctionReturnType<typeof api.events.public.get>>
    >();
    expectTypeOf<EditableEvent>().toEqualTypeOf<
      FunctionReturnType<typeof api.events.management.getForEdit>
    >();
  });
});
