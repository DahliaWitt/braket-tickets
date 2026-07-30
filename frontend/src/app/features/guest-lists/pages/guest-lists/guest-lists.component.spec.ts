import '../../../../../test-setup';
import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {GuestListDelegateService} from '../../services/guest-list-delegate.service';
import {GuestListsComponent} from './guest-lists.component';
import {GuestListsComponentHarness} from './guest-lists.component.harness';

describe('GuestListsComponent', () => {
  const delegate = {listMine: vi.fn()};
  let fixture: ComponentFixture<GuestListsComponent>;
  let harness: GuestListsComponentHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    delegate.listMine.mockResolvedValue({
      page: [
        {
          assignmentId: 'assignment-1',
          eventId: 'event-1',
          eventTitle: 'Warehouse Signal',
          eventDate: '2026-08-01',
          role: 'artist',
          grantedSlots: 4,
          usedSlots: 2,
        },
        {
          assignmentId: 'assignment-2',
          eventId: 'event-2',
          eventTitle: 'Afterglow',
          eventDate: '2026-08-08',
          role: 'staff',
          grantedSlots: 2,
          usedSlots: 0,
        },
      ],
      isDone: true,
      continueCursor: '',
    });

    await TestBed.configureTestingModule({
      imports: [GuestListsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: GuestListDelegateService, useValue: delegate},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );
  });

  it('lists each eligible assignment with usage and a signed-in route', async () => {
    await fixture.whenStable();

    expect(await harness.getAssignmentLinks()).toEqual([
      {
        text: expect.stringContaining('Warehouse Signal') as string,
        href: '/guest-lists/assignment-1',
      },
      {
        text: expect.stringContaining('Afterglow') as string,
        href: '/guest-lists/assignment-2',
      },
    ]);
  });

  it('renders full event timestamps through the event date and end-time pipes', async () => {
    delegate.listMine.mockResolvedValue({
      page: [
        {
          assignmentId: 'assignment-1',
          eventId: 'event-1',
          eventTitle: 'Warehouse Signal',
          eventDate: '2026-08-02T04:00:00.000Z',
          eventEndDate: '2026-08-02T10:00:00.000Z',
          role: 'artist',
          grantedSlots: 4,
          usedSlots: 2,
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );

    const [{text}] = await harness.getAssignmentLinks();
    expect(text).toContain('Aug 1, 2026');
    expect(text).toContain('9:00 PM – 3:00 AM');
    expect(text).not.toContain('2026-08-02T04:00:00.000Z');
  });

  it('shows a useful empty state when no assignments remain eligible', async () => {
    delegate.listMine.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );
    await fixture.whenStable();

    expect(await harness.getEmptyText()).toContain('No active guest lists');
  });

  it('shows a retryable failure instead of hanging when assignments fail to load', async () => {
    delegate.listMine
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({page: [], isDone: true, continueCursor: ''});
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );
    await fixture.whenStable();

    expect(await harness.isLoading()).toBe(false);
    expect(await harness.getLoadFailureText()).toContain('try again');

    await harness.retryLoading();
    expect(await harness.getEmptyText()).toContain('No active guest lists');
  });

  it('appends assignment pages with an accessible Load more action', async () => {
    delegate.listMine
      .mockResolvedValueOnce({
        page: [
          {
            assignmentId: 'assignment-1',
            eventId: 'event-1',
            eventTitle: 'Warehouse Signal',
            eventDate: '2026-08-01',
            role: 'artist',
            grantedSlots: 4,
            usedSlots: 2,
          },
        ],
        isDone: false,
        continueCursor: 'assignment-page-2',
      })
      .mockResolvedValueOnce({
        page: [
          {
            assignmentId: 'assignment-2',
            eventId: 'event-2',
            eventTitle: 'Afterglow',
            eventDate: '2026-08-08',
            role: 'staff',
            grantedSlots: 2,
            usedSlots: 0,
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );
    await fixture.whenStable();

    expect(await harness.hasLoadMore()).toBe(true);
    await harness.loadMore();

    expect(delegate.listMine).toHaveBeenLastCalledWith('assignment-page-2');
    expect(await harness.getAssignmentLinks()).toHaveLength(2);
    expect(await harness.hasLoadMore()).toBe(false);
  });

  it('keeps loaded assignments visible and retries the failed cursor after pagination fails', async () => {
    delegate.listMine
      .mockResolvedValueOnce({
        page: [
          {
            assignmentId: 'assignment-1',
            eventId: 'event-1',
            eventTitle: 'Warehouse Signal',
            eventDate: '2026-08-01',
            role: 'artist',
            grantedSlots: 4,
            usedSlots: 2,
          },
        ],
        isDone: false,
        continueCursor: 'assignment-page-2',
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        page: [
          {
            assignmentId: 'assignment-2',
            eventId: 'event-2',
            eventTitle: 'Afterglow',
            eventDate: '2026-08-08',
            role: 'staff',
            grantedSlots: 2,
            usedSlots: 0,
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );

    await harness.loadMore();

    expect(await harness.getAssignmentLinks()).toHaveLength(1);
    expect(await harness.getLoadFailureText()).toBeNull();
    expect(await harness.getPaginationFailureText()).toContain('try again');

    await harness.retryPagination();

    expect(delegate.listMine).toHaveBeenLastCalledWith('assignment-page-2');
    expect(await harness.getAssignmentLinks()).toHaveLength(2);
  });

  it('keeps Load more accessible when a filtered page has no assignments', async () => {
    delegate.listMine.mockResolvedValue({
      page: [],
      isDone: false,
      continueCursor: 'assignment-page-2',
    });
    fixture = TestBed.createComponent(GuestListsComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListsComponentHarness,
    );

    expect(await harness.getEmptyText()).toContain('No active guest lists');
    expect(await harness.hasLoadMore()).toBe(true);
  });
});
