import {Injectable} from '@angular/core';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';

export type CreateGuestListAssignmentArgs = FunctionArgs<
  typeof api.guest_list.assignments.create
>;
export type BulkCreateStaffRows = FunctionArgs<
  typeof api.guest_list.assignments.bulkCreateStaff
>['rows'];
export type CommunityMemberCandidate = FunctionReturnType<
  typeof api.communities.scanners.searchGrantCandidates
>[number];

@Injectable({providedIn: 'root'})
export class GuestListOrganizerService {
  private readonly convex = injectConvex();

  searchMembers(
    organizerId: string,
    searchTerm: string,
  ): Promise<CommunityMemberCandidate[]> {
    return this.convex.query(api.communities.scanners.searchGrantCandidates, {
      organizerId: organizerId as Id<'organizers'>,
      searchTerm,
    });
  }

  create(
    args: CreateGuestListAssignmentArgs,
  ): Promise<FunctionReturnType<typeof api.guest_list.assignments.create>> {
    return this.convex.mutation(api.guest_list.assignments.create, args);
  }

  bulkCreateStaff(
    eventId: string,
    batchKey: string,
    rows: BulkCreateStaffRows,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.bulkCreateStaff>
  > {
    return this.convex.mutation(api.guest_list.assignments.bulkCreateStaff, {
      eventId: eventId as Id<'events'>,
      batchKey,
      rows,
    });
  }

  updateGrant(
    assignmentId: string,
    grantedSlots: number,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.updateGrant>
  > {
    return this.convex.mutation(api.guest_list.assignments.updateGrant, {
      assignmentId: assignmentId as Id<'guestListAssignments'>,
      grantedSlots,
    });
  }

  revoke(
    assignmentId: string,
  ): Promise<FunctionReturnType<typeof api.guest_list.assignments.revoke>> {
    return this.convex.mutation(api.guest_list.assignments.revoke, {
      assignmentId: assignmentId as Id<'guestListAssignments'>,
    });
  }

  resendInvite(
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.resendInvite>
  > {
    return this.convex.mutation(api.guest_list.assignments.resendInvite, {
      assignmentId: assignmentId as Id<'guestListAssignments'>,
      idempotencyKey,
    });
  }

  listGuests(assignmentId: string, cursor: string | null) {
    return this.convex.query(api.guest_list.assignments.listGuests, {
      assignmentId: assignmentId as Id<'guestListAssignments'>,
      paginationOpts: {numItems: 25, cursor},
    });
  }

  listByEvent(eventId: string, cursor: string | null) {
    return this.convex.query(api.guest_list.assignments.listByEvent, {
      eventId: eventId as Id<'events'>,
      paginationOpts: {numItems: 25, cursor},
    });
  }
}
