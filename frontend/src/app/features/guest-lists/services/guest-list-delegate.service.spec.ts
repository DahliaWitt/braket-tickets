import '../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {getFunctionName, type FunctionReference} from 'convex/server';
import {beforeEach, describe, expect, it} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';
import {GuestListDelegateService} from './guest-list-delegate.service';

describe('GuestListDelegateService', () => {
  let convex: MockConvexClient;
  let service: GuestListDelegateService;
  const assignmentId = 'assignment-1' as Id<'guestListAssignments'>;
  const guestId = 'guest-1' as Id<'guests'>;
  const access = {kind: 'signedIn' as const, assignmentId};

  beforeEach(() => {
    convex = createMockConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convex},
      ],
    });
    service = TestBed.inject(GuestListDelegateService);
  });

  it('uses generated paginated list and rate-limited delegate view contracts', async () => {
    convex.mutation.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    await service.listMine();
    expect(convex.mutation).toHaveBeenCalledWith(
      api.guest_list.delegate.listMine,
      {paginationOpts: {numItems: 50, cursor: null}},
    );

    convex.action.mockResolvedValue({status: 'unavailable'});
    await service.getView(access);
    expect(
      getFunctionName(
        convex.action.mock.calls.at(-1)?.[0] as FunctionReference<'action'>,
      ),
    ).toBe(
      getFunctionName(
        api.guest_list.delegate
          .getView as unknown as FunctionReference<'action'>,
      ),
    );
    expect(convex.action.mock.calls.at(-1)?.[1]).toEqual({
      access,
      paginationOpts: {numItems: 50, cursor: null},
    });

    await service.listMine('assignments-cursor');
    expect(convex.mutation).toHaveBeenLastCalledWith(
      api.guest_list.delegate.listMine,
      {paginationOpts: {numItems: 50, cursor: 'assignments-cursor'}},
    );

    await service.getView(access, 'guests-cursor');
    expect(
      getFunctionName(
        convex.action.mock.calls.at(-1)?.[0] as FunctionReference<'action'>,
      ),
    ).toBe(
      getFunctionName(
        api.guest_list.delegate
          .getView as unknown as FunctionReference<'action'>,
      ),
    );
    expect(convex.action.mock.calls.at(-1)?.[1]).toEqual({
      access,
      paginationOpts: {numItems: 50, cursor: 'guests-cursor'},
    });
  });

  it('uses the rate-limited authorization and signed-in claim entrypoints', async () => {
    convex.mutation.mockResolvedValue({status: 'available'});

    await service.authorizeToken('invite-secret');
    await service.claimSignedIn(assignmentId);

    expect(convex.mutation).toHaveBeenNthCalledWith(
      1,
      api.guest_list.delegate.authorizeToken,
      {token: 'invite-secret'},
    );
    expect(convex.mutation).toHaveBeenNthCalledWith(
      2,
      api.guest_list.delegate.claimSignedIn,
      {assignmentId},
    );
  });

  it('forwards generated mutation argument shapes for CRUD and retry', async () => {
    convex.mutation.mockResolvedValue({});
    await service.addGuest(access, {
      name: 'Mika',
      email: 'mika@example.com',
      idempotencyKey: 'request-1',
    });
    await service.updateGuest(access, {
      guestId,
      name: 'Mika R',
      email: 'mika-r@example.com',
    });
    await service.removeGuest(access, guestId);
    await service.retryTicket(access, guestId);

    expect(convex.mutation).toHaveBeenNthCalledWith(
      1,
      api.guest_list.delegate.addGuest,
      expect.objectContaining({access, idempotencyKey: 'request-1'}),
    );
    expect(convex.mutation).toHaveBeenNthCalledWith(
      2,
      api.guest_list.delegate.updateGuest,
      expect.objectContaining({access, guestId}),
    );
    expect(convex.mutation).toHaveBeenNthCalledWith(
      3,
      api.guest_list.delegate.removeGuest,
      {access, guestId},
    );
    expect(convex.mutation).toHaveBeenNthCalledWith(
      4,
      api.guest_list.delegate.retryTicket,
      {access, guestId},
    );
  });
});
