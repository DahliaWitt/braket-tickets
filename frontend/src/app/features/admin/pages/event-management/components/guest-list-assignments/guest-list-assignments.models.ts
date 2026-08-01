import type {api} from '@convex/_generated/api';
import type {FunctionReturnType} from 'convex/server';

export type GuestListEventOverview = FunctionReturnType<
  typeof api.guest_list.assignments.getEventOverview
>;
export type GuestListAssignment = FunctionReturnType<
  typeof api.guest_list.assignments.listByEvent
>['page'][number];
export type SourcedGuest = FunctionReturnType<
  typeof api.guest_list.assignments.listGuests
>['page'][number];

export interface SourcedGuestPage {
  readonly guests: readonly SourcedGuest[];
  readonly continueCursor: string | null;
}

export interface AssignmentFormValue {
  search: string;
  displayName: string;
  email: string;
  role: 'artist' | 'staff';
  grantOverride: string;
}
