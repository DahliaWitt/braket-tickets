import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  provideZonelessChangeDetection,
  signal,
  type WritableSignal,
} from '@angular/core';
import {By} from '@angular/platform-browser';
import {Router, ActivatedRoute, convertToParamMap} from '@angular/router';

import {EventEditorComponent} from './event-editor.component';
import {EventEditorHarness} from './event-editor.component.harness';
import {EventPublishDialogComponent} from '@/features/admin/components/event-publish-dialog/event-publish-dialog.component';
import {BraDatePickerComponent} from '@/ui/components/composites/date-picker/date-picker.component';
import {AuthService} from '@/core/services/auth.service';
import {EventsService} from '@/features/admin/services/events.service';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {CommunitiesService} from '@/core/services/communities.service';
import {CONVEX} from 'convex-angular';
import {toast} from 'ngx-sonner';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {createMockConvexClient} from '@/testing/mock-types';
import {type EditableEvent} from '@/core/models/event.types';
import {MAX_EVENT_TITLE_LENGTH} from '@shared/constants';
import {getTodayInEventTimeZone} from '@/utils/event-date-format';

/** Minimal Convex client mock that satisfies injectConvexQuery + injectConvexMutation. */
function makeConvexClientMock(
  onUpdateImpl?: (
    queryFn: unknown,
    args: unknown,
    onData: (v: unknown) => void,
    onError: (e: Error) => void,
  ) => () => void,
) {
  const convexMock = createMockConvexClient();
  const onUpdate = vi.fn(
    (
      queryFn: unknown,
      args: unknown,
      onData: (v: unknown) => void,
      onError: (e: Error) => void,
    ) => {
      if (onUpdateImpl) {
        return onUpdateImpl(queryFn, args, onData, onError);
      }
      // Default: immediately resolve with empty recipient count
      onData({count: 0, cappedAt500: false});
      return () => undefined;
    },
  );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  convexMock.mutation = vi.fn().mockResolvedValue(undefined);
  convexMock.action = vi.fn().mockResolvedValue(undefined);
  return convexMock;
}

type MockAuthService = Pick<AuthService, 'currentUser' | 'userRole'>;
interface MockCommunityContextService {
  selectedCommunityId: WritableSignal<string>;
  selectedCommunityName: WritableSignal<string>;
  selectCommunity: ReturnType<typeof vi.fn>;
  setResolvedNames: ReturnType<typeof vi.fn>;
}
interface MockEventsService {
  getOne: ReturnType<typeof vi.fn>;
  getOneForEdit: ReturnType<typeof vi.fn>;
  updateWithPoster: ReturnType<typeof vi.fn>;
  createWithPoster: ReturnType<typeof vi.fn>;
  getPosterUrl: ReturnType<typeof vi.fn>;
}
interface MockCommunitiesService {
  list: ReturnType<typeof vi.fn>;
  getBySlugOrId: ReturnType<typeof vi.fn>;
}
interface MockRouter {
  navigate: ReturnType<typeof vi.fn>;
}
type MockActivatedRoute = Pick<ActivatedRoute, 'snapshot'>;

function getStartOfToday(): Date {
  return getTodayInEventTimeZone();
}

function getFutureDate(daysAhead = 30): Date {
  const future = getStartOfToday();
  future.setDate(future.getDate() + daysAhead);
  return future;
}

function getFutureDateYmd(daysAhead = 30): string {
  const future = getFutureDate(daysAhead);
  const year = future.getFullYear();
  const month = String(future.getMonth() + 1).padStart(2, '0');
  const day = String(future.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('EventEditorComponent', () => {
  let fixture: ComponentFixture<EventEditorComponent>;
  let component: EventEditorComponent;
  let harness: EventEditorHarness;
  let authServiceMock: MockAuthService;
  let eventsServiceMock: MockEventsService;
  let communitiesServiceMock: MockCommunitiesService;
  let communityContextMock: MockCommunityContextService;
  let routerMock: MockRouter;
  let activatedRouteMock: MockActivatedRoute;
  let toastSuccessSpy: ReturnType<typeof vi.spyOn>;
  let toastErrorSpy: ReturnType<typeof vi.spyOn>;

  const mockEvent: EditableEvent = {
    _id: 'evt123',
    _creationTime: Date.now(),
    title: 'Test Event',
    date: '2026-06-05T06:30:00.000Z',
    location: 'Test Location',
    description: 'Test Description',
    price: 2000,
    supporterDefaultPrice: 2500, // Must be > price
    slidingScaleEnabled: false,
    slidingScaleMin: 0,
    slidingScaleMax: 0,
    totalTickets: 100,
    poster: 'poster.jpg',
    organizerId: 'org1',
    status: 'draft',
  } as EditableEvent;

  beforeEach(async () => {
    vi.clearAllMocks();
    toastSuccessSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

    authServiceMock = {
      currentUser: signal(null),
      userRole: signal('user'),
    };

    eventsServiceMock = {
      getOne: vi.fn().mockResolvedValue(mockEvent),
      getOneForEdit: vi.fn().mockResolvedValue(mockEvent),
      updateWithPoster: vi.fn().mockResolvedValue(mockEvent),
      createWithPoster: vi.fn(),
      getPosterUrl: vi.fn().mockReturnValue('mock-url'),
    };

    communitiesServiceMock = {
      list: vi.fn().mockResolvedValue([
        {_id: 'org1', name: 'Community 1', email: 'org1@example.com'},
        {_id: 'org2', name: 'Community 2', email: 'org2@example.com'},
      ]),
      getBySlugOrId: vi.fn().mockResolvedValue({
        _id: 'org1',
        name: 'Community 1',
        email: 'org1@example.com',
      }),
    };

    communityContextMock = {
      selectedCommunityId: signal('org1'),
      selectedCommunityName: signal('Community 1'),
      selectCommunity: vi.fn((id: string) =>
        communityContextMock.selectedCommunityId.set(id),
      ),
      setResolvedNames: vi.fn(),
    };

    routerMock = {
      navigate: vi.fn(),
    };

    activatedRouteMock = {
      snapshot: {
        paramMap: {
          get: () => null,
          getAll: () => [],
          has: () => false,
          keys: [],
        },
        queryParamMap: convertToParamMap({community: 'lot-45'}),
      },
    } as unknown as MockActivatedRoute;

    await TestBed.configureTestingModule({
      imports: [EventEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: authServiceMock},
        {provide: EventsService, useValue: eventsServiceMock},
        {
          provide: CommunityContextService,
          useValue: communityContextMock as unknown as CommunityContextService,
        },
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {provide: Router, useValue: routerMock},
        {provide: ActivatedRoute, useValue: activatedRouteMock},
        {provide: CONVEX, useValue: makeConvexClientMock()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventEditorComponent);
    component = fixture.componentInstance;

    // Set Input for Edit Mode
    fixture.componentRef.setInput('id', 'evt123');

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventEditorHarness,
    );

    // Initial data loading happens via the route-keyed resource
    fixture.detectChanges();
    await fixture.whenStable();

    // Ensure loading is finished to avoid flakiness
    expect(component.isLoading()).toBe(false);

    fixture.detectChanges();
  });

  it('preserves community query params for events-list navigation', () => {
    expect(component.eventsListQueryParams()).toEqual({community: 'lot-45'});
  });

  it('should load event data into form', async () => {
    // Verify Form Model (Signal Forms)
    expect(component.eventModel().title).toBe('Test Event');
    expect(component.eventModel().date?.getFullYear()).toBe(2026);
    expect(component.eventModel().date?.getMonth()).toBe(5);
    expect(component.eventModel().date?.getDate()).toBe(4);
    expect(component.eventModel().time).toBe('23:30');

    expect(await harness.isSaveButtonDisabled()).toBe(false); // Valid form = Enabled
    expect(eventsServiceMock.getOneForEdit).toHaveBeenCalledWith('evt123');
  });

  it('should keep save button enabled when form is modified', async () => {
    expect(await harness.isSaveButtonDisabled()).toBe(false);
    component.eventModel.update((m) => ({...m, title: 'Updated Title'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(false);
  });

  it(`should disable save button when title exceeds ${MAX_EVENT_TITLE_LENGTH} characters`, async () => {
    const longTitle = 'A'.repeat(MAX_EVENT_TITLE_LENGTH + 1);
    component.eventModel.update((m) => ({...m, title: longTitle}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .title()
        .errors()
        .some((e) => e.kind === 'maxLength'),
    ).toBe(true);
    expect(component.isFormValid()).toBe(false);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it(`should enable save button when title is exactly ${MAX_EVENT_TITLE_LENGTH} characters`, async () => {
    const exactTitle = 'A'.repeat(MAX_EVENT_TITLE_LENGTH);
    component.eventModel.update((m) => ({...m, title: exactTitle}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .title()
        .errors()
        .some((e) => e.kind === 'maxLength'),
    ).toBe(false);
    expect(component.isFormValid()).toBe(true);
    expect(await harness.isSaveButtonDisabled()).toBe(false);
  });

  it(`should show error message when title exceeds ${MAX_EVENT_TITLE_LENGTH} characters`, async () => {
    const longTitle = 'A'.repeat(MAX_EVENT_TITLE_LENGTH + 1);
    component.eventModel.update((m) => ({...m, title: longTitle}));
    fixture.detectChanges();
    await fixture.whenStable();

    const errorText = await harness.getTitleTooLongErrorText();
    expect(errorText).not.toBeNull();
    expect(errorText).toContain(
      `Title cannot exceed ${MAX_EVENT_TITLE_LENGTH} characters`,
    );
  });

  it(`should not show title-too-long error when title is exactly ${MAX_EVENT_TITLE_LENGTH} characters`, async () => {
    const exactTitle = 'A'.repeat(MAX_EVENT_TITLE_LENGTH);
    component.eventModel.update((m) => ({...m, title: exactTitle}));
    fixture.detectChanges();
    await fixture.whenStable();

    const errorText = await harness.getTitleTooLongErrorText();
    expect(errorText).toBeNull();
  });

  it('should disable save button when title is whitespace-only', async () => {
    component.eventModel.update((m) => ({...m, title: '   '}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .title()
        .errors()
        .some((e) => e.kind === 'required'),
    ).toBe(true);
    expect(component.isFormValid()).toBe(false);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should show blank title error message when title is whitespace-only', async () => {
    component.eventModel.update((m) => ({...m, title: '   '}));
    fixture.detectChanges();
    await fixture.whenStable();

    const errorText = await harness.getTitleBlankErrorText();
    expect(errorText).not.toBeNull();
    expect(errorText).toContain('Title is required');
  });

  it('should reject nonexistent event-local times during spring-forward DST', async () => {
    component.eventModel.update((m) => ({
      ...m,
      date: new Date(2027, 2, 14),
      time: '02:30',
    }));
    component.submitted.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventForm.time().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'invalidEventTime'}),
      ]),
    );
    expect(component.isFormValid()).toBe(false);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
    expect(await harness.getTimeErrorText()).toContain(
      'Choose a valid time for this date',
    );
  });

  it('should require end date and end time together', async () => {
    component.eventModel.update((m) => ({
      ...m,
      date: getFutureDate(31),
      endTime: '06:00',
    }));
    component.submitted.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventForm.endTime().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'endDateTimePair'}),
      ]),
    );
    expect(await harness.isSaveButtonDisabled()).toBe(true);
    expect(await harness.getEndTimeErrorText()).toContain(
      'Set both end date and time',
    );
  });

  it('should reject an end before the event start', async () => {
    const eventDate = getFutureDate(31);
    component.eventModel.update((m) => ({
      ...m,
      date: eventDate,
      time: '22:00',
      endDate: eventDate,
      endTime: '20:00',
    }));
    component.submitted.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventForm.endTime().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'endBeforeStart'}),
      ]),
    );
    expect(await harness.isSaveButtonDisabled()).toBe(true);
    expect(await harness.getEndTimeErrorText()).toContain(
      'End date must be after the event start',
    );
  });

  it('should reject an end more than the max duration after the start', async () => {
    component.eventModel.update((m) => ({
      ...m,
      date: getFutureDate(31),
      time: '20:00',
      endDate: getFutureDate(31 + 45), // 45 days > 30-day cap
      endTime: '20:00',
    }));
    component.submitted.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventForm.endTime().errors()).toEqual(
      expect.arrayContaining([expect.objectContaining({kind: 'endTooFar'})]),
    );
    expect(await harness.isSaveButtonDisabled()).toBe(true);
    expect(await harness.getEndTimeErrorText()).toContain(
      'within 30 days of the event start',
    );
  });

  it('should submit an overnight end window as an ISO endDate after the start', async () => {
    const eventDate = getFutureDate(31);
    const endDate = getFutureDate(32);
    component.eventModel.update((m) => ({
      ...m,
      date: eventDate,
      time: '22:00',
      endDate,
      endTime: '06:00',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(false);

    await component.onSubmit('published');
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalledTimes(1);
    const submitted = eventsServiceMock.updateWithPoster.mock.calls[0][0] as {
      date: string;
      endDate: string;
    };
    expect(submitted.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(new Date(submitted.endDate).getTime()).toBeGreaterThan(
      new Date(submitted.date).getTime(),
    );
  });

  it('should submit endDate null when the end window is cleared in edit mode', async () => {
    component.eventModel.update((m) => ({
      ...m,
      date: getFutureDate(31),
      endDate: null,
      endTime: '',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('published');
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({endDate: null}),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('should submit null for location, description, supporterDefaultPrice, and maxTicketsPerUser when cleared in edit mode', async () => {
    component.eventModel.update((m) => ({
      ...m,
      location: '',
      description: '',
      supporterDefaultPrice: '',
      maxTicketsPerUser: '',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('published');
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({
        location: null,
        description: null,
        supporterDefaultPrice: null,
        maxTicketsPerUser: null,
      }),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('should submit new values (not null) when location and supporter price are set in edit mode', async () => {
    component.eventModel.update((m) => ({
      ...m,
      location: 'New Venue',
      supporterDefaultPrice: '40',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('published');
    await fixture.whenStable();

    const submitted = eventsServiceMock.updateWithPoster.mock.calls[0][0] as {
      location: string | null;
      supporterDefaultPrice: number | null;
    };
    expect(submitted.location).toBe('New Venue');
    expect(submitted.supporterDefaultPrice).toBe(4000);
  });

  it('should enable save button when a file is selected', async () => {
    // Simulate the child component emitting a fileChanged event to the parent
    const mockFile = new File([''], 'test.png', {type: 'image/png'});
    component.onPosterFileChanged(mockFile);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(false);
    // Parent tracks the file for upload purposes
    expect(component.posterFile()).toBe(mockFile);
    expect(component.hasPosterChange()).toBe(true);
  });

  it('should show success toast and reload on successful submit', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'Modified Title',
      date: getFutureDate(31),
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(false);

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalled();
    expect(toastSuccessSpy).toHaveBeenCalledWith('Event updated successfully');
    expect(eventsServiceMock.getOneForEdit).toHaveBeenCalledTimes(2);
    expect(await harness.isSaveButtonDisabled()).toBe(false);
  });

  it('should show error toast on failed submit', async () => {
    eventsServiceMock.updateWithPoster.mockRejectedValueOnce(
      new Error('Update failed'),
    );

    component.eventModel.update((m) => ({
      ...m,
      title: 'Modified Title',
      date: getFutureDate(31),
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(toastErrorSpy).toHaveBeenCalledWith('Failed to update event');
    expect(await harness.isSaveButtonDisabled()).toBe(false); // Should still be enabled if failed
  });

  it('wires the price input wheel guard so scrolling cannot change dollars', async () => {
    const preventWheelSpy = vi.spyOn(component, 'preventNumericInputWheel');

    await harness.wheelPriceInput();

    expect(preventWheelSpy).toHaveBeenCalledTimes(1);
  });

  it('prevents numeric input wheel defaults and blurs the focused field', () => {
    const input = document.createElement('input');
    const blurSpy = vi.spyOn(input, 'blur');
    const event = new Event('wheel', {cancelable: true});
    input.addEventListener('wheel', (wheelEvent) =>
      component.preventNumericInputWheel(wheelEvent),
    );

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(blurSpy).toHaveBeenCalled();
  });

  it('should remain enabled when clearing a selected file (if form is valid)', async () => {
    const mockFile = new File([''], 'test.png', {type: 'image/png'});
    component.onPosterFileChanged(mockFile);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isSaveButtonDisabled()).toBe(false);
    expect(component.hasPosterChange()).toBe(true);

    // Simulate the child emitting null (clear)
    component.onPosterFileChanged(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isSaveButtonDisabled()).toBe(false); // Valid form
    expect(component.hasPosterChange()).toBe(false);
    expect(component.posterFile()).toBeNull();
  });

  describe('upload abort behavior', () => {
    it('should not show error toast when upload is aborted', async () => {
      const abortError = new DOMException(
        'The operation was aborted.',
        'AbortError',
      );
      eventsServiceMock.updateWithPoster.mockRejectedValueOnce(abortError);

      component.eventModel.update((m) => ({
        ...m,
        title: 'Test Event',
        date: getFutureDate(31),
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const file = new File(['content'], 'poster.jpg', {type: 'image/jpeg'});
      component.onPosterFileChanged(file);
      fixture.detectChanges();
      await fixture.whenStable();

      await component.onSubmit('draft');
      fixture.detectChanges();
      await fixture.whenStable();

      // Should NOT show error toast for abort
      expect(toastErrorSpy).not.toHaveBeenCalled();
      expect(component.isSubmitting()).toBe(false);
    });

    it('should show error toast for non-abort errors', async () => {
      eventsServiceMock.updateWithPoster.mockRejectedValueOnce(
        new Error('Network error'),
      );

      component.eventModel.update((m) => ({
        ...m,
        title: 'Test Event',
        date: getFutureDate(31),
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const file = new File(['content'], 'poster.jpg', {type: 'image/jpeg'});
      component.onPosterFileChanged(file);
      fixture.detectChanges();
      await fixture.whenStable();

      await component.onSubmit('draft');
      fixture.detectChanges();
      await fixture.whenStable();

      // Should show error toast for non-abort errors
      expect(toastErrorSpy).toHaveBeenCalledWith('Failed to update event');
    });
  });

  it('should allow save when organizerId is empty in edit mode (legacy events)', async () => {
    component.eventModel.update((m) => ({...m, organizerId: ''}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Edit mode: organizerId is optional (some legacy events lack one)
    expect(component.isFormValid()).toBe(true);
    expect(await harness.isSaveButtonDisabled()).toBe(false);
  });

  it('should render visibility selector defaulting to private', async () => {
    const selected = await harness.getSelectedVisibility();
    expect(selected).toBe('private');
  });

  it('should explain who can view and buy for each visibility option', async () => {
    expect(await harness.getVisibilityHelperText('private')).toContain(
      'View: signed-in vetted users / Buy: signed-in vetted users',
    );
    expect(await harness.getVisibilityHelperText('public_viewable')).toContain(
      'View: anyone / Buy: signed-in vetted users',
    );
    expect(await harness.getVisibilityHelperText('public')).toContain(
      'View: anyone / Buy: anyone',
    );
  });

  it('should update visibility when a radio option is selected', async () => {
    await harness.selectVisibility('public_viewable');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().visibility).toBe('public_viewable');

    await harness.selectVisibility('public');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().visibility).toBe('public');

    await harness.selectVisibility('private');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().visibility).toBe('private');
  });

  it('should include organizerId when updating event', async () => {
    component.eventModel.update((m) => ({
      ...m,
      organizerId: 'org1',
      title: 'Updated Title',
      date: getFutureDate(31),
      time: '23:15',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const [args, posterFile, onProgress, signal] = eventsServiceMock
      .updateWithPoster.mock.calls[0] as unknown as [
      {
        id: string;
        organizerId: unknown;
        date: string;
      },
      undefined,
      (pct: number) => void,
      AbortSignal,
    ];
    expect(args.id).toBe('evt123');
    expect(args.organizerId).toBeDefined();
    expect(posterFile).toBeUndefined();
    expect(onProgress).toEqual(expect.any(Function));
    expect(signal).toBeInstanceOf(AbortSignal);
    const updateArgs = args as {
      date: string;
    };
    expect(updateArgs.date).toMatch(/T/);
    const savedTimeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(updateArgs.date));
    expect(savedTimeParts.find((part) => part.type === 'hour')?.value).toBe(
      '23',
    );
    expect(savedTimeParts.find((part) => part.type === 'minute')?.value).toBe(
      '15',
    );
  });

  it('should show error message when totalTickets is a decimal', async () => {
    component.eventModel.update((m) => ({...m, totalTickets: '1.5'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getTotalTicketsErrorText()).toBe(
      'Must be a whole number',
    );
  });

  it('should show error message when maxTicketsPerUser is a decimal', async () => {
    component.eventModel.update((m) => ({...m, maxTicketsPerUser: '2.5'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getMaxTicketsPerUserErrorText()).toBe(
      'Must be a whole number',
    );
  });

  it('should disable save button when totalTickets is a decimal', async () => {
    component.eventModel.update((m) => ({...m, totalTickets: '1.5'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should show "Must be at least 1" error when maxTicketsPerUser is 0', async () => {
    component.eventModel.update((m) => ({...m, maxTicketsPerUser: '0'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getMaxTicketsPerUserErrorText()).toBe(
      'Must be at least 1',
    );
  });

  it('should disable save when maxTicketsPerUser is 0', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
      maxTicketsPerUser: '0',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should not be dirty after loading event data (edit mode)', () => {
    // The initial resource load seeds pristineModel to match eventModel.
    expect(component.isDirty()).toBe(false);
  });

  it('should reset to create defaults when the route id is cleared', async () => {
    fixture.componentRef.setInput('id', undefined);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isCreateMode()).toBe(true);
    expect(component.event()).toBeNull();
    expect(component.eventModel().title).toBe('');
    expect(component.eventModel().organizerId).toBe('org1');
  });

  it('should preserve unsaved edit-mode changes when community context changes', async () => {
    component.eventModel.update((model) => ({...model, title: 'Unsaved edit'}));
    fixture.detectChanges();
    await fixture.whenStable();

    communityContextMock.selectedCommunityId.set('org2');
    communityContextMock.selectedCommunityName.set('Community 2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.eventModel().title).toBe('Unsaved edit');
    expect(component.isDirty()).toBe(true);
  });

  it('should be dirty after modifying a field in edit mode', () => {
    component.eventModel.update((m) => ({...m, title: 'Changed'}));
    expect(component.isDirty()).toBe(true);
  });

  it('should not be dirty after successful save in edit mode (pristine reset via resource reload)', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'Modified Title',
      date: getFutureDate(31),
    }));
    expect(component.isDirty()).toBe(true);

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    // The resource reload resets pristineModel to match the reloaded eventModel.
    expect(component.isDirty()).toBe(false);
  });

  it('should clear dirty state immediately after a successful edit save while reload is pending', async () => {
    let resolveReload: ((event: EditableEvent) => void) | undefined;
    const pendingReload = new Promise<EditableEvent>((resolve) => {
      resolveReload = resolve;
    });
    eventsServiceMock.getOneForEdit.mockReturnValueOnce(pendingReload);

    component.eventModel.update((model) => ({
      ...model,
      title: 'Modified Title',
      date: getFutureDate(31),
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isDirty()).toBe(true);

    await component.onSubmit('published');

    expect(component.isDirty()).toBe(false);

    resolveReload?.({
      ...mockEvent,
      title: 'Modified Title',
      date: getFutureDateYmd(31),
    });
  });

  it('should detect date changes as dirty', () => {
    component.eventModel.update((m) => ({...m, date: getFutureDate(60)}));
    expect(component.isDirty()).toBe(true);
  });

  it('should detect visibility changes as dirty', () => {
    component.eventModel.update((m) => ({...m, visibility: 'public' as const}));
    expect(component.isDirty()).toBe(true);
  });

  it('defaults the NOTAFLOF maximum amount through the rendered toggle', async () => {
    expect(component.isDirty()).toBe(false);

    await harness.setSlidingScaleEnabled(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSlidingScaleEnabled()).toBe(true);
    expect(component.eventModel().slidingScaleEnabled).toBe(true);
    expect(component.eventModel().slidingScaleMax).toBe('10');
    expect(await harness.getSlidingScaleMaxValue()).toBe('10');
    expect(component.isDirty()).toBe(true);

    await harness.setSlidingScaleEnabled(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSlidingScaleEnabled()).toBe(false);
    expect(component.eventModel().slidingScaleEnabled).toBe(false);
    expect(component.isDirty()).toBe(false);
  });

  it('sends an explicit disable so turning sliding scale off in edit mode persists', async () => {
    // Turn NOTAFLOF on, then back off, then save. The submitted payload must
    // carry `{enabled: false}`. Sending `undefined` is a silent backend no-op
    // (lib/events/writes.ts skips slidingScale* when sliderConfig is undefined),
    // which would leave sliding-scale pricing on after a "successful" save and
    // flip the toggle back on when the form reloads.
    await harness.setSlidingScaleEnabled(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isSlidingScaleEnabled()).toBe(true);

    await harness.setSlidingScaleEnabled(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isSlidingScaleEnabled()).toBe(false);

    await component.onSubmit('published');
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalledTimes(1);
    const args = eventsServiceMock.updateWithPoster.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(args['sliderConfig']).toEqual({enabled: false});
  });

  it('still sends an explicit enable payload when sliding scale is turned on in edit mode', async () => {
    await harness.setSlidingScaleEnabled(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await harness.isSlidingScaleEnabled()).toBe(true);

    await component.onSubmit('published');
    await fixture.whenStable();

    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalledTimes(1);
    const args = eventsServiceMock.updateWithPoster.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(args['sliderConfig']).toMatchObject({enabled: true});
  });

  // ── Publish dialog ──────────────────────────────────────────────────

  it('shows publish dialog when save("published") is called', async () => {
    expect(component.showPublishDialog()).toBe(false);
    component.save('published');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showPublishDialog()).toBe(true);
    expect(await harness.isPublishDialogVisible()).toBe(true);
  });

  it('hides publish dialog on cancel and does not call onSubmit', async () => {
    const onSubmitSpy = vi.spyOn(component, 'onSubmit');

    component.save('published');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isPublishDialogVisible()).toBe(true);

    await harness.cancelPublishDialog();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showPublishDialog()).toBe(false);
    expect(onSubmitSpy).not.toHaveBeenCalled();
  });

  it('calls onSubmit("published") with skip announcement when confirmPublish is called with "skip"', async () => {
    const onSubmitSpy = vi.spyOn(component, 'onSubmit');

    // Open dialog and switch to 'skip' — use harness methods
    await harness.openPublishDialog();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialogInstance = fixture.debugElement.query(
      By.directive(EventPublishDialogComponent),
    ).componentInstance as EventPublishDialogComponent;
    dialogInstance.announcementChoice.set('skip');
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.confirmPublish();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(onSubmitSpy).toHaveBeenCalledWith('published', {mode: 'skip'});
    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalled();
  });

  it('dialog flow: open → pick "now" → read recipient count → confirm publish', async () => {
    const onSubmitSpy = vi.spyOn(component, 'onSubmit');

    // 1. Open the publish dialog via harness
    await harness.openPublishDialog();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isPublishDialogVisible()).toBe(true);

    // 2. Pick "now" announcement option via harness
    await harness.setAnnouncementChoice('now');
    fixture.detectChanges();
    await fixture.whenStable();

    // 3. Read recipient count text via harness
    const countText = await harness.getRecipientCountText();
    expect(countText).toBeTruthy();
    expect(countText).toContain('opted-in member');

    // 4. Confirm publish via harness
    await harness.confirmPublish();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(onSubmitSpy).toHaveBeenCalledWith('published', {mode: 'now'});
    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalled();
  });

  it('does not show publish dialog when save("draft") is called', async () => {
    component.save('draft');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showPublishDialog()).toBe(false);
    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalled();
  });

  it('saves published changes directly when the event is already published', async () => {
    eventsServiceMock.getOneForEdit.mockResolvedValue({
      ...mockEvent,
      status: 'published',
    } satisfies EditableEvent);
    await (
      component as unknown as {
        editEventResource: {reload(): Promise<void>};
      }
    ).editEventResource.reload();
    fixture.detectChanges();
    await fixture.whenStable();

    component.save('published');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.showPublishDialog()).toBe(false);
    expect(eventsServiceMock.updateWithPoster).toHaveBeenCalled();
  });
});

describe('EventEditorComponent - Create Mode', () => {
  let fixture: ComponentFixture<EventEditorComponent>;
  let component: EventEditorComponent;
  let harness: EventEditorHarness;
  let eventsServiceMock: MockEventsService;
  let communitiesServiceMock: MockCommunitiesService;
  let routerMock: MockRouter;
  let toastSuccessSpy: ReturnType<typeof vi.spyOn>;
  let toastErrorSpy: ReturnType<typeof vi.spyOn>;

  const fillValidCreateForm = (
    statusOverrides: Partial<ReturnType<typeof component.eventModel>> = {},
  ) => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
      ...statusOverrides,
    }));
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    toastSuccessSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

    eventsServiceMock = {
      getOne: vi.fn(),
      getOneForEdit: vi.fn(),
      updateWithPoster: vi.fn(),
      createWithPoster: vi.fn().mockResolvedValue('new-evt'),
      getPosterUrl: vi.fn().mockReturnValue('mock-url'),
    };

    communitiesServiceMock = {
      list: vi.fn().mockResolvedValue([
        {_id: 'org1', name: 'Community 1', email: 'org1@example.com'},
        {_id: 'org2', name: 'Community 2', email: 'org2@example.com'},
      ]),
      getBySlugOrId: vi.fn().mockResolvedValue({
        _id: 'org1',
        name: 'Community 1',
        email: 'org1@example.com',
      }),
    };

    routerMock = {
      navigate: vi.fn(),
    };

    const activatedRouteMock = {
      snapshot: {
        paramMap: {
          get: () => null,
          getAll: () => [],
          has: () => false,
          keys: [],
        },
        queryParamMap: convertToParamMap({community: 'lot-45'}),
      },
    } as unknown as MockActivatedRoute;

    await TestBed.configureTestingModule({
      imports: [EventEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: {currentUser: signal(null), userRole: signal('user')},
        },
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {provide: Router, useValue: routerMock},
        {provide: ActivatedRoute, useValue: activatedRouteMock},
        {provide: CONVEX, useValue: makeConvexClientMock()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventEditorComponent);
    component = fixture.componentInstance;
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventEditorHarness,
    );

    // Create Mode: Do not set 'id' input (or set undefined implicitly)

    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should be in create mode when no id param', () => {
    expect(fixture.componentInstance.isCreateMode()).toBe(true);
    expect(eventsServiceMock.getOneForEdit).not.toHaveBeenCalled();
  });

  it('should default NOTAFLOF maximum amount to 10 in create mode', () => {
    expect(component.eventModel().slidingScaleMax).toBe('10');
  });

  it('should enable submit button when form is valid', async () => {
    // Fill required fields (using Signal Forms model)
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(false);
  });

  it('should show an inline error and disable save when price is negative', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(31),
      price: '-10',
      supporterDefaultPrice: '5',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getPriceErrorText()).toBe('Price cannot be negative');
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should reject exponent notation in the base price field', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(31),
      price: '1e2',
      supporterDefaultPrice: '105',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getPriceErrorText()).toBe(
      'Use a dollar amount like 20 or 20.00',
    );
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should show an inline error and disable save when totalTickets is zero', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(31),
      price: '20',
      supporterDefaultPrice: '25',
      totalTickets: '0',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getTotalTicketsErrorText()).toBe(
      'Must have at least 1 ticket',
    );
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should disable save and show an inline error when the create mode date is in the past', async () => {
    const yesterday = new Date(getStartOfToday());
    yesterday.setDate(yesterday.getDate() - 1);

    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: yesterday,
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .date()
        .errors()
        .some((e) => e.kind === 'pastDate'),
    ).toBe(true);
    expect(await harness.getDateErrorText()).toBe('Date cannot be in the past');
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should set today as the minimum selectable date in create mode', async () => {
    const datePicker = fixture.debugElement.query(
      By.directive(BraDatePickerComponent),
    ).componentInstance as BraDatePickerComponent;

    expect(datePicker.minDate()).toEqual(getStartOfToday());
  });

  it('updates the date picker trigger when a date is selected', async () => {
    const selectedDate = new Date(2026, 3, 21);
    const datePicker = fixture.debugElement.query(
      By.directive(BraDatePickerComponent),
    ).componentInstance as unknown as BraDatePickerComponent & {
      onDateChange(date: Date): void;
    };

    datePicker.onDateChange(selectedDate);
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = fixture.debugElement.query(By.css('bra-date-picker button'))
      .nativeElement as HTMLButtonElement;

    expect(component.eventModel().date?.toDateString()).toBe(
      selectedDate.toDateString(),
    );
    expect(trigger.textContent).toContain('2026-04-21');
    expect(trigger.getAttribute('aria-label')).toBe('Selected date 2026-04-21');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the publish dialog before creating a published event', async () => {
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    component.save('published');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showPublishDialog()).toBe(true);
    expect(await harness.isPublishDialogVisible()).toBe(true);
  });

  it('passes announcement settings through when creating from the publish dialog', async () => {
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.openPublishDialog();
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.setAnnouncementChoice('now');
    await harness.confirmPublish();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.createWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({
        announcement: {mode: 'now'},
      }),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      'Event published successfully',
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/community-admin', 'events', 'new-evt', 'manage'],
      {queryParams: {community: 'lot-45'}},
    );
  });

  it('should call createWithPoster and navigate on submit', async () => {
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.createWithPoster).toHaveBeenCalled();
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      'Event published successfully',
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/community-admin', 'events', 'new-evt', 'manage'],
      {queryParams: {community: 'lot-45'}},
    );
  });

  it('saves a draft event from the create form and opens event management', async () => {
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    component.save('draft');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showPublishDialog()).toBe(false);
    expect(eventsServiceMock.createWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        title: 'New Event',
        organizerId: expect.anything() as unknown,
      }),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(toastSuccessSpy).toHaveBeenCalledWith('Draft saved successfully');
    expect(routerMock.navigate).toHaveBeenCalledWith(
      ['/community-admin', 'events', 'new-evt', 'manage'],
      {queryParams: {community: 'lot-45'}},
    );
    expect(await harness.getSubmitErrorText()).toBeNull();
  });

  it('sends the default NOTAFLOF maximum amount when enabled from the create form', async () => {
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();
    await harness.setSlidingScaleEnabled(true);
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('draft');
    await fixture.whenStable();

    expect(eventsServiceMock.createWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({
        sliderConfig: {
          enabled: true,
          min: 0,
          max: 1000,
        },
      }),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('serializes decimal price fields with the strict parser and omits blank max tickets', async () => {
    fillValidCreateForm({
      price: '20.50',
      supporterDefaultPrice: '25.75',
      slidingScaleEnabled: true,
      slidingScaleMin: '5.25',
      slidingScaleMax: '10.50',
      maxTicketsPerUser: '',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('draft');
    await fixture.whenStable();

    const args = eventsServiceMock.createWithPoster.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(args['price']).toBe(2050);
    expect(args['supporterDefaultPrice']).toBe(2575);
    expect(args['sliderConfig']).toEqual({
      enabled: true,
      min: 525,
      max: 1050,
    });
    expect(args['maxTicketsPerUser']).toBeUndefined();
  });

  it('rejects exponent notation for supporter and sliding-scale prices', async () => {
    fillValidCreateForm({supporterDefaultPrice: '2.5e1'});
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .supporterDefaultPrice()
        .errors()
        .some((error) => error.kind === 'invalidDecimal'),
    ).toBe(true);
    expect(await harness.isSaveButtonDisabled()).toBe(true);

    fillValidCreateForm({
      supporterDefaultPrice: '25',
      slidingScaleEnabled: true,
      slidingScaleMin: '1e0',
      slidingScaleMax: '10',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .slidingScaleMin()
        .errors()
        .some((error) => error.kind === 'invalidDecimal'),
    ).toBe(true);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('does not report create failure when navigation fails after a successful create', async () => {
    routerMock.navigate.mockRejectedValueOnce(new Error('Navigation failed'));
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('draft');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.createWithPoster).toHaveBeenCalled();
    expect(toastSuccessSpy).toHaveBeenCalledWith('Draft saved successfully');
    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Event saved, but we could not open event management.',
    );
    expect(toastErrorSpy).not.toHaveBeenCalledWith('Failed to create event');
    expect(await harness.getSubmitErrorText()).toBe(
      'Event saved, but we could not open event management.',
    );
  });

  it('shows inline feedback when create fails', async () => {
    eventsServiceMock.createWithPoster.mockRejectedValueOnce(
      new Error('Create failed'),
    );
    fillValidCreateForm();
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onSubmit('draft');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(toastErrorSpy).toHaveBeenCalledWith('Failed to create event');
    expect(await harness.getSubmitErrorText()).toBe('Failed to create event');
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });

  it('should disable save when organizerId is empty in create mode', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: '',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isFormValid()).toBe(false);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should include organizerId when creating event', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.createWithPoster).toHaveBeenCalledWith(
      expect.objectContaining({
        organizerId: expect.anything() as unknown,
      }),
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('should reject re-entrant calls to onSubmit while already submitting', async () => {
    // Make createWithPoster hang so isSubmitting stays true
    let resolveCreate!: (value: unknown) => void;
    eventsServiceMock.createWithPoster.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    component.eventModel.update((m) => ({
      ...m,
      title: 'Double Click Test',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    // First submit — enters the method, sets isSubmitting
    const firstSubmit = component.onSubmit('draft');

    // Second submit — should be rejected by the guard
    await component.onSubmit('draft');

    // Only one call should have been made
    expect(eventsServiceMock.createWithPoster).toHaveBeenCalledTimes(1);

    // Resolve the hanging promise to clean up
    resolveCreate('new-evt');
    await firstSubmit;
  });

  it('should disable save button when totalTickets is a decimal', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      totalTickets: '1.5',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should disable save button when maxTicketsPerUser is a decimal', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      maxTicketsPerUser: '2.5',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should not be dirty when form is untouched (create mode)', () => {
    expect(component.isDirty()).toBe(false);
  });

  it('should be dirty after modifying a field', () => {
    component.eventModel.update((m) => ({...m, title: 'Changed Title'}));
    expect(component.isDirty()).toBe(true);
  });

  it('should be dirty when a poster file is selected', () => {
    const mockFile = new File([''], 'test.png', {type: 'image/png'});
    component.onPosterFileChanged(mockFile);
    expect(component.isDirty()).toBe(true);
    expect(component.hasPosterChange()).toBe(true);
  });

  it('should not be dirty after successful save (justSaved bypass)', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: 'New Event',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
    }));
    expect(component.isDirty()).toBe(true);

    // Call onSubmit directly — the save button now opens the publish dialog
    await component.onSubmit('published');
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    // After create-mode save, justSaved is set
    expect(component.isDirty()).toBe(false);
  });

  it('should disable save button when title is whitespace-only (create mode)', async () => {
    component.eventModel.update((m) => ({
      ...m,
      title: '   ',
      date: getFutureDate(30),
      price: '20',
      supporterDefaultPrice: '25',
      organizerId: 'org1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      component.eventForm
        .title()
        .errors()
        .some((e) => e.kind === 'required'),
    ).toBe(true);
    expect(component.isFormValid()).toBe(false);
    expect(await harness.isSaveButtonDisabled()).toBe(true);
  });

  it('should auto-update supporter default price when base price changes in create mode', async () => {
    // Set price to 20
    component.eventModel.update((m) => ({...m, price: '20'}));
    fixture.detectChanges();
    await fixture.whenStable(); // Allow effect to run

    // Supporter should be price + 5 = 25
    expect(component.eventModel().supporterDefaultPrice).toBe('25');

    // Update price again
    component.eventModel.update((m) => ({...m, price: '30'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Supporter should be 35
    expect(component.eventModel().supporterDefaultPrice).toBe('35');

    // Manually set supporter price to something higher
    component.eventModel.update((m) => ({...m, supporterDefaultPrice: '50'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Update price to 40 (still less than 50)
    component.eventModel.update((m) => ({...m, price: '40'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Should NOT update automagically because current supporter (50) > price (40)
    expect(component.eventModel().supporterDefaultPrice).toBe('50');
  });

  it('does not clobber the supporter price once the user starts editing it', async () => {
    // Base price $20 seeds the supporter default.
    component.eventModel.update((m) => ({...m, price: '20'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('25');

    // User selects the field and types '2' ($2, at/below the base price). The
    // old effect re-ran on this keystroke and overwrote it back to '25'.
    component.onSupporterPriceInput();
    component.eventModel.update((m) => ({...m, supporterDefaultPrice: '2'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('2');

    // ...and can finish typing '22' without interference.
    component.onSupporterPriceInput();
    component.eventModel.update((m) => ({...m, supporterDefaultPrice: '22'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('22');
  });

  it('stops auto-filling the supporter price after the user has edited it', async () => {
    // Seed from a base price.
    component.eventModel.update((m) => ({...m, price: '20'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('25');

    // User edits the supporter field to a value at/below the base price.
    component.onSupporterPriceInput();
    component.eventModel.update((m) => ({...m, supporterDefaultPrice: '1'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Changing the base price must NOT re-seed over the user's edit.
    component.eventModel.update((m) => ({...m, price: '30'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('1');
  });

  it('keeps a DOM-typed supporter price when the base price later changes (pins the (input) binding)', async () => {
    component.eventModel.update((m) => ({...m, price: '20'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('25');

    // Type a low value through the real input element — this fires the native
    // (input) handler that marks the field user-edited. If that binding is
    // removed, the later price change below re-seeds over this value.
    await harness.setSupporterPrice('1');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('1');

    component.eventModel.update((m) => ({...m, price: '30'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.eventModel().supporterDefaultPrice).toBe('1');
  });
});

describe('EventEditorComponent - Create Mode Community Query Scope', () => {
  interface ScopeSetupOptions {
    resolvedCommunity: {_id: string; name: string; email: string} | null;
  }

  async function setupScopeTest({resolvedCommunity}: ScopeSetupOptions) {
    await TestBed.resetTestingModule();

    const eventsServiceMock: MockEventsService = {
      getOne: vi.fn(),
      getOneForEdit: vi.fn(),
      updateWithPoster: vi.fn(),
      createWithPoster: vi.fn().mockResolvedValue('new-evt'),
      getPosterUrl: vi.fn().mockReturnValue('mock-url'),
    };

    const communitiesServiceMock: MockCommunitiesService = {
      list: vi.fn().mockResolvedValue([]),
      getBySlugOrId: vi.fn().mockResolvedValue(resolvedCommunity),
    };

    const communityContextMock: MockCommunityContextService = {
      selectedCommunityId: signal('auto-org'),
      selectedCommunityName: signal('Auto Community'),
      selectCommunity: vi.fn((id: string) =>
        communityContextMock.selectedCommunityId.set(id),
      ),
      setResolvedNames: vi.fn((names: Map<string, string>) => {
        const selectedName = names.get(
          communityContextMock.selectedCommunityId(),
        );
        if (selectedName) {
          communityContextMock.selectedCommunityName.set(selectedName);
        }
      }),
    };

    const activatedRouteMock = {
      snapshot: {
        paramMap: {
          get: () => null,
          getAll: () => [],
          has: () => false,
          keys: [],
        },
        queryParamMap: convertToParamMap({community: 'lot-45'}),
      },
    } as unknown as MockActivatedRoute;

    await TestBed.configureTestingModule({
      imports: [EventEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: {currentUser: signal(null), userRole: signal('user')},
        },
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {
          provide: CommunityContextService,
          useValue: communityContextMock as unknown as CommunityContextService,
        },
        {provide: Router, useValue: {navigate: vi.fn()}},
        {provide: ActivatedRoute, useValue: activatedRouteMock},
        {provide: CONVEX, useValue: makeConvexClientMock()},
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventEditorComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {component, communitiesServiceMock, communityContextMock};
  }

  it('uses the resolved community query param as the create organizer', async () => {
    const {component, communitiesServiceMock, communityContextMock} =
      await setupScopeTest({
        resolvedCommunity: {
          _id: 'query-org',
          name: 'Query Community',
          email: 'query@example.com',
        },
      });

    expect(communitiesServiceMock.getBySlugOrId).toHaveBeenCalledWith('lot-45');
    expect(component.isCreateCommunityScopeBlocking()).toBe(false);
    expect(component.eventModel().organizerId).toBe('query-org');
    expect(component.communityName()).toBe('Query Community');
    expect(communityContextMock.selectCommunity).toHaveBeenCalledWith(
      'query-org',
    );
  });

  it('blocks create when the community query param cannot be resolved', async () => {
    const {component} = await setupScopeTest({resolvedCommunity: null});

    expect(component.isCreateCommunityScopeBlocking()).toBe(true);
    expect(component.eventModel().organizerId).toBe('');
    expect(component.isFormValid()).toBe(false);
    expect(component.createCommunityScopeMessage()).toContain(
      'Could not resolve community "lot-45"',
    );

    component.save('draft');

    expect(component.submitError()).toContain(
      'Could not resolve community "lot-45"',
    );
  });
});
