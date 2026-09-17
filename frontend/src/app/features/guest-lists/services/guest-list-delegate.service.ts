import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {api} from '@convex/_generated/api';

type ListMineArgs = FunctionArgs<typeof api.guest_list.delegate.listMine>;
type AuthorizeTokenArgs = FunctionArgs<
  typeof api.guest_list.delegate.authorizeToken
>;
type ClaimSignedInArgs = FunctionArgs<
  typeof api.guest_list.delegate.claimSignedIn
>;
type GetViewArgs = FunctionArgs<typeof api.guest_list.delegate.getView>;
type AddGuestArgs = FunctionArgs<typeof api.guest_list.delegate.addGuest>;
type UpdateGuestArgs = FunctionArgs<typeof api.guest_list.delegate.updateGuest>;
type RemoveGuestArgs = FunctionArgs<typeof api.guest_list.delegate.removeGuest>;
type RetryTicketArgs = FunctionArgs<typeof api.guest_list.delegate.retryTicket>;

export type DelegateAccess = GetViewArgs['access'];
export type SignedInDelegateAccess = Extract<
  DelegateAccess,
  {kind: 'signedIn'}
>;
export type GuestListAssignmentId = SignedInDelegateAccess['assignmentId'];
export type GuestListGuestId = UpdateGuestArgs['guestId'];

const PAGE_SIZE = 50;

@Injectable({providedIn: 'root'})
export class GuestListDelegateService {
  private readonly convex = injectConvex();

  listMine(
    cursor: ListMineArgs['paginationOpts']['cursor'] = null,
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.listMine>> {
    return this.convex.mutation(api.guest_list.delegate.listMine, {
      paginationOpts: {numItems: PAGE_SIZE, cursor},
    });
  }

  authorizeToken(
    token: AuthorizeTokenArgs['token'],
  ): Promise<
    FunctionReturnType<typeof api.guest_list.delegate.authorizeToken>
  > {
    return this.convex.mutation(api.guest_list.delegate.authorizeToken, {
      token,
    });
  }

  claimSignedIn(
    assignmentId: ClaimSignedInArgs['assignmentId'],
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.claimSignedIn>> {
    return this.convex.mutation(api.guest_list.delegate.claimSignedIn, {
      assignmentId,
    });
  }

  getView(
    access: DelegateAccess,
    cursor: GetViewArgs['paginationOpts']['cursor'] = null,
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.getView>> {
    return this.convex.action(api.guest_list.delegate.getView, {
      access,
      paginationOpts: {numItems: PAGE_SIZE, cursor},
    });
  }

  addGuest(
    access: DelegateAccess,
    details: Omit<AddGuestArgs, 'access'>,
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.addGuest>> {
    return this.convex.mutation(api.guest_list.delegate.addGuest, {
      access,
      ...details,
    });
  }

  updateGuest(
    access: DelegateAccess,
    details: Omit<UpdateGuestArgs, 'access'>,
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.updateGuest>> {
    return this.convex.mutation(api.guest_list.delegate.updateGuest, {
      access,
      ...details,
    });
  }

  removeGuest(
    access: DelegateAccess,
    guestId: RemoveGuestArgs['guestId'],
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.removeGuest>> {
    return this.convex.mutation(api.guest_list.delegate.removeGuest, {
      access,
      guestId,
    });
  }

  retryTicket(
    access: DelegateAccess,
    guestId: RetryTicketArgs['guestId'],
  ): Promise<FunctionReturnType<typeof api.guest_list.delegate.retryTicket>> {
    return this.convex.mutation(api.guest_list.delegate.retryTicket, {
      access,
      guestId,
    });
  }
}
