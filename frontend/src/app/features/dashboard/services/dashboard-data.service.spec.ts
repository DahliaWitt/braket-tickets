import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {vi, describe, it, expect, beforeEach, type Mock} from 'vitest';
import {
  DashboardDataService,
  type EventAvailability,
} from '@/features/dashboard/services/dashboard-data.service';
import {AuthService} from '@/core/services/auth.service';
import {EventsService} from '@/features/admin/services/events.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {
  CommunitiesService,
  type Community,
} from '@/core/services/communities.service';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
} from 'convex/server';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {type UserModel} from '@/testing/user-model';
import {type UpcomingEvent} from '@/core/models/event.types';
import {type Application} from '@/features/vetting/models/application.model';
import {type Id} from '@convex/_generated/dataModel';

// The Convex `api` proxy returns a fresh reference object on every property
// access, so identity comparison never holds. Compare by stable function name.
const BATCH_AVAILABILITY_NAME = getFunctionName(
  api.events.public.getBatchAvailability,
);
const isBatchAvailabilityQuery = (query: unknown): boolean =>
  getFunctionName(query as FunctionReference<'query'>) ===
  BATCH_AVAILABILITY_NAME;

describe('DashboardDataService', () => {
  let service: DashboardDataService;
  let authServiceMock: {
    user: ReturnType<typeof signal<UserModel | null>>;
  };
  let eventsServiceMock: {
    getUpcoming: Mock;
  };
  let applicationsServiceMock: {
    getMyApplication: Mock;
  };
  let communitiesServiceMock: {
    list: Mock;
  };
  let convexClientMock: MockConvexClient;

  // Availability results keyed by sorted eventIds join, mirroring the live
  // getBatchAvailability subscription: onUpdate receives the WHOLE chunk map
  // (eventId -> availability), so seed the full per-chunk map here.
  let availabilityByKey: Record<
    string,
    Record<string, EventAvailability | null>
  >;

  const mockUser: UserModel = {
    _id: 'user-1' as Id<'users'>,
    _creationTime: Date.now(),
    name: 'Test User',
    email: 'test@example.com',
  };

  const makeUpcomingEvent = (overrides: {
    _id: Id<'events'>;
    title: string;
    date: string;
    price: number;
    totalTickets: number;
  }): UpcomingEvent =>
    ({
      _creationTime: Date.now(),
      status: 'published',
      organizerId: 'org-1' as Id<'organizers'>,
      posterUrl: null,
      visibility: 'public',
      ...overrides,
    }) as UpcomingEvent;

  const mockEvents: UpcomingEvent[] = [
    makeUpcomingEvent({
      _id: 'event-1' as Id<'events'>,
      title: 'Event 1',
      date: '2024-06-01T18:00:00Z',
      price: 1000,
      totalTickets: 100,
    }),
    makeUpcomingEvent({
      _id: 'event-2' as Id<'events'>,
      title: 'Event 2',
      date: '2024-07-01T20:00:00Z',
      price: 2000,
      totalTickets: 50,
    }),
  ];

  const mockCommunities: Community[] = [
    {
      _id: 'org-1' as Id<'organizers'>,
      _creationTime: Date.now(),
      name: 'Test Community',
      email: 'community@example.com',
      logoUrl: undefined,
      isPublicDirectory: true,
    },
  ];

  const mockApplication: Application = {
    _id: 'app-1' as Id<'applications'>,
    _creationTime: Date.now(),
    userId: 'user-1' as Id<'users'>,
    status: 'approved',
    answers: {},
  };

  const mockBatchAvailability: Record<string, EventAvailability | null> = {
    'event-1': {
      isSoldOut: false,
      userTicketCount: 2,
      ticketSalesStatus: 'active',
      purchaseAccess: {allowed: true, source: 'direct'},
    },
    'event-2': {
      isSoldOut: true,
      userTicketCount: 0,
      ticketSalesStatus: 'ended',
      purchaseAccess: {allowed: false},
    },
  };

  beforeEach(() => {
    authServiceMock = {
      user: signal<UserModel | null>(null),
    };

    eventsServiceMock = {
      getUpcoming: vi.fn().mockResolvedValue(mockEvents),
    };

    applicationsServiceMock = {
      getMyApplication: vi.fn().mockResolvedValue(mockApplication),
    };

    communitiesServiceMock = {
      list: vi.fn().mockResolvedValue(mockCommunities),
    };

    // Default availability wiring: the batch subscription resolves per-chunk
    // using the sorted-eventIds key. Two events -> key 'event-1,event-2'.
    availabilityByKey = {'event-1,event-2': mockBatchAvailability};

    convexClientMock = createMockConvexClient();
    // Emissions are deferred to a microtask: injectQueries registers a
    // subscription in its active-key map only after onUpdate() returns, so a
    // synchronous emission is dropped by its staleness guard (the real client
    // never emits synchronously either).
    convexClientMock.onUpdate = vi.fn(
      (query: unknown, args: unknown, onData: (value: unknown) => void) => {
        const eventIds = (args as {eventIds?: string[]} | undefined)?.eventIds;
        queueMicrotask(() => {
          if (!eventIds || eventIds.length === 0) {
            onData({});
            return;
          }
          const key = [...eventIds].sort().join(',');
          onData(availabilityByKey[key] ?? {});
        });
        return () => void 0;
      },
    );
    convexClientMock.client.onUpdate = convexClientMock.onUpdate;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DashboardDataService,
        {provide: AuthService, useValue: authServiceMock},
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: ApplicationsService, useValue: applicationsServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
      ],
    });

    service = TestBed.inject(DashboardDataService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('dashboardResource loader', () => {
    describe('when user is not logged in', () => {
      it('should return empty dashboard data', async () => {
        authServiceMock.user.set(null);

        TestBed.tick();

        // Wait for the resource to resolve
        await vi.waitFor(() => {
          const result = service.dashboardResource.value();
          expect(result).toEqual({
            applicationStatus: null,
            applicationReason: null,
            events: [],
            communities: [],
          });
        });

        // Availability field is no longer part of DashboardData; the merged
        // map is empty because there are no events to subscribe to.
        expect(service.eventAvailability()).toEqual({});
      });

      it('should not call any services when user is null', async () => {
        authServiceMock.user.set(null);

        TestBed.tick();

        // Wait for resource to process null user
        await vi.waitFor(() => {
          expect(service.dashboardResource.value()).toBeDefined();
        });

        expect(eventsServiceMock.getUpcoming).not.toHaveBeenCalled();
        expect(applicationsServiceMock.getMyApplication).not.toHaveBeenCalled();
        expect(communitiesServiceMock.list).not.toHaveBeenCalled();
      });
    });

    describe('when user is logged in', () => {
      beforeEach(() => {
        authServiceMock.user.set(mockUser);
      });

      it('should fetch all required data in parallel', async () => {
        TestBed.tick();

        await vi.waitFor(() => {
          expect(applicationsServiceMock.getMyApplication).toHaveBeenCalled();
          expect(eventsServiceMock.getUpcoming).toHaveBeenCalled();
          expect(communitiesServiceMock.list).toHaveBeenCalled();
        });
      });

      it('should subscribe to batch availability for all events', async () => {
        await vi.waitFor(() => {
          TestBed.tick();
          const call: unknown[] | undefined =
            convexClientMock.onUpdate.mock.calls.find(([q]: unknown[]) =>
              isBatchAvailabilityQuery(q),
            );
          expect(call).toBeDefined();
          const args = call![1] as FunctionArgs<
            typeof api.events.public.getBatchAvailability
          >;
          expect(args.eventIds).toEqual(['event-1', 'event-2']);
          expect(typeof args.now).toBe('number');
        });
      });

      it('should not subscribe to batch availability when there are no events', async () => {
        eventsServiceMock.getUpcoming.mockResolvedValue([]);

        await vi.waitFor(() => {
          TestBed.tick();
          expect(eventsServiceMock.getUpcoming).toHaveBeenCalled();
          expect(service.events()).toEqual([]);
        });

        // Definitions collapse to {} for an empty event set, so no
        // availability subscription is ever opened.
        expect(
          convexClientMock.onUpdate.mock.calls.some(([q]: unknown[]) =>
            isBatchAvailabilityQuery(q),
          ),
        ).toBe(false);
      });
    });
  });

  describe('data aggregation', () => {
    beforeEach(() => {
      authServiceMock.user.set(mockUser);
    });

    it('should aggregate application status correctly', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.applicationStatus).toBe('approved');
      });
    });

    it('should handle null application status', async () => {
      applicationsServiceMock.getMyApplication.mockResolvedValue(null);

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.applicationStatus).toBeNull();
      });
    });

    it('should prefer denyReason over legacy reason for applicationReason', async () => {
      applicationsServiceMock.getMyApplication.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
        denyReason: 'New deny reason',
        reason: 'Legacy reason',
      });

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.applicationReason).toBe('New deny reason');
      });
    });

    it('should fall back to legacy reason when denyReason is absent', async () => {
      applicationsServiceMock.getMyApplication.mockResolvedValue({
        ...mockApplication,
        status: 'rejected',
        reason: 'Legacy reason',
      });

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.applicationReason).toBe('Legacy reason');
      });
    });

    it('should aggregate events correctly', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.events).toHaveLength(2);
        expect(data?.events[0].title).toBe('Event 1');
      });
    });

    it('should aggregate communities correctly', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.communities).toHaveLength(1);
        expect(data?.communities[0].name).toBe('Test Community');
      });
    });

    it('should map event availability with default values', async () => {
      // Single event -> chunk key is just 'event-1'. Missing userTicketCount /
      // ticketSalesStatus must default to 0 / 'active' in the merged map.
      availabilityByKey = {
        'event-1': {
          'event-1': {
            isSoldOut: false,
            userTicketCount: undefined,
            ticketSalesStatus: undefined,
            purchaseAccess: {allowed: true, source: 'direct'},
          },
        },
      };
      eventsServiceMock.getUpcoming.mockResolvedValue([mockEvents[0]]);

      await vi.waitFor(() => {
        TestBed.tick();
        const availability = service.eventAvailability()['event-1'];
        expect(availability?.userTicketCount).toBe(0);
        expect(availability?.ticketSalesStatus).toBe('active');
      });
    });
  });

  describe('availability error handling', () => {
    beforeEach(() => {
      authServiceMock.user.set(mockUser);
    });

    it('should degrade gracefully when a batch availability chunk errors', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      // Drive the availability subscription into its error channel while the
      // rest of the dashboard resource resolves normally.
      convexClientMock.onUpdate = vi.fn(
        (
          query: unknown,
          _args: unknown,
          onData: (value: unknown) => void,
          onError?: (err: Error) => void,
        ) => {
          // Deferred past onUpdate's return so injectQueries' staleness guard
          // (registration happens after onUpdate) accepts the emission.
          queueMicrotask(() => {
            if (isBatchAvailabilityQuery(query)) {
              onError?.(new Error('Network error'));
              return;
            }
            onData({});
          });
          return () => void 0;
        },
      );
      convexClientMock.client.onUpdate = convexClientMock.onUpdate;

      await vi.waitFor(() => {
        TestBed.tick();
        // Core dashboard data still renders...
        expect(service.events()).toHaveLength(2);
        // ...while the errored chunk simply drops out of the map.
        expect(service.eventAvailability()).toEqual({});
      });

      // An availability failure must not hang the loading skeleton.
      expect(service.isLoading()).toBe(false);
      // The resource itself never errored — availability errors are swallowed.
      expect(service.hasLoadError()).toBe(false);

      expect(consoleSpy).toHaveBeenCalledWith(
        '%c[ERROR]%c Failed to load event availabilities',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should skip null availability entries', async () => {
      availabilityByKey = {
        'event-1,event-2': {
          'event-1': {
            isSoldOut: false,
            userTicketCount: 1,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'direct'},
          },
          'event-2': null,
        },
      };

      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.eventAvailability()['event-1']).toBeDefined();
        expect(service.eventAvailability()['event-2']).toBeUndefined();
      });
    });
  });

  describe('convenience computed signals', () => {
    beforeEach(() => {
      authServiceMock.user.set(mockUser);
    });

    it('should provide applicationStatus computed signal', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.applicationStatus()).toBe('approved');
      });
    });

    it('should provide events computed signal', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.events()).toHaveLength(2);
      });
    });

    it('should provide communities computed signal', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.communities()).toHaveLength(1);
      });
    });

    it('should provide eventAvailability computed signal', async () => {
      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.eventAvailability()['event-1']?.isSoldOut).toBe(false);
      });
    });

    it('should return default values when data is null', () => {
      // Before any data is loaded, computed signals should return defaults
      authServiceMock.user.set(null);

      expect(service.applicationStatus()).toBeNull();
      expect(service.events()).toEqual([]);
      expect(service.communities()).toEqual([]);
      expect(service.eventAvailability()).toEqual({});
    });
  });

  describe('isLoading signal', () => {
    it('should be false once the resource settles with no events to load', async () => {
      authServiceMock.user.set(null);
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.dashboardResource.value()).toBeDefined();
      });

      expect(service.isLoading()).toBe(false);
    });

    it('should stay true while an availability chunk awaits its first result', async () => {
      // Capture but never invoke onData so the chunk stays pending.
      let deliver: ((value: unknown) => void) | undefined;
      convexClientMock.onUpdate = vi.fn(
        (query: unknown, _args: unknown, onData: (value: unknown) => void) => {
          if (isBatchAvailabilityQuery(query)) {
            deliver = onData;
            return () => void 0;
          }
          onData({});
          return () => void 0;
        },
      );
      convexClientMock.client.onUpdate = convexClientMock.onUpdate;

      authServiceMock.user.set(mockUser);

      // Resource resolves and the pending availability chunk keeps loading true.
      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.events()).toHaveLength(2);
        expect(deliver).toBeDefined();
        expect(service.isLoading()).toBe(true);
      });

      // First availability result arrives -> loading resolves.
      deliver!(mockBatchAvailability);

      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.isLoading()).toBe(false);
      });
    });
  });

  describe('hasLoadError signal', () => {
    it('should expose hasLoadError as a computed signal', () => {
      expect(service.hasLoadError()).toBe(false);
    });

    it('should be false when resource has not errored', async () => {
      authServiceMock.user.set(mockUser);
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.dashboardResource.value()).toBeDefined();
      });

      expect(service.hasLoadError()).toBe(false);
    });

    it('should be true when the resource loader throws', async () => {
      eventsServiceMock.getUpcoming.mockRejectedValue(
        new Error('Network failure'),
      );
      authServiceMock.user.set(mockUser);
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.hasLoadError()).toBe(true);
      });
    });

    it('should return safe defaults for all computed signals when in error state', async () => {
      eventsServiceMock.getUpcoming.mockRejectedValue(
        new Error('Network failure'),
      );
      authServiceMock.user.set(mockUser);
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.hasLoadError()).toBe(true);
      });

      // All computed signals must return safe defaults — not throw
      expect(service.applicationStatus()).toBeNull();
      expect(service.applicationReason()).toBeNull();
      expect(service.events()).toEqual([]);
      expect(service.communities()).toEqual([]);
      expect(service.eventAvailability()).toEqual({});
    });
  });
});
