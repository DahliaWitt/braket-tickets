import '../../../../test-setup';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {CONVEX} from 'convex-angular';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createMockConvexClient} from '@/testing/mock-types';
import {GuestListDashboardService} from './guest-list-dashboard.service';

describe('GuestListDashboardService', () => {
  const convex = createMockConvexClient();

  beforeEach(() => {
    vi.clearAllMocks();
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
});
