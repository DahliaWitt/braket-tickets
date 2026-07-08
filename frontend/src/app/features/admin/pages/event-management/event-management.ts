import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import {DatePipe} from '@angular/common';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {ConvexError} from 'convex/values';
import {PAYOUT_DELAY_DAYS} from '@shared/constants';
import {eventStartInstantMs} from '@shared/event-time';
import {
  AdminEventsService,
  type TicketSalesStatus,
} from '@/features/admin/services/admin-events.service';
import {SettlementExportService} from '@/features/admin/services/settlement-export.service';
import {getManagementDataTooLargeMessage} from '@/features/admin/utils/management-data-errors';
import {
  type EventManagementPurchases,
  type EventManagementResale,
  type EventManagementSummary,
  type EventTierPricingStats,
  type Guest,
  type ImportedTicketHolder,
  type SettlementExportInput,
} from '../../models/event-management.model';
import {ZardAlertComponent} from '@ui/components/primitives/alert/alert.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardProgressBarComponent} from '@ui/components/primitives/progress-bar/progress-bar.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {BraInventoryMeterComponent} from '@ui/components/composites/inventory-meter/inventory-meter.component';
import {EventAnalyticsTabComponent} from '@/features/admin/components/event-analytics-tab/event-analytics-tab.component';
import {BroadcastEmailTabComponent} from '@/features/admin/components/broadcast-email-tab/broadcast-email-tab.component';
import {MarketingAnnouncementCardComponent} from '@/features/admin/components/marketing-announcement-card/marketing-announcement-card.component';
import {EventManagementBuyersTabComponent} from './components/event-management-buyers-tab/event-management-buyers-tab.component';
import {EventManagementGuestsTabComponent} from './components/event-management-guests-tab/event-management-guests-tab.component';
import {EventManagementResaleTabComponent} from './components/event-management-resale-tab/event-management-resale-tab.component';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {toast} from 'ngx-sonner';
import {EventDatePipe} from '@/utils/event-date.pipe';

const TIER_PRICING_STATS_ERROR_MESSAGE =
  'Pricing cards are temporarily unavailable. Try refreshing the page.';

export type PayoutStatusResult =
  | {state: 'pre-event'}
  | {state: 'pending'; payoutDate: Date}
  | {state: 'processing'}
  | {state: 'paid'; date: Date};

/**
 * Pure function that computes the payout status for an event.
 * Extracted for testability — the component's `payoutStatus` computed signal calls this.
 *
 * Returns `null` when the event is cancelled.
 */
export function computePayoutStatus(
  event: {
    status?: string;
    paidOutAt?: number;
    date: string;
  },
  now = new Date(),
): PayoutStatusResult | null {
  if (event.status === 'cancelled') return null;

  if (event.paidOutAt) {
    return {state: 'paid', date: new Date(event.paidOutAt)};
  }

  const eventDateMs = eventStartInstantMs(event.date);
  if (eventDateMs === null) return null;
  const eventDate = new Date(eventDateMs);

  if (now < eventDate) {
    return {state: 'pre-event'};
  }

  const payoutDate = new Date(
    eventDate.getTime() + PAYOUT_DELAY_DAYS * 86400000,
  );
  if (now < payoutDate) {
    return {state: 'pending', payoutDate};
  }

  return {state: 'processing'};
}

function getManagementLoadErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }

  return getManagementDataTooLargeMessage(error);
}

@Component({
  selector: 'app-event-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EventDatePipe,
    ZardAlertComponent,
    ZardButtonComponent,
    ZardCardComponent,
    ZardProgressBarComponent,
    ZardIconComponent,
    BraInventoryMeterComponent,
    EventAnalyticsTabComponent,
    BroadcastEmailTabComponent,
    MarketingAnnouncementCardComponent,
    EventManagementBuyersTabComponent,
    EventManagementGuestsTabComponent,
    EventManagementResaleTabComponent,
  ],
  providers: [DatePipe],
  templateUrl: './event-management.html',
  styleUrl: './event-management.css',
})
export class EventManagement {
  private adminEventsService = inject(AdminEventsService);
  private settlementExportService = inject(SettlementExportService);
  private route = inject(ActivatedRoute);
  private datePipe = inject(DatePipe);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });

  readonly id = input<string | undefined>();
  private readonly eventId = computed(() => this.id() ?? null);

  /**
   * EventManagement is used under both `/admin` and `/community-admin`.
   * Community admins must never navigate into `/admin/*` routes (adminGuard → /).
   *
   * Route tree (for `/admin/events/:id/manage`):
   *   MainLayout('')  →  'admin' (lazy)  →  '' (guard wrapper)  →  'events/:id/manage'
   *
   * `this.route.parent` is the guard wrapper (`path === ''`), NOT 'admin'.
   * Scan `pathFromRoot` so the match works regardless of how deep the
   * wrapper chain is.
   */
  readonly section = computed<'admin' | 'community-admin'>(() => {
    for (const segment of this.route.pathFromRoot) {
      const path = segment.routeConfig?.path;
      if (path === 'admin') return 'admin';
      if (path === 'community-admin') return 'community-admin';
    }
    return 'community-admin';
  });

  readonly editEventLink = computed(() => {
    const eventId = this.eventId();
    const base = this.section() === 'admin' ? '/admin' : '/community-admin';
    if (!eventId) {
      return this.section() === 'admin'
        ? (['/admin', 'communities'] as const)
        : (['/community-admin', 'events'] as const);
    }
    return [base, 'events', eventId, 'edit'] as const;
  });

  /**
   * Back-link target for error/header navigation. Root-admin users reach
   * this page via `/admin/events/:id/manage` and expect to return to the
   * admin communities list; community admins return to the events list.
   */
  readonly backLink = computed(() =>
    this.section() === 'admin'
      ? (['/admin', 'communities'] as const)
      : (['/community-admin', 'events'] as const),
  );

  readonly routeQueryParams = computed(() => {
    if (this.section() !== 'community-admin') {
      return null;
    }

    const community = this.queryParamMap().get('community');
    return community ? {community} : null;
  });

  /**
   * Summary/check-in surface — primary dashboard entry point. All three
   * management surfaces (summary, purchases, resale) write an
   * `event.management.view` audit log on each fetch.
   */
  readonly summaryResource = resource({
    params: () => ({eventId: this.eventId()}),
    loader: ({params}): Promise<EventManagementSummary | null> => {
      if (!params.eventId) return Promise.resolve(null);
      return this.adminEventsService.getManagementSummary(params.eventId);
    },
  });

  /** Purchases surface (buyers tab, purchase count, settlement export) */
  readonly purchasesResource = resource({
    params: () => ({eventId: this.eventId()}),
    loader: ({params}): Promise<EventManagementPurchases | null> => {
      if (!params.eventId) return Promise.resolve(null);
      return this.adminEventsService.getManagementPurchases(params.eventId);
    },
  });

  /** Resale surface (resale tab, listing count badge, settlement export) */
  readonly resaleResource = resource({
    params: () => ({eventId: this.eventId()}),
    loader: ({params}): Promise<EventManagementResale | null> => {
      if (!params.eventId) return Promise.resolve(null);
      return this.adminEventsService.getManagementResale(params.eventId);
    },
  });

  /** Guests surface — backed by `api.events.guests.listByEvent`. */
  readonly guestsResource = resource({
    params: () => ({eventId: this.eventId()}),
    loader: ({params}): Promise<Guest[]> => {
      if (!params.eventId) return Promise.resolve([]);
      return this.adminEventsService.getGuests(params.eventId);
    },
  });

  /**
   * Imported external ticket-holders — fetched (one-shot `convex.query`) from
   * the roster-authorized `api.events.imported_tickets.listByEvent` and reloaded
   * via `reloadData()` after an import commits. The backend function is a Convex
   * query, but this surface consumes it through a `resource()` loader, not a
   * live subscription. It serves both the buyers-list merge and the import
   * preview's dedup hints.
   */
  readonly importedTicketsResource = resource({
    params: () => ({eventId: this.eventId()}),
    loader: ({params}): Promise<ImportedTicketHolder[]> => {
      if (!params.eventId) return Promise.resolve([]);
      return this.adminEventsService.listImportedTickets(params.eventId);
    },
  });

  readonly tierPricingStatsResource = resource({
    params: () => {
      const summary = this.summary();
      const event = summary?.event;
      return {
        eventId: event?._id ?? null,
        hasVariableTierSales:
          event?.slidingScaleEnabled === true ||
          (summary?.tierCounts.supporter ?? 0) > 0,
      };
    },
    loader: ({params}): Promise<EventTierPricingStats> => {
      if (!params.eventId || !params.hasVariableTierSales) {
        return Promise.resolve({tiers: []});
      }
      return this.adminEventsService.getTierPricingStats(params.eventId);
    },
  });

  private lastLoggedTierPricingStatsError: unknown = null;
  private lastLoggedManagementErrors: Record<string, unknown> = {};

  constructor() {
    effect(() => {
      const error = this.tierPricingStatsResource.error();
      if (!error || Object.is(this.lastLoggedTierPricingStatsError, error)) {
        return;
      }

      this.lastLoggedTierPricingStatsError = error;
      logger.error('Failed to load tier pricing stats', error);
    });

    effect(() => {
      const surfaces: Record<string, unknown> = {
        summary: this.summaryResource.error(),
        purchases: this.purchasesResource.error(),
        resale: this.resaleResource.error(),
        guests: this.guestsResource.error(),
        importedTickets: this.importedTicketsResource.error(),
      };
      for (const [label, error] of Object.entries(surfaces)) {
        if (!error) continue;
        if (Object.is(this.lastLoggedManagementErrors[label], error)) continue;
        this.lastLoggedManagementErrors[label] = error;
        logger.error(`Failed to load event management ${label}`, error);
      }
    });
  }

  readonly tierPricingStatsError = computed(() =>
    this.tierPricingStatsResource.error()
      ? TIER_PRICING_STATS_ERROR_MESSAGE
      : null,
  );

  readonly tierPricingStats = computed(
    () => safeResourceValue(this.tierPricingStatsResource)?.tiers ?? [],
  );

  /**
   * Error state — true when any management resource is in an error state. Every
   * surface is a gated admin read; a failure on any one of them must surface as
   * an error instead of silently rendering empty tabs (the imported-tickets
   * fetch included, so a failed load doesn't silently hide external buyers).
   */
  readonly hasLoadError = computed(
    () =>
      this.summaryResource.error() != null ||
      this.purchasesResource.error() != null ||
      this.resaleResource.error() != null ||
      this.guestsResource.error() != null ||
      this.importedTicketsResource.error() != null,
  );

  /** Summary accessor — gates the whole page. */
  readonly summary = computed(
    () => safeResourceValue(this.summaryResource) ?? null,
  );

  /** Purchases accessor (defaults to empty purchases payload) */
  readonly purchases = computed(
    () => safeResourceValue(this.purchasesResource)?.purchases ?? [],
  );

  /** Resale listings accessor */
  readonly resaleListings = computed(
    () => safeResourceValue(this.resaleResource)?.resaleListings ?? [],
  );

  /** Resale metrics accessor */
  readonly resaleMetrics = computed(
    () => safeResourceValue(this.resaleResource)?.resaleMetrics ?? null,
  );

  /** Guests accessor */
  readonly guests = computed(
    () => safeResourceValue(this.guestsResource) ?? [],
  );

  /** Imported external ticket-holders accessor (one-shot fetch, reloadable). */
  readonly importedTickets = computed(
    () => safeResourceValue(this.importedTicketsResource) ?? [],
  );

  /** Loading state for the primary dashboard (summary). */
  readonly isLoading = this.summaryResource.isLoading;

  /** Loading state for guests specifically. */
  readonly isLoadingGuests = this.guestsResource.isLoading;

  /** Writable signal for action-triggered errors (e.g., status update, PDF generation) */
  private readonly actionError = signal<string | null>(null);

  /**
   * Combined error state: action errors + load errors from any of the four
   * management resources. The first structured `MANAGEMENT_DATA_TOO_LARGE`
   * message wins because the backend exposes a dataset-specific message
   * that is more actionable than the generic fallback. Load errors are
   * logged once each by the constructor effect, not here.
   */
  readonly errorMessage = computed(() => {
    // Action errors take priority (more recent/relevant)
    const action = this.actionError();
    if (action) return action;

    const resourceErrors: unknown[] = [
      this.summaryResource.error(),
      this.purchasesResource.error(),
      this.resaleResource.error(),
      this.guestsResource.error(),
      this.importedTicketsResource.error(),
    ];

    for (const error of resourceErrors) {
      if (!error) continue;
      const structuredMessage = getManagementLoadErrorMessage(error);
      if (structuredMessage) return structuredMessage;
    }

    if (resourceErrors.some((error) => error != null)) {
      return "couldn't load event data — try refreshing";
    }

    return null;
  });

  /** Active tab in the management view */
  readonly activeTab = signal<
    'analytics' | 'buyers' | 'guests' | 'resale' | 'email'
  >('analytics');

  /** Ordered tab list for keyboard navigation */
  private readonly tabs = [
    'analytics',
    'buyers',
    'guests',
    'resale',
    'email',
  ] as const;

  /** Handle keyboard navigation within the tab bar (ArrowLeft, ArrowRight, Home, End) */
  onTabKeydown(event: KeyboardEvent): void {
    const current = this.tabs.indexOf(this.activeTab());
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeTab.set(this.tabs[next]);

    // Move focus to the newly active tab button
    const tabButton = (
      event.currentTarget as HTMLElement
    ).querySelector<HTMLElement>(`[data-testid="tab-${this.tabs[next]}"]`);
    tabButton?.focus();
  }

  readonly isGeneratingSettlement = signal<boolean>(false);
  readonly isSettlementExportReady = computed(
    () =>
      !!this.summary() &&
      !!safeResourceValue(this.purchasesResource) &&
      !!safeResourceValue(this.resaleResource),
  );

  /** Incremented to trigger child reminder/broadcast components to reload */
  readonly reloadToken = signal(0);

  readonly checkInPercentage = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return Math.round(s.checkInStats.checkInRate * 100);
  });

  /** Total purchase count — used by nav badges and the "Purchases" card. */
  readonly purchaseCount = computed(() => this.purchases().length);

  /** Current ticket sales status */
  readonly ticketSalesStatus = computed<TicketSalesStatus>(() => {
    const s = this.summary();
    return s?.event?.ticketSalesStatus ?? 'active';
  });

  /**
   * Whether tickets are sold out. Sourced from the backend which computes
   * `remaining === 0` where remaining = totalTickets - soldCount - heldCount.
   * Do not recompute here — doing so would ignore heldCount and diverge from
   * public event card / buy-gate derivation.
   */
  readonly isSoldOut = computed(() => this.summary()?.isSoldOut ?? false);

  /** Loading state for status update */
  readonly isUpdatingStatus = signal(false);

  /** Reload every management surface. */
  protected reloadData(): void {
    this.summaryResource.reload();
    this.purchasesResource.reload();
    this.resaleResource.reload();
    this.guestsResource.reload();
    this.importedTicketsResource.reload();
    this.reloadToken.update((n) => n + 1);
  }

  async updateTicketSalesStatus(status: TicketSalesStatus): Promise<void> {
    const eventId = this.eventId();
    if (!eventId || this.isUpdatingStatus()) return;

    this.actionError.set(null);
    this.isUpdatingStatus.set(true);
    try {
      await this.adminEventsService.updateTicketSalesStatus(eventId, status);
      this.summaryResource.reload();
    } catch (error) {
      logger.error('Failed to update ticket sales status', error);
      this.actionError.set('Failed to update ticket sales status.');
    } finally {
      this.isUpdatingStatus.set(false);
    }
  }

  async exportSettlementReport(): Promise<void> {
    const summary = this.summary();
    const purchasesPayload = safeResourceValue(this.purchasesResource);
    const resalePayload = safeResourceValue(this.resaleResource);
    if (!summary || !purchasesPayload || !resalePayload) {
      toast.error('Settlement report data is still loading.');
      return;
    }

    this.isGeneratingSettlement.set(true);
    try {
      const input: SettlementExportInput = {
        event: {
          _id: summary.event._id,
          title: summary.event.title,
          date: summary.event.date,
          location: summary.event.location,
        },
        revenue: summary.revenue,
        revenueByTier: summary.revenueByTier,
        purchases: purchasesPayload.purchases,
        resaleMetrics: resalePayload.resaleMetrics,
        resaleListings: resalePayload.resaleListings,
      };
      await this.settlementExportService.export(input);
      toast.success('Settlement report download started.');
    } catch (error) {
      logger.error('Failed to export settlement report', error);
      toast.error('Failed to export settlement report.');
    } finally {
      this.isGeneratingSettlement.set(false);
    }
  }

  /** Count of active (listed/pending) resale listings for tab badge */
  readonly resaleListingCount = computed(
    () =>
      this.resaleListings().filter(
        (listing) =>
          listing.status === 'listed' || listing.status === 'pending',
      ).length,
  );

  /** Whether resale is currently enabled for this event */
  readonly resaleEnabled = computed(
    () => this.summary()?.event?.resaleEnabled ?? false,
  );

  /** Current resale fee percentage */
  readonly resaleFeePct = computed(
    () => this.summary()?.event?.resaleFeePct ?? null,
  );

  readonly payoutStatus = computed(() => {
    const event = this.summary()?.event;
    if (!event) return null;
    return computePayoutStatus(event);
  });

  readonly payoutStatusDescription = computed(() => {
    const status = this.payoutStatus();
    if (!status) return '';
    switch (status.state) {
      case 'pre-event':
        return 'Revenue will be paid out 3 days after your event ends.';
      case 'pending':
        return `Funds are in the 3-day settlement period. Payout scheduled for ${this.datePipe.transform(status.payoutDate, 'mediumDate')}.`;
      case 'processing':
        return 'Your payout is being processed and should arrive in 1-2 business days.';
      case 'paid':
        return `Revenue was paid out on ${this.datePipe.transform(status.date, 'mediumDate')}.`;
    }
  });
}
