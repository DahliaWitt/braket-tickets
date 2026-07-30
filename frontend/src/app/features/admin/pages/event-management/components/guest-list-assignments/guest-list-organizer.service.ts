import {Injectable} from '@angular/core';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';

export type CreateGuestListAssignmentArgs = FunctionArgs<
  typeof api.guest_list.assignments.create
>;
export type SearchCommunityMembersArgs = FunctionArgs<
  typeof api.communities.scanners.searchGrantCandidates
>;
export type BulkCreateStaffArgs = FunctionArgs<
  typeof api.guest_list.assignments.bulkCreateStaff
>;
export type UpdateGuestListGrantArgs = FunctionArgs<
  typeof api.guest_list.assignments.updateGrant
>;
export type RevokeGuestListAssignmentArgs = FunctionArgs<
  typeof api.guest_list.assignments.revoke
>;
export type ResendGuestListInviteArgs = FunctionArgs<
  typeof api.guest_list.assignments.resendInvite
>;
export type ListAssignmentGuestsArgs = FunctionArgs<
  typeof api.guest_list.assignments.listGuests
>;
export type ListEventAssignmentsArgs = FunctionArgs<
  typeof api.guest_list.assignments.listByEvent
>;
export type CommunityMemberCandidate = FunctionReturnType<
  typeof api.communities.scanners.searchGrantCandidates
>[number];

@Injectable({providedIn: 'root'})
export class GuestListOrganizerService {
  private readonly convex = injectConvex();

  searchMembers(
    args: SearchCommunityMembersArgs,
  ): Promise<
    FunctionReturnType<typeof api.communities.scanners.searchGrantCandidates>
  > {
    return this.convex.query(
      api.communities.scanners.searchGrantCandidates,
      args,
    );
  }

  create(
    args: CreateGuestListAssignmentArgs,
  ): Promise<FunctionReturnType<typeof api.guest_list.assignments.create>> {
    return this.convex.mutation(api.guest_list.assignments.create, args);
  }

  bulkCreateStaff(
    args: BulkCreateStaffArgs,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.bulkCreateStaff>
  > {
    return this.convex.mutation(
      api.guest_list.assignments.bulkCreateStaff,
      args,
    );
  }

  updateGrant(
    args: UpdateGuestListGrantArgs,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.updateGrant>
  > {
    return this.convex.mutation(api.guest_list.assignments.updateGrant, args);
  }

  revoke(
    args: RevokeGuestListAssignmentArgs,
  ): Promise<FunctionReturnType<typeof api.guest_list.assignments.revoke>> {
    return this.convex.mutation(api.guest_list.assignments.revoke, args);
  }

  resendInvite(
    args: ResendGuestListInviteArgs,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.resendInvite>
  > {
    return this.convex.mutation(api.guest_list.assignments.resendInvite, args);
  }

  listGuests(
    args: ListAssignmentGuestsArgs,
  ): Promise<FunctionReturnType<typeof api.guest_list.assignments.listGuests>> {
    return this.convex.query(api.guest_list.assignments.listGuests, args);
  }

  listByEvent(
    args: ListEventAssignmentsArgs,
  ): Promise<
    FunctionReturnType<typeof api.guest_list.assignments.listByEvent>
  > {
    return this.convex.query(api.guest_list.assignments.listByEvent, args);
  }
}
