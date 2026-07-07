import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {AdminEventsTableComponent} from './events-table.component';
import {AdminEventsTableHarness} from './events-table.component.harness';
import {EventsService} from '@/features/admin/services/events.service';
import {CONVEX} from 'convex-angular';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {provideZonelessChangeDetection} from '@angular/core';
import {Router} from '@angular/router';
import {of} from 'rxjs';
import {type FunctionReturnType} from 'convex/server';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';

import {vi} from 'vitest';
import {type BraAlertDialogOptions} from '@ui/components/composites/alert-dialog/alert-dialog.component';

type AdminEventDoc = FunctionReturnType<
  typeof api.events.management.adminList
>[number];

describe('AdminEventsTableComponent', () => {
  let component: AdminEventsTableComponent;
  let fixture: ComponentFixture<AdminEventsTableComponent>;
  let eventsServiceMock: {
    delete: ReturnType<typeof vi.fn>;
  };
  let convexClientMock: MockConvexClient;
  let alertDialogMock: {
    confirm: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let latestConfirmOptions: BraAlertDialogOptions<unknown> | undefined;
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };
  const organizerId = 'org1' as Id<'organizers'>;

  const mockEventDoc: AdminEventDoc = {
    _id: '1' as Id<'events'>,
    _creationTime: Date.now(),
    title: 'Event 1',
    date: '2023-01-01',
    location: 'Loc 1',
    description: 'A long event description',
    price: 100,
    totalTickets: 10,
    status: 'published',
    posterUrl: null,
    organizerId,
  } as AdminEventDoc;

  beforeEach(async () => {
    eventsServiceMock = {
      delete: vi.fn().mockResolvedValue(true),
    };
    const onUpdate = vi
      .fn()
      .mockImplementation(
        (_query, _args, onData: (data: AdminEventDoc[]) => void) => {
          onData([mockEventDoc]);
          return () => void 0;
        },
      );
    convexClientMock = createMockConvexClient();
    convexClientMock.onUpdate = onUpdate;
    convexClientMock.client.onUpdate = onUpdate;

    latestConfirmOptions = undefined;
    alertDialogMock = {
      confirm: vi
        .fn()
        .mockImplementation((options: BraAlertDialogOptions<unknown>) => {
          latestConfirmOptions = options;
          return {
            afterClosed$: of(true),
          };
        }),
      info: vi.fn().mockReturnValue({
        afterClosed$: of(true),
      }),
    };

    routerMock = {
      navigate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AdminEventsTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: BraAlertDialogService, useValue: alertDialogMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminEventsTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // triggers ngOnInit
  });

  async function acceptLatestConfirmation(): Promise<void> {
    expect(latestConfirmOptions?.zOnOk).toBeTypeOf('function');
    latestConfirmOptions?.zOnOk?.(undefined);
    await vi.waitFor(() => expect(eventsServiceMock.delete).toHaveBeenCalled());
  }

  it('should load events on init', () => {
    expect(convexClientMock.client.onUpdate).toHaveBeenCalled();
    expect(component.events().length).toBe(1);
  });

  it('loads the global admin event list when no organizerId is provided', () => {
    expect(
      convexClientMock.client.onUpdate.mock.calls.some(
        ([queryRef, args]) =>
          functionReferenceMatches(queryRef, api.events.management.adminList) &&
          JSON.stringify(args) === JSON.stringify({}),
      ),
    ).toBe(true);
  });

  it('passes organizerId to the admin event list query when scoped', async () => {
    convexClientMock.client.onUpdate.mockClear();

    fixture.componentRef.setInput('organizerId', organizerId);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      convexClientMock.client.onUpdate.mock.calls.some(
        ([queryRef, args]) =>
          functionReferenceMatches(queryRef, api.events.management.adminList) &&
          JSON.stringify(args) === JSON.stringify({organizerId}),
      ),
    ).toBe(true);
  });

  it('should sort events by event date descending', async () => {
    convexClientMock.client.onUpdate.mockReset();
    convexClientMock.client.onUpdate.mockImplementation(
      (_query, _args, onData: (data: AdminEventDoc[]) => void) => {
        onData([
          {
            ...mockEventDoc,
            _id: 'older-created-newer-date' as Id<'events'>,
            _creationTime: Date.now() - 10_000,
            title: 'Later Event',
            date: '2026-06-01',
          },
          {
            ...mockEventDoc,
            _id: 'newer-created-older-date' as Id<'events'>,
            _creationTime: Date.now(),
            title: 'Earlier Event',
            date: '2025-01-01',
          },
        ]);
        return () => void 0;
      },
    );

    const sortedFixture = TestBed.createComponent(AdminEventsTableComponent);
    sortedFixture.detectChanges();
    await sortedFixture.whenStable();

    const sortedEvents = sortedFixture.componentInstance.events();
    expect(sortedEvents.map((event) => event._id)).toEqual([
      'older-created-newer-date',
      'newer-created-older-date',
    ]);
  });

  describe('status badges', () => {
    const pastDate = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const futureDate = new Date(Date.now() + 2 * 86_400_000).toISOString();

    async function renderEventsTable(
      events: AdminEventDoc[],
    ): Promise<AdminEventsTableHarness> {
      convexClientMock.client.onUpdate.mockReset();
      convexClientMock.client.onUpdate.mockImplementation(
        (_query, _args, onData: (data: AdminEventDoc[]) => void) => {
          onData(events);
          return () => void 0;
        },
      );

      const badgeFixture = TestBed.createComponent(AdminEventsTableComponent);
      badgeFixture.detectChanges();
      await badgeFixture.whenStable();
      return TestbedHarnessEnvironment.harnessForFixture(
        badgeFixture,
        AdminEventsTableHarness,
      );
    }

    it('shows "past" for a published event whose date has passed', async () => {
      const harness = await renderEventsTable([
        {...mockEventDoc, status: 'published', date: pastDate},
      ]);

      // Desktop and mobile badges render for the same row.
      expect(await harness.getStatusTexts()).toEqual(['past', 'past']);
      expect(await harness.getStatusVariantAtIndex(0)).toBe('muted');
    });

    it('keeps "published" for an event happening today', async () => {
      const harness = await renderEventsTable([
        {...mockEventDoc, status: 'published', date: new Date().toISOString()},
      ]);

      expect(await harness.getStatusTextAtIndex(0)).toBe('published');
      expect(await harness.getStatusVariantAtIndex(0)).toBe('success');
    });

    it('keeps "published" for a future event', async () => {
      const harness = await renderEventsTable([
        {...mockEventDoc, status: 'published', date: futureDate},
      ]);

      expect(await harness.getStatusTextAtIndex(0)).toBe('published');
      expect(await harness.getStatusVariantAtIndex(0)).toBe('success');
    });

    it('keeps draft and cancelled labels for past-dated events', async () => {
      const harness = await renderEventsTable([
        {
          ...mockEventDoc,
          _id: 'draft-past' as Id<'events'>,
          status: 'draft',
          date: pastDate,
        },
        {
          ...mockEventDoc,
          _id: 'cancelled-past' as Id<'events'>,
          status: 'cancelled',
          date: pastDate,
        },
      ]);

      expect(await harness.getStatusTextAtIndex(0)).toBe('draft');
      expect(await harness.getStatusVariantAtIndex(0)).toBe('warning');
      expect(await harness.getStatusTextAtIndex(1)).toBe('cancelled');
      expect(await harness.getStatusVariantAtIndex(1)).toBe('destructive');
    });
  });

  it('should navigate to create page', () => {
    component.openCreateEventDialog();
    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/admin',
      'events',
      'new',
    ]);
  });

  it('should navigate to edit page', () => {
    component.editEvent(mockEventDoc);
    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/admin',
      'events',
      '1',
      'edit',
    ]);
  });

  it('should navigate to edit page when the row action is clicked', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    await harness.clickEditAtIndex(0);

    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/admin',
      'events',
      '1',
      'edit',
    ]);
  });

  it('should let modified row action clicks use native link behavior', () => {
    const clickEvent = new MouseEvent('click', {
      button: 0,
      cancelable: true,
      metaKey: true,
    });

    component.navigateToEvent(clickEvent, mockEventDoc, 'edit');

    expect(clickEvent.defaultPrevented).toBe(false);
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('should navigate to management page', () => {
    component.manageEvent(mockEventDoc);
    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/admin',
      'events',
      '1',
      'manage',
    ]);
  });

  it('should navigate to management page when the row action is clicked', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    await harness.clickManageAtIndex(0);

    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/admin',
      'events',
      '1',
      'manage',
    ]);
  });

  it('renders edit and manage actions with href fallbacks', async () => {
    await fixture.whenStable();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    expect(await harness.getManageHrefAtIndex(0)).toBe(
      '/admin/events/1/manage',
    );
    expect(await harness.getEditHrefAtIndex(0)).toBe('/admin/events/1/edit');
  });

  it('renders the mobile manage action before event details', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    const mobileContent = (
      await harness.getMobileContentTextAtIndex(0)
    ).toLowerCase();

    expect(mobileContent.indexOf('manage')).toBeGreaterThanOrEqual(0);
    expect(mobileContent.indexOf('description')).toBeGreaterThan(
      mobileContent.indexOf('manage'),
    );
  });

  it('should navigate using custom routePrefix', () => {
    fixture.componentRef.setInput('routePrefix', '/community-admin');
    component.openCreateEventDialog();
    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/community-admin',
      'events',
      'new',
    ]);
  });

  it('uses custom routePrefix in row action href fallbacks', async () => {
    fixture.componentRef.setInput('routePrefix', '/community-admin');
    await fixture.whenStable();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    expect(await harness.getManageHrefAtIndex(0)).toBe(
      '/community-admin/events/1/manage',
    );
    expect(await harness.getEditHrefAtIndex(0)).toBe(
      '/community-admin/events/1/edit',
    );
  });

  it('includes route query params in row action hrefs and navigation', async () => {
    fixture.componentRef.setInput('routePrefix', '/community-admin');
    fixture.componentRef.setInput('routeQueryParams', {community: 'lot-45'});
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    expect(await harness.getManageHrefAtIndex(0)).toBe(
      '/community-admin/events/1/manage?community=lot-45',
    );
    expect(await harness.getEditHrefAtIndex(0)).toBe(
      '/community-admin/events/1/edit?community=lot-45',
    );

    await harness.clickManageAtIndex(0);

    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/community-admin', 'events', '1', 'manage'],
      {queryParams: {community: 'lot-45'}},
    );
  });

  it('should delete event after confirmation', async () => {
    await component.deleteEvent(mockEventDoc);

    expect(alertDialogMock.confirm).toHaveBeenCalled(); // Confirm dialog
    expect(eventsServiceMock.delete).not.toHaveBeenCalled();
    await acceptLatestConfirmation();
    expect(eventsServiceMock.delete).toHaveBeenCalledWith('1');
    await vi.waitFor(() =>
      expect(convexClientMock.client.onUpdate).toHaveBeenCalledTimes(2),
    ); // Init + Refetch
  });

  it('should open delete confirmation when the row action is clicked', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    await harness.clickDeleteAtIndex(0);
    await fixture.whenStable();

    expect(alertDialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Delete Event',
        zOkText: 'Delete Event',
      }),
    );
    expect(eventsServiceMock.delete).not.toHaveBeenCalled();
    await acceptLatestConfirmation();
    expect(eventsServiceMock.delete).toHaveBeenCalledWith('1');
  });

  it('labels each delete action with the event title', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminEventsTableHarness,
    );

    expect(await harness.getDeleteAriaLabelAtIndex(0)).toBe(
      'Delete event Event 1, id 1',
    );
  });

  it('should warn generically before deleting an event without sold tickets', async () => {
    await component.deleteEvent({...mockEventDoc, soldCount: 0});

    expect(alertDialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Delete Event',
        zDescription:
          'Are you sure you want to delete "Event 1"? This action cannot be undone.',
        zOkText: 'Delete Event',
      }),
    );
  });

  it('should block deletion and explain impact when sold tickets exist', async () => {
    await component.deleteEvent({...mockEventDoc, soldCount: 3});

    expect(alertDialogMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Cannot Delete Event',
        zDescription:
          '"Event 1" has 3 sold tickets. Events with sold tickets cannot be deleted because doing so would invalidate ticket holders\' purchases and QR codes.',
        zOkText: 'Close',
      }),
    );
    expect(eventsServiceMock.delete).not.toHaveBeenCalled();
  });

  it('should block deletion when completed orders exist without sold tickets', async () => {
    await component.deleteEvent({
      ...mockEventDoc,
      soldCount: 0,
      hasCompletedOrders: true,
    });

    expect(alertDialogMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Cannot Delete Event',
        zDescription:
          '"Event 1" has completed orders. Events with completed purchases cannot be deleted because Braket Tickets must preserve purchase history and related records.',
        zOkText: 'Close',
      }),
    );
    expect(eventsServiceMock.delete).not.toHaveBeenCalled();
  });

  it('should block deletion when ticket history exists without sold tickets', async () => {
    await component.deleteEvent({
      ...mockEventDoc,
      soldCount: 0,
      hasAnyTickets: true,
    });

    expect(alertDialogMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Cannot Delete Event',
        zDescription:
          '"Event 1" has existing ticket records. Events with ticket history cannot be deleted because Braket Tickets must preserve ticket and attendee records.',
        zOkText: 'Close',
      }),
    );
    expect(eventsServiceMock.delete).not.toHaveBeenCalled();
  });
});
