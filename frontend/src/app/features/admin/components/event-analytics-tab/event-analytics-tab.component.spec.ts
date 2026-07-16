import '../../../../../test-setup';
import {
  type ComponentFixture,
  TestBed,
  DeferBlockBehavior,
} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {expect, describe, it, vi, afterEach} from 'vitest';
import {patchChartHostDimensions} from '@/features/admin/pages/event-management/components/testing/chart-options.fixture';
import {CONVEX} from 'convex-angular';
import {AuthService} from '@/core/services/auth.service';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {EDarkModes, BraDarkMode} from '@ui/services/dark-mode';
import {type EventManagementSummary} from '@/features/admin/models/event-management.model';
import {createMockConvexClient} from '@/testing/mock-types';
import {EventAnalyticsTabComponent} from './event-analytics-tab.component';
import {EventAnalyticsTabHarness} from './event-analytics-tab.component.harness';

describe('EventAnalyticsTabComponent', () => {
  let fixture: ComponentFixture<EventAnalyticsTabComponent>;

  const eventId = 'event1' as EventManagementSummary['event']['_id'];
  const organizerId = 'org1' as EventManagementSummary['event']['organizerId'];

  function buildSummary(
    eventOverrides: Partial<EventManagementSummary['event']> = {},
  ): EventManagementSummary {
    return {
      event: {
        _id: eventId,
        _creationTime: 123,
        id: eventId,
        organizerId,
        title: 'Neon Night',
        date: '2026-01-14',
        location: 'Underground',
        price: 2500,
        totalTickets: 10,
        status: 'published',
        ticketSalesStatus: 'active',
        visibility: 'public',
        resaleEnabled: false,
        resaleFeePct: 4.2,
        ...eventOverrides,
      },
      soldCount: 0,
      heldCount: 0,
      remainingCount: 10,
      isSoldOut: false,
      totalTickets: 10,
      imported: {total: 0, checkedIn: 0, bySource: []},
      tierCounts: {
        regular: 0,
        notaflof: 0,
        supporter: 0,
      },
      salesByDay: [],
      revenue: {
        grossCents: 0,
        processingFeeCents: 0,
        platformFeeCents: 0,
        refundedCents: 0,
        lostProcessingFeeCents: 0,
        netCents: 0,
      },
      revenueByTier: {
        regular: {grossCents: 0, netCents: 0, quantity: 0},
        notaflof: {grossCents: 0, netCents: 0, quantity: 0},
        supporter: {grossCents: 0, netCents: 0, quantity: 0},
      },
      checkInStats: {
        checkedIn: 0,
        checkInRate: 0,
        buckets: [],
      },
    };
  }

  async function setup(
    summary: EventManagementSummary,
    deferBlockBehavior = DeferBlockBehavior.Manual,
  ): Promise<EventAnalyticsTabHarness> {
    TestBed.configureTestingModule({
      imports: [EventAnalyticsTabComponent],
      deferBlockBehavior,
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: {userRole: () => 'community_admin'},
        },
        {
          provide: BrowserPlatformService,
          useValue: {getRootComputedStyleProperty: () => ''},
        },
        {
          provide: BraDarkMode,
          useValue: {themeMode: () => EDarkModes.LIGHT},
        },
        {provide: CONVEX, useValue: createMockConvexClient()},
      ],
    });

    fixture = TestBed.createComponent(EventAnalyticsTabComponent);
    fixture.componentRef.setInput('summary', summary);
    fixture.componentRef.setInput('purchasesCount', 0);
    fixture.detectChanges();
    await fixture.whenStable();
    return TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventAnalyticsTabHarness,
    );
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('formats check-in chart timestamps in the platform timezone', async () => {
    const rawUtcMidnightPdt = Date.UTC(2025, 5, 2, 7, 0, 0);

    await setup({
      ...buildSummary(),
      checkInStats: {
        checkedIn: 3,
        checkInRate: 1,
        buckets: [{time: rawUtcMidnightPdt, count: 3}],
      },
    });

    const options = fixture.componentInstance.checkInChartOptions();
    const firstPoint = options?.series[0]?.data[0] as
      {x: number; y: number} | undefined;
    const labelFormatter = options?.xaxis.labels?.formatter;
    const tooltipFormatter = options?.tooltip.x?.formatter;

    expect(options?.xaxis.type).toBe('numeric');
    expect(firstPoint).toEqual({x: rawUtcMidnightPdt, y: 3});
    expect(labelFormatter?.(rawUtcMidnightPdt)).toBe('12:00 AM');
    expect(tooltipFormatter?.(rawUtcMidnightPdt)).toBe('12:00 AM');
  });

  it('shows pause and end sales actions for a published active event', async () => {
    const harness = await setup(buildSummary());

    expect(await harness.hasPauseSalesButton()).toBe(true);
    expect(await harness.hasEndSalesButton()).toBe(true);
    expect(await harness.getTicketSalesUnavailableMessageText()).toBeNull();
  });

  it('renders both charts concurrently through their immediate defer blocks', async () => {
    // Regression for the ApexCharts registration race: both charts load
    // through concurrent @defer blocks, and each must register its own chart
    // types — CheckInChart used to crash with `chart type "line" is not
    // registered` whenever its chunk beat SalesChart's.
    const restoreDimensions = patchChartHostDimensions();
    try {
      const harness = await setup(
        {
          ...buildSummary(),
          salesByDay: [
            {date: '2026-01-10', quantity: 2},
            {date: '2026-01-11', quantity: 5},
          ],
          checkInStats: {
            checkedIn: 3,
            checkInRate: 1,
            buckets: [
              {time: Date.UTC(2026, 0, 14, 20, 0, 0), count: 1},
              {time: Date.UTC(2026, 0, 14, 21, 0, 0), count: 2},
            ],
          },
        },
        DeferBlockBehavior.Playthrough,
      );

      await vi.waitFor(async () => {
        const salesChart = await harness.getSalesChart();
        const checkInChart = await harness.getCheckInChart();
        expect(salesChart).not.toBeNull();
        expect(checkInChart).not.toBeNull();
        expect(await salesChart!.hasRenderedSeries()).toBe(true);
        expect(await checkInChart!.hasRenderedSeries()).toBe(true);
      });
    } finally {
      restoreDimensions();
    }
  });

  it('shows empty states and no charts when there is no sales or check-in data', async () => {
    const harness = await setup(buildSummary(), DeferBlockBehavior.Playthrough);

    expect(await harness.getSalesChart()).toBeNull();
    expect(await harness.getCheckInChart()).toBeNull();
    expect(await harness.isCheckInChartCardPresent()).toBe(false);
    expect(await harness.getSalesEmptyStateText()).toBe('No sales yet.');
  });

  it('hides pause and end sales actions for a draft event', async () => {
    const harness = await setup(
      buildSummary({
        status: 'draft',
        ticketSalesStatus: 'active',
      }),
    );

    expect(await harness.hasPauseSalesButton()).toBe(false);
    expect(await harness.hasEndSalesButton()).toBe(false);
    expect(await harness.getTicketSalesUnavailableMessageText()).toBe(
      'Publish this event before changing ticket sales.',
    );
  });
});
