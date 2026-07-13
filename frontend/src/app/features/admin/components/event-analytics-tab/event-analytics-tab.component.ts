import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {CurrencyPipe} from '@angular/common';
import type {ChartOptions} from '@/features/admin/pages/event-management/components/sales-chart/sales-chart.component';
import {type EventManagementSummary} from '@/features/admin/models/event-management.model';
import type {TicketSalesStatus} from '@/features/admin/services/admin-events.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {SalesChartComponent} from '@/features/admin/pages/event-management/components/sales-chart/sales-chart.component';
import {CheckInChartComponent} from '@/features/admin/pages/event-management/components/check-in-chart/check-in-chart.component';
import {BRAND_PALETTE} from '@/utils/brand-palette';
import {AuthService} from '@/core/services/auth.service';
import {CheckInSummaryStripComponent} from '@/features/admin/components/check-in-summary-strip/check-in-summary-strip.component';
import {CheckInActivityFeedComponent} from '@/features/admin/components/check-in-activity-feed/check-in-activity-feed.component';
import {AttendeeRosterTableComponent} from '@/features/admin/components/attendee-roster-table/attendee-roster-table.component';
import {type CheckInMode} from '@/features/admin/components/check-in-summary-strip/check-in-summary-strip.component';
import {BraDarkMode, EDarkModes} from '@ui/services/dark-mode';
import type {TicketTier} from '@shared/domain/ticket-tier';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {EVENT_DATE_TIME_ZONE} from '@/utils/event-date-format';
import {eventStartInstantMs} from '@shared/event-time';

/** 2-hour buffer after event start before door-rush mode ends */
const DOOR_RUSH_BUFFER_MS = 2 * 60 * 60 * 1000;
/** Assumed event duration in ms used for door-rush window when no endsAt exists */
const ASSUMED_EVENT_DURATION_MS = 8 * 60 * 60 * 1000;
const platformChartTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_DATE_TIME_ZONE,
  minute: '2-digit',
  hour: 'numeric',
  hour12: true,
});

function formatPlatformChartTime(value: string | number): string {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp)) return '';
  return platformChartTimeFormatter.format(new Date(timestamp));
}

export interface TierPricingStat {
  tier: TicketTier;
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  mode: number[];
}

@Component({
  selector: 'app-event-analytics-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    // SalesChartComponent and CheckInChartComponent are only used inside @defer blocks
    // so Angular creates dynamic import() for ApexCharts instead of a static import.
    SalesChartComponent,
    CheckInChartComponent,
    CheckInSummaryStripComponent,
    CheckInActivityFeedComponent,
    AttendeeRosterTableComponent,
  ],
  templateUrl: './event-analytics-tab.component.html',
})
export class EventAnalyticsTabComponent {
  protected readonly platformTimeZone = EVENT_DATE_TIME_ZONE;
  private readonly auth = inject(AuthService);
  private readonly browser = inject(BrowserPlatformService);
  private readonly darkMode = inject(BraDarkMode);

  private getCssVariable(name: string): string {
    const val = this.browser.getRootComputedStyleProperty(name);
    if (!val) return '';
    // Convert space-separated hsl values to comma-separated for better compatibility with charting libraries
    return val.includes(' ') && !val.includes(',')
      ? `hsl(${val.split(' ').join(', ')})`
      : `hsl(${val})`;
  }

  /** Summary data required for all display computeds (revenue, tiers, checkin, sales-by-day, event). */
  readonly summary = input.required<EventManagementSummary | null>();

  /** Purchase count used only to toggle the settlement export button. */
  readonly purchasesCount = input.required<number>();

  /** Alias so template can call data() without null-checking (parent only renders when non-null) */
  readonly data = computed(() => this.summary()!);

  /** Tier pricing stats from the parent's sliding-scale query */
  readonly tierPricingStats = input<TierPricingStat[]>([]);

  /** Whether the settlement report is currently being generated */
  readonly isGeneratingSettlement = input<boolean>(false);
  /** Whether all report data is ready for export. */
  readonly isSettlementExportReady = input<boolean>(true);

  /** Current ticket sales status */
  readonly ticketSalesStatus = input<TicketSalesStatus>('active');

  /** Ticket sales controls only apply after the event is published. */
  readonly canControlTicketSales = computed(
    () => this.summary()?.event.status === 'published',
  );

  readonly ticketSalesUnavailableLabel = computed(() => {
    const status = this.summary()?.event.status;
    if (status === 'draft') return 'Draft';
    if (status === 'cancelled') return 'Cancelled';
    return null;
  });

  readonly ticketSalesUnavailableMessage = computed(() => {
    const status = this.summary()?.event.status;
    if (status === 'draft') {
      return 'Publish this event before changing ticket sales.';
    }
    if (status === 'cancelled') {
      return 'Ticket sales controls are unavailable for cancelled events.';
    }
    return null;
  });

  /** Whether a status update is in progress */
  readonly isUpdatingStatus = input<boolean>(false);

  /** Whether this event is sold out */
  readonly isSoldOut = input<boolean>(false);

  /** Emitted when the user clicks Settlement Report */
  readonly exportSettlementReport = output();

  /** Emitted when the user requests a ticket sales status change */
  readonly updateTicketSalesStatus = output<TicketSalesStatus>();

  // ── Check-in analytics ────────────────────────────────────────────

  /** Event ID derived from summary data — null until data loads */
  readonly eventId = computed(() => this.summary()?.event?._id ?? null);

  /**
   * Check-in mode computed from the event date relative to now.
   * - 'door-rush': event.date ≤ now ≤ event.date + 8h (assumed duration) + 2h buffer
   * - 'post-event': now > event.date + 8h + 2h
   * - 'pre-event': now < event.date
   *
   * The event schema has a single `date` field (ISO 8601) — no endsAt.
   * We assume an 8-hour event window + the spec's 2-hour post-door-rush buffer.
   * Per spec Open Question 2: pre-event renders an empty "WAITING FOR DOORS" state.
   */
  readonly checkInMode = computed((): CheckInMode => {
    const event = this.summary()?.event;
    if (!event?.date) return 'pre-event';
    const startsAt = eventStartInstantMs(event.date);
    if (startsAt === null) return 'pre-event';
    const endsAt = startsAt + ASSUMED_EVENT_DURATION_MS;
    const now = Date.now();
    if (now < startsAt) return 'pre-event';
    if (now <= endsAt + DOOR_RUSH_BUFFER_MS) return 'door-rush';
    return 'post-event';
  });

  /**
   * Whether the current user can export the roster.
   * Door staff (scanner-only role): false.
   * Community admin, root admin: true.
   */
  readonly canExport = computed(() => {
    const role = this.auth.userRole();
    return role === 'root_admin' || role === 'community_admin';
  });

  // ── Pure display computeds ─────────────────────────────────────────

  readonly hasSalesData = computed(
    () => (this.summary()?.salesByDay?.length ?? 0) > 0,
  );

  readonly hasCheckInData = computed(
    () => (this.summary()?.checkInStats.buckets.length ?? 0) > 0,
  );

  /** ApexCharts configuration for sales area chart */
  readonly chartOptions = computed<ChartOptions>(() => {
    const isDark = this.darkMode.themeMode() === EDarkModes.DARK;
    const d = this.summary();
    const salesByDay: EventManagementSummary['salesByDay'] =
      d?.salesByDay ?? [];

    const categories = salesByDay.map(
      (item: EventManagementSummary['salesByDay'][number]) => item.date,
    );
    const values = salesByDay.map(
      (item: EventManagementSummary['salesByDay'][number]) => item.quantity,
    );

    const mutedForeground =
      this.getCssVariable('--muted-foreground') ||
      (isDark ? '#e4e4e7' : '#71717a');
    const border =
      this.getCssVariable('--border') || (isDark ? '#27272a' : '#e4e4e7');
    const primary = this.getCssVariable('--primary') || BRAND_PALETTE.primary;
    const background =
      this.getCssVariable('--background') || (isDark ? '#0a0a0a' : '#ffffff');

    return {
      series: [
        {
          name: 'Tickets Sold',
          data: values,
        },
      ],
      chart: {
        type: 'area',
        height: 200,
        fontFamily: 'Space Mono, monospace',
        background: 'transparent',
        toolbar: {show: false},
        zoom: {enabled: false},
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 500,
        },
      },
      colors: [primary],
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.5,
          opacityTo: 0.05,
          stops: [0, 90, 100],
          colorStops: [
            {offset: 0, color: primary, opacity: 0.5},
            {offset: 100, color: primary, opacity: 0.02},
          ],
        },
      },
      stroke: {
        curve: 'smooth',
        width: 3,
      },
      markers: {
        size: 5,
        colors: [primary],
        strokeColors: background,
        strokeWidth: 2,
        hover: {
          size: 7,
          sizeOffset: 2,
        },
      },
      dataLabels: {
        enabled: false,
      },
      xaxis: {
        categories,
        labels: {
          style: {
            colors: mutedForeground,
            fontSize: '10px',
            fontFamily: 'Space Mono, monospace',
          },
          rotate: -45,
          rotateAlways: salesByDay.length > 5,
        },
        axisBorder: {show: false},
        axisTicks: {show: false},
        crosshairs: {
          show: true,
          stroke: {
            color: primary,
            width: 1,
            dashArray: 4,
          },
        },
      },
      yaxis: {
        min: 0,
        labels: {
          style: {
            colors: mutedForeground,
            fontSize: '10px',
            fontFamily: 'Space Mono, monospace',
          },
          formatter: (val: number) => Math.round(val).toString(),
        },
      },
      grid: {
        borderColor: border,
        strokeDashArray: 4,
        xaxis: {lines: {show: false}},
        yaxis: {lines: {show: true}},
      },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        style: {
          fontSize: '12px',
          fontFamily: 'Space Mono, monospace',
        },
        x: {
          show: true,
          format: 'MMM dd',
        },
        marker: {
          show: true,
        },
        custom: undefined,
      },
      theme: {
        mode: isDark ? 'dark' : 'light',
      },
    };
  });

  readonly checkInChartOptions = computed((): ChartOptions | null => {
    const isDark = this.darkMode.themeMode() === EDarkModes.DARK;
    const d = this.summary();
    if (!d || d.checkInStats.buckets.length === 0) return null;
    const buckets: EventManagementSummary['checkInStats']['buckets'] =
      d.checkInStats.buckets;

    const mutedForeground =
      this.getCssVariable('--muted-foreground') ||
      (isDark ? '#e4e4e7' : '#a1a1aa');
    const border =
      this.getCssVariable('--border') || (isDark ? '#27272a' : '#e4e4e7');
    const primary = this.getCssVariable('--primary') || BRAND_PALETTE.primary;

    return {
      series: [
        {
          name: 'Check-ins',
          data: buckets.map(
            (
              bucket: EventManagementSummary['checkInStats']['buckets'][number],
            ) => ({
              x: bucket.time,
              y: bucket.count,
            }),
          ),
        },
      ],
      chart: {
        type: 'area',
        height: 280,
        toolbar: {show: false},
        background: 'transparent',
      },
      xaxis: {
        type: 'numeric',
        labels: {
          formatter: formatPlatformChartTime,
          style: {
            colors: mutedForeground,
            fontFamily: 'Space Mono',
            fontSize: '10px',
          },
        },
      },
      yaxis: {
        labels: {
          style: {
            colors: mutedForeground,
            fontFamily: 'Space Mono',
            fontSize: '10px',
          },
        },
        min: 0,
        forceNiceScale: true,
      },
      dataLabels: {enabled: false},
      stroke: {curve: 'smooth', width: 2},
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.4,
          opacityTo: 0.05,
          stops: [0, 100],
        },
      },
      grid: {
        borderColor: border,
        strokeDashArray: 4,
        padding: {left: 8, right: 8},
      },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: {formatter: formatPlatformChartTime},
        style: {fontFamily: 'Space Mono', fontSize: '11px'},
      },
      markers: {size: 0},
      theme: {mode: isDark ? 'dark' : 'light'},
      colors: [primary],
    };
  });
}
