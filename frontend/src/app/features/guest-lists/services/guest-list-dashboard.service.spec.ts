import '../../../../test-setup';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {CONVEX} from 'convex-angular';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createMockConvexClient} from '@/testing/mock-types';
import {AuthService} from '@/core/services/auth.service';
import {GuestListDashboardService} from './guest-list-dashboard.service';

describe('GuestListDashboardService', () => {
  const convex = createMockConvexClient();
  const user = signal<{_id: string} | undefined>({_id: 'user-a'});
  const authSettled = signal(true);

  beforeEach(() => {
    vi.clearAllMocks();
    user.set({_id: 'user-a'});
    authSettled.set(true);
    convex.onUpdate.mockImplementation(
      (_reference, _args, onData: (value: {enabled: boolean}) => void) => {
        onData({enabled: true});
        return () => undefined;
      },
    );
    convex.mutation.mockResolvedValue({
      page: [{assignmentId: 'assignment-1'}],
      isDone: true,
      continueCursor: '',
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convex},
        {
          provide: AuthService,
          useValue: {user, authSettled},
        },
      ],
    });
  });

  it('discovers an active assignment through the mutation contract', async () => {
    const service = TestBed.inject(GuestListDashboardService);

    await vi.waitFor(() => expect(service.hasActiveAssignments()).toBe(true));
    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]?.[1]).toEqual({
      paginationOpts: {numItems: 1, cursor: null},
    });
  });

  it('continues after five backend-filtered cancelled assignments to find an active one', async () => {
    convex.mutation
      .mockResolvedValueOnce({
        page: [],
        isDone: false,
        continueCursor: 'after-five-cancelled',
      })
      .mockResolvedValueOnce({
        page: [{assignmentId: 'active-assignment'}],
        isDone: true,
        continueCursor: '',
      });

    const service = TestBed.inject(GuestListDashboardService);

    await vi.waitFor(() => expect(service.hasActiveAssignments()).toBe(true));
    expect(convex.mutation).toHaveBeenCalledTimes(2);
    expect(convex.mutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      paginationOpts: {numItems: 1, cursor: null},
    });
    expect(convex.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {
        numItems: 1,
        cursor: 'after-five-cancelled',
      },
    });
  });

  it('stops discovery when the filtered assignment pages are exhausted', async () => {
    convex.mutation
      .mockResolvedValueOnce({
        page: [],
        isDone: false,
        continueCursor: 'next-filtered-page',
      })
      .mockResolvedValueOnce({
        page: [],
        isDone: true,
        continueCursor: '',
      });

    const service = TestBed.inject(GuestListDashboardService);

    await vi.waitFor(() => expect(convex.mutation).toHaveBeenCalledTimes(2));
    expect(service.hasActiveAssignments()).toBe(false);
  });

  it('does not discover assignments while self-service is disabled', async () => {
    convex.onUpdate.mockImplementation(
      (_reference, _args, onData: (value: {enabled: boolean}) => void) => {
        onData({enabled: false});
        return () => undefined;
      },
    );

    const service = TestBed.inject(GuestListDashboardService);
    await Promise.resolve();

    expect(service.hasActiveAssignments()).toBe(false);
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it('clears account A state on logout and discovers account B independently', async () => {
    convex.mutation
      .mockResolvedValueOnce({
        page: [{assignmentId: 'assignment-a'}],
        isDone: true,
        continueCursor: '',
      })
      .mockResolvedValueOnce({
        page: [],
        isDone: true,
        continueCursor: '',
      });
    const service = TestBed.inject(GuestListDashboardService);

    await vi.waitFor(() => expect(service.hasActiveAssignments()).toBe(true));

    user.set(undefined);
    await vi.waitFor(() => expect(service.hasActiveAssignments()).toBe(false));

    user.set({_id: 'user-b'});
    await vi.waitFor(() => expect(convex.mutation).toHaveBeenCalledTimes(2));

    expect(service.hasActiveAssignments()).toBe(false);
    expect(convex.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {numItems: 1, cursor: null},
    });
  });
});
