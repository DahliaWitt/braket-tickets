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
import {type UserModel} from '@/testing/user-model';
import {type UpcomingEvent} from '@/core/models/event.types';
import {type Application} from '@/features/vetting/models/application.model';
import {type Id} from '@convex/_generated/dataModel';

describe('DashboardDataService', () => {
  let service: DashboardDataService;
  let authServiceMock: {
    user: ReturnType<typeof signal<UserModel | null>>;
  };
  let eventsServiceMock: {
    getUpcoming: Mock;
    getBatchAvailability: Mock;
  };
  let applicationsServiceMock: {
    getMyApplication: Mock;
  };
  let communitiesServiceMock: {
    list: Mock;
  };

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
      getBatchAvailability: vi.fn().mockResolvedValue(mockBatchAvailability),
    };

    applicationsServiceMock = {
      getMyApplication: vi.fn().mockResolvedValue(mockApplication),
    };

    communitiesServiceMock = {
      list: vi.fn().mockResolvedValue(mockCommunities),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DashboardDataService,
        {provide: AuthService, useValue: authServiceMock},
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: ApplicationsService, useValue: applicationsServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
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
            eventAvailability: {},
          });
        });
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

      it('should fetch batch availability for all events', async () => {
        TestBed.tick();

        await vi.waitFor(() => {
          expect(eventsServiceMock.getBatchAvailability).toHaveBeenCalledWith([
            'event-1',
            'event-2',
          ]);
        });
      });

      it('should not call getBatchAvailability when there are no events', async () => {
        eventsServiceMock.getUpcoming.mockResolvedValue([]);

        TestBed.tick();

        await vi.waitFor(() => {
          expect(eventsServiceMock.getUpcoming).toHaveBeenCalled();
        });

        expect(eventsServiceMock.getBatchAvailability).not.toHaveBeenCalled();
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
      const availabilityWithNulls: Record<string, EventAvailability | null> = {
        'event-1': {
          isSoldOut: false,
          userTicketCount: undefined,
          ticketSalesStatus: undefined,
          purchaseAccess: {allowed: true, source: 'direct'},
        },
      };
      eventsServiceMock.getBatchAvailability.mockResolvedValue(
        availabilityWithNulls,
      );
      eventsServiceMock.getUpcoming.mockResolvedValue([mockEvents[0]]);

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        const availability = data?.eventAvailability['event-1'];
        expect(availability?.userTicketCount).toBe(0);
        expect(availability?.ticketSalesStatus).toBe('active');
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      authServiceMock.user.set(mockUser);
    });

    it('should handle failed batch availability fetch gracefully', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      eventsServiceMock.getBatchAvailability.mockRejectedValue(
        new Error('Network error'),
      );

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        // Data should still be returned with empty availability
        expect(data?.events).toHaveLength(2);
        expect(data?.eventAvailability).toEqual({});
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '%c[ERROR]%c Failed to load event availabilities',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should skip null availability entries', async () => {
      const availabilityWithNull: Record<string, EventAvailability | null> = {
        'event-1': {
          isSoldOut: false,
          userTicketCount: 1,
          ticketSalesStatus: 'active',
          purchaseAccess: {allowed: true, source: 'direct'},
        },
        'event-2': null,
      };
      eventsServiceMock.getBatchAvailability.mockResolvedValue(
        availabilityWithNull,
      );

      TestBed.tick();

      await vi.waitFor(() => {
        const data = service.data();
        expect(data?.eventAvailability['event-1']).toBeDefined();
        expect(data?.eventAvailability['event-2']).toBeUndefined();
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
      TestBed.tick();

      await vi.waitFor(() => {
        const availability = service.eventAvailability();
        expect(availability['event-1']?.isSoldOut).toBe(false);
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
    it('should expose the settled loading state from dashboardResource', async () => {
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.dashboardResource.value()).toBeDefined();
      });

      expect(service.isLoading()).toBe(false);
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
