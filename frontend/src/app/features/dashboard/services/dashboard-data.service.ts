import {Injectable, inject, resource, computed, signal} from '@angular/core';
import {injectQueries} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type FunctionArgs} from 'convex/server';
import {type Id} from '@convex/_generated/dataModel';
import {AuthService} from '@/core/services/auth.service';
import {EventsService} from '@/features/admin/services/events.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {
  CommunitiesService,
  type Community,
} from '@/core/services/communities.service';
import {
  MAX_EVENT_IDS_PER_BATCH,
  type UpcomingEvent,
} from '@/core/models/event.types';
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

      // Event availability is subscribed to live via injectQueries below, so
      // sold-out / sales-status changes stream in without a resource refetch.

      const result = {
        applicationStatus: app?.status ?? null,
        applicationReason: app?.denyReason ?? app?.reason ?? null,
        events,
        communities,
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

  /**
   * Live availability subscriptions, one per chunk of event ids. `now` is
   * frozen at subscribe time (Date.now() is not a signal), mirroring
   * event-details' availabilityQuery and tickets.component: the callback
   * re-runs only when the event id set changes, so there is no minute-timer
   * resubscribe. Returning `{}` (not skipToken) when there are no events keeps
   * zero active queries, so isLoading() stays false on the logged-out path.
   *
   * The service is providedIn:'root', so this subscription lives for the app
   * session; it self-clears on logout because the resource returns no events,
   * the definitions collapse to `{}`, and injectQueries drops every key.
   */
  private readonly availabilityQueries = injectQueries(
    () => {
      const eventIds = this.events().map((e) => e._id);
      if (eventIds.length === 0) return {};
      const now = Math.floor(Date.now() / 60000) * 60000;
      const defs: Record<
        string,
        {
          query: typeof api.events.public.getBatchAvailability;
          args: FunctionArgs<typeof api.events.public.getBatchAvailability>;
        }
      > = {};
      for (let i = 0; i < eventIds.length; i += MAX_EVENT_IDS_PER_BATCH) {
        const chunk = eventIds.slice(
          i,
          i + MAX_EVENT_IDS_PER_BATCH,
        ) as Id<'events'>[];
        defs[`chunk_${i / MAX_EVENT_IDS_PER_BATCH}`] = {
          query: api.events.public.getBatchAvailability,
          args: {eventIds: chunk, now},
        };
      }
      return defs;
    },
    {
      onError: (_key, err) =>
        logger.error('Failed to load event availabilities', err),
    },
  );

  /**
   * Merged availability map across all chunk subscriptions, applying the same
   * defaulting the old resource loader used. An errored chunk simply drops out
   * of the map (graceful degradation, matching the old try/catch behavior).
   */
  readonly eventAvailability = computed<Record<string, EventAvailability>>(
    () => {
      const merged: Record<string, EventAvailability> = {};
      for (const chunk of Object.values(this.availabilityQueries.results())) {
        if (!chunk) continue;
        for (const [eventId, availability] of Object.entries(chunk)) {
          if (!availability) continue;
          merged[eventId] = {
            isSoldOut: availability.isSoldOut,
            userTicketCount: availability.userTicketCount ?? 0,
            ticketSalesStatus: availability.ticketSalesStatus ?? 'active',
            purchaseAccess: availability.purchaseAccess,
          };
        }
      }
      return merged;
    },
  );

  /**
   * Loading state — true while the resource loads OR while any availability
   * chunk awaits its first result, so the dashboard skeleton stays up until
   * availability arrives. When events()=[] the definitions collapse to `{}`
   * (no active queries → false), and an errored chunk stops awaiting → false,
   * so neither the logged-out path nor an availability failure hangs the
   * skeleton.
   */
  readonly isLoading = computed(
    () =>
      this.dashboardResource.isLoading() ||
      this.availabilityQueries.isLoading(),
  );
}
