import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {NgOptimizedImage} from '@angular/common';
import {AuthService} from '@/core/services/auth.service';
import {DashboardDataService} from '@/features/dashboard/services/dashboard-data.service';
import {DashboardPageDataService} from '@/features/dashboard/services/dashboard-page-data.service';
import {RouterLink} from '@angular/router';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {BraCommunityAvatarComponent} from '@ui/components/primitives/community-avatar/community-avatar.component';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {EVENT_VISIBILITY} from '@shared/domain/event-visibility';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  getBuyerPricingSummary,
  type BuyerPricingInput,
} from '@shared/pricing/pricing-summary';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {EventEndTimePipe} from '@/utils/event-end-time.pipe';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventDatePipe,
    EventEndTimePipe,
    RouterLink,
    NgOptimizedImage,
    ContentLayoutComponent,
    ZardSkeletonComponent,
    BraCommunityAvatarComponent,
    BraStatusBadgeComponent,
  ],
  templateUrl: './dashboard.component.html',
  providers: [DashboardPageDataService],
})
export class DashboardComponent {
  auth = inject(AuthService);
  private dashboardData = inject(DashboardDataService);
  private dashboardPageData = inject(DashboardPageDataService);
  private readonly browser = inject(BrowserPlatformService);

  // Consume resource-based signals from service
  applicationStatus = this.dashboardData.applicationStatus;
  applicationReason = this.dashboardData.applicationReason;
  rawEvents = this.dashboardData.events;
  communities = this.dashboardData.communities;
  eventAvailability = this.dashboardData.eventAvailability;
  isLoading = this.dashboardData.isLoading;
  hasLoadError = this.dashboardData.hasLoadError;
  readonly approvals = this.dashboardPageData.approvals;
  approvalsLoading = this.dashboardPageData.approvalsLoading;
  readonly myApplications = this.dashboardPageData.myApplications;
  myApplicationsLoading = this.dashboardPageData.myApplicationsLoading;
  readonly publicCommunities = this.dashboardPageData.publicCommunities;

  /**
   * Merged community grid entries: approvals (access) + applications (pending/rejected).
   * Approvals take precedence — if a community has both an approval and an application,
   * the approval wins (it has richer data: trust source, via attribution).
   * Rejected apps only show if not also approved (edge case: re-applied and approved).
   */
  readonly communityGridEntries = computed(() => {
    const approvalsByOrg = new Map(
      this.approvals().map((a) => [a.organizerId, a]),
    );
    const entries: {
      organizerId: string;
      organizerName: string;
      organizerLogoUrl?: string;
      status: 'access' | 'pending' | 'rejected';
      source?: 'direct' | 'shared';
      viaOrganizerName?: string;
      reason?: string;
      routeParam?: string;
      canResubmit?: boolean;
    }[] = [];

    // Add all approvals as "access" entries
    for (const a of this.approvals()) {
      entries.push({
        organizerId: a.organizerId,
        organizerName: a.organizerName,
        organizerLogoUrl: a.organizerLogoUrl,
        status: 'access',
        source: a.source,
        viaOrganizerName: a.viaOrganizerName,
      });
    }

    // Add pending/rejected applications that don't overlap with approvals.
    // getMyApplications returns newest-first (desc), so the first application seen
    // per organizer is the most recent — skip older duplicate entries.
    const seenApplicationOrgIds = new Set<string>();
    for (const app of this.myApplications()) {
      if (!app.organizerId) continue; // skip platform-level apps
      if (approvalsByOrg.has(app.organizerId)) continue; // already covered by approval
      if (app.status === 'approved') continue; // covered by getUserApprovals
      if (app.status === 'revoked') continue; // don't show revoked
      if (seenApplicationOrgIds.has(app.organizerId)) continue; // deduplicate: keep latest per organizer

      seenApplicationOrgIds.add(app.organizerId);
      entries.push({
        organizerId: app.organizerId,
        organizerName: app.organizerName,
        organizerLogoUrl: app.organizerLogoUrl,
        status: app.status === 'pending' ? 'pending' : 'rejected',
        reason: app.denyReason ?? app.reason,
        routeParam: app.organizerSlug ?? app.organizerId,
        canResubmit: app.organizerStatus === 'published',
      });
    }

    return entries;
  });

  readonly rejectedResubmitEntries = computed(() =>
    this.communityGridEntries().filter((entry) => entry.status === 'rejected'),
  );

  // Is this a new user with no community relationships?
  readonly isNewUser = computed(
    () =>
      this.communityGridEntries().length === 0 &&
      !this.approvalsLoading() &&
      !this.myApplicationsLoading(),
  );

  // Show all communities toggle (for 6+ communities)
  readonly showAllCommunities = signal(false);

  // Visible communities (capped unless expanded)
  readonly visibleCommunities = computed(() => {
    const all = this.communityGridEntries();
    if (this.showAllCommunities() || all.length <= 6) return all;
    return all.slice(0, 6);
  });
  readonly hasMoreCommunities = computed(
    () => this.communityGridEntries().length > 6,
  );

  /**
   * Communities the user hasn't applied to or been approved for.
   * Shown in the "Discover More" teaser for vetted users. Capped at 3.
   */
  readonly undiscoveredCommunities = computed(() => {
    const knownOrgIds = new Set(
      this.communityGridEntries().map((e) => e.organizerId),
    );
    return this.publicCommunities()
      .filter((c) => c.status === 'published' && !knownOrgIds.has(c._id))
      .slice(0, 3);
  });

  readonly showDiscoverSection = computed(
    () =>
      !this.isNewUser() &&
      this.communityGridEntries().length > 0 &&
      this.undiscoveredCommunities().length > 0,
  );

  // Memoize sorted events to avoid O(N log N) sorting across multiple computed properties
  readonly sortedRawEvents = computed(() => {
    return this.rawEvents().toSorted((a, b) => a.date.localeCompare(b.date));
  });

  // events.upcoming applies backend view-access policy; availability carries
  // the canonical purchase-access decision from backend/convex/lib/access.ts.
  // Sorted: approved-community events first (direct/shared), then open-access, by date within each group.
  readonly accessibleEvents = computed(() => {
    const availabilityMap = this.eventAvailability();
    return this.sortedRawEvents()
      .filter((event) => {
        const availability = availabilityMap[event._id];
        return availability?.purchaseAccess.allowed === true;
      })
      .toSorted((a, b) => {
        const aSource = availabilityMap[a._id]?.purchaseAccess.source;
        const bSource = availabilityMap[b._id]?.purchaseAccess.source;
        const aApproved = aSource === 'direct' || aSource === 'shared' ? 0 : 1;
        const bApproved = bSource === 'direct' || bSource === 'shared' ? 0 : 1;
        if (aApproved !== bApproved) return aApproved - bApproved;
        return a.date.localeCompare(b.date);
      });
  });

  readonly publicEvents = computed(() => {
    return this.sortedRawEvents().filter(
      (e) => e.visibility === EVENT_VISIBILITY.PUBLIC,
    );
  });

  readonly viewableEvents = computed(() => {
    const availabilityMap = this.eventAvailability();
    return this.sortedRawEvents().filter(
      (e) =>
        e.visibility === EVENT_VISIBILITY.PUBLIC_VIEWABLE &&
        availabilityMap[e._id]?.purchaseAccess.allowed === false,
    );
  });

  readonly visibleEvents = computed(() => this.accessibleEvents().slice(0, 4));
  readonly showBrowseAll = computed(() => this.accessibleEvents().length > 4);

  // Organizer name lookup from approvals + communities list
  readonly organizerNameById = computed(() => {
    const map = new Map<string, string>();
    // From communities list (covers public events from any community)
    for (const c of this.communities()) {
      map.set(c._id, c.name);
    }
    // From approvals (overwrite with potentially more accurate names)
    for (const a of this.approvals()) {
      map.set(a.organizerId, a.organizerName);
    }
    return map;
  });

  // Next event per community
  readonly nextEventByOrganizer = computed(() => {
    const map = new Map<
      string,
      {title: string; date: string; endDate?: string}
    >();
    for (const event of this.sortedRawEvents()) {
      if (event.organizerId && !map.has(event.organizerId)) {
        map.set(event.organizerId, {
          title: event.title,
          date: event.date,
          endDate: event.endDate,
        });
      }
    }
    return map;
  });

  canPurchaseEvent(eventId: string): boolean {
    const match = this.dashboardEvents().find((e) => e._id === eventId);
    return match?.canPurchase ?? false;
  }

  /**
   * View Model for Dashboard Events.
   * Pre-calculates status, color, and ability to purchase for each event.
   * This removes complex logic from the template and runs only when data changes.
   */
  readonly dashboardEvents = computed(() => {
    const events = this.rawEvents();
    const availabilityMap = this.eventAvailability();

    return events.map((event) => {
      const availability = availabilityMap[event._id];

      let status: {message: string; color: string} | null = null;
      let canPurchase = false;
      let isLimitReached = false;

      if (availability) {
        // Calculate Limit Reached
        const count = availability.userTicketCount ?? 0;
        isLimitReached = count >= (event.maxTicketsPerUser ?? 4);

        // Calculate Status
        if (availability.isSoldOut) {
          status = {message: 'Sold Out', color: 'red'};
        } else if (availability.ticketSalesStatus === 'paused') {
          status = {message: 'Ticket Sales Are Paused', color: 'yellow'};
        } else if (availability.ticketSalesStatus === 'ended') {
          status = {message: 'Ticket Sales Have Ended', color: 'red'};
        } else if (isLimitReached) {
          status = {
            message: `Limit Reached (${count} owned)`,
            color: 'success',
          };
        }

        if (availability.purchaseAccess.allowed && !isLimitReached && !status) {
          canPurchase = true;
        }
      }

      return {
        ...event,
        uiStatus: status,
        isLimitReached,
        canPurchase,
      };
    });
  });

  reload() {
    this.browser.reload();
  }

  logout() {
    void this.auth.logout();
  }

  priceSummary(event: BuyerPricingInput) {
    return getBuyerPricingSummary(event);
  }
}
