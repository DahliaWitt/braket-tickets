import {Injectable, inject, resource, computed, signal} from '@angular/core';
import {AuthService} from '@/core/services/auth.service';
import {EventsService} from '@/features/admin/services/events.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {
  CommunitiesService,
  type Community,
} from '@/core/services/communities.service';
import {type UpcomingEvent} from '@/core/models/event.types';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';

export interface EventAvailability {
  isSoldOut: boolean;
  userTicketCount?: number;
  ticketSalesStatus?: 'active' | 'paused' | 'ended';
  purchaseAccess: {
    allowed: boolean;
    source?: 'open_access' | 'direct' | 'shared';
    viaOrganizerId?: string;
  };
}

export interface DashboardData {
  applicationStatus: string | null;
  applicationReason: string | null;
  events: UpcomingEvent[];
  communities: Community[];
  eventAvailability: Record<string, EventAvailability>;
}

/**
 * Service responsible for aggregating and providing all data required for the main User Dashboard.
 *
 * It uses a single aggregate `resource()` to ensure that the dashboard view remains consistent,
 * fetching authentication status, upcoming events, organizers, and event availability in a coordinated flow.
 *
 * This pattern avoids multiple individual service calls in components, which would trigger
 * staggered loading states and potential race conditions in a zoneless environment.
 */
@Injectable({
  providedIn: 'root',
})
export class DashboardDataService {
  private auth = inject(AuthService);
  private eventsService = inject(EventsService);
  private appsService = inject(ApplicationsService);
  private communitiesService = inject(CommunitiesService);

  /**
   * Signal used to force a refresh of the dashboard resource.
   * Increment this value to trigger a re-fetch even when userId hasn't changed.
   */
  private readonly refreshTrigger = signal(0);

  /**
   * Forces the dashboard resource to refetch data.
   * Call this after mutations that affect dashboard data (e.g., vetting submission).
   */
  triggerRefresh(): void {
    this.refreshTrigger.update((v) => v + 1);
  }

  /**
   *
   * It reacts to changes in `auth.user()` (specifically the `userId`).
   *
   * Loading Flow:
   * 1. **Guard**: Check for `userId`. If missing, return an empty "logged out" state.
   * 2. **Primary Fetch**: Parallelize requests for application status, upcoming events, and communities.
   * 3. **Secondary Fetch (Availability)**: Perform a batch lookup for tickets counts and sales status for the fetched events.
   * 4. **Aggregation**: Map all disparate streams into a unified `DashboardData` object.
   */
  readonly dashboardResource = resource({
    params: () => ({
      userId: this.auth.user()?._id,
      _refresh: this.refreshTrigger(), // Include refresh trigger to force re-fetch when incremented
    }),
    loader: async ({params}): Promise<DashboardData> => {
      if (!params.userId) {
        logger.debug('[DashboardData] No user ID, returning empty state');
        return {
          applicationStatus: null,
          applicationReason: null,
          events: [],
          communities: [],
          eventAvailability: {},
        };
      }

      logger.group('Dashboard Data Load');
      logger.info('[DashboardData] Loading dashboard for user:', params.userId);
      logger.time('dashboard-total');

      logger.debug('[DashboardData] Fetching data in parallel...');
      logger.time('dashboard-parallel');
      const [app, events, communities] = await Promise.all([
        this.appsService.getMyApplication(),
        this.eventsService.getUpcoming(),
        this.communitiesService.list(),
      ] as const);
      logger.timeEnd('dashboard-parallel');

      logger.debug('[DashboardData] Parallel fetch complete', {
        applicationStatus: app?.status,
        eventCount: events.length,
        communityCount: communities.length,
      });

      // Load availability for each event in a single batch request for efficiency
      const eventAvailability: Record<string, EventAvailability> = {};
      try {
        const eventIds = events.map((e) => e._id);
        if (eventIds.length > 0) {
          const availabilities =
            await this.eventsService.getBatchAvailability(eventIds);

          for (const [eventId, availability] of Object.entries(
            availabilities,
          )) {
            if (availability) {
              eventAvailability[eventId] = {
                isSoldOut: availability.isSoldOut,
                userTicketCount: availability.userTicketCount ?? 0,
                ticketSalesStatus: availability.ticketSalesStatus ?? 'active',
                purchaseAccess: availability.purchaseAccess,
              };
            }
          }
        }
      } catch (e) {
        logger.error('Failed to load event availabilities', e);
      }

      const result = {
        applicationStatus: app?.status ?? null,
        applicationReason: app?.denyReason ?? app?.reason ?? null,
        events,
        communities,
        eventAvailability,
      };

      logger.timeEnd('dashboard-total');
      logger.info('[DashboardData] Dashboard loaded', {
        applicationStatus: result.applicationStatus,
        eventCount: result.events.length,
        communityCount: result.communities.length,
      });
      logger.groupEnd();

      return result;
    },
  });

  /** Resource value, error-safe — returns undefined while loading or in error state. */
  readonly data = computed(() => safeResourceValue(this.dashboardResource));
  /** Loading state signal indicating if any part of the aggregation is pending. */
  readonly isLoading = this.dashboardResource.isLoading;
  /** Error state — true when the resource is in an error state. */
  readonly hasLoadError = computed(
    () => this.dashboardResource.error() != null,
  );

  // Convenience computed signals for easy consumption in components
  readonly applicationStatus = computed(
    () => this.data()?.applicationStatus ?? null,
  );
  readonly applicationReason = computed(
    () => this.data()?.applicationReason ?? null,
  );
  readonly events = computed(() => this.data()?.events ?? []);
  readonly communities = computed(() => this.data()?.communities ?? []);
  readonly eventAvailability = computed(
    () => this.data()?.eventAvailability ?? {},
  );
}
