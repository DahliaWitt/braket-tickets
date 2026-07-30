import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {By} from '@angular/platform-browser';
import {ActivatedRoute, convertToParamMap} from '@angular/router';
import type {RichTextEditorComponent} from '@/features/admin/components/rich-text-editor/rich-text-editor.component';
import {ConvexError} from 'convex/values';
import {of} from 'rxjs';
import {vi, describe, it, expect, beforeEach, type Mock} from 'vitest';
import {EventManagement, computePayoutStatus} from './event-management';
import {EventManagementHarness} from './event-management.harness';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {SettlementExportService} from '@/features/admin/services/settlement-export.service';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {CONVEX} from 'convex-angular';
import {type Id} from '@convex/_generated/dataModel';
import {api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';
import {toast} from 'ngx-sonner';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';
import {logger} from '@/utils/logger';
import {
  type EventManagementPurchases,
  type EventManagementResale,
  type EventManagementSummary,
  type EventTierPricingStats,
  type TicketReminderAudience,
} from '../../models/event-management.model';

/**
 * Fills a rich-text email editor rendered inside the given tab host. TipTap only
 * mutates its document through its command API (synthetic DOM key events do not
 * drive it under happy-dom), so we reach the component instance and insert
 * content, which emits the same jsonChange/textChange the UI relies on.
 */
async function fillRichTextBody(
  fixture: ComponentFixture<EventManagement>,
  hostSelector: string,
  text: string,
): Promise<void> {
  const debugEl = fixture.debugElement.query(
    By.css(`${hostSelector} app-rich-text-editor`),
  );
  if (!debugEl) {
    throw new Error(
      `fillRichTextBody: no <app-rich-text-editor> found under "${hostSelector}"`,
    );
  }
  const editor = debugEl.componentInstance as RichTextEditorComponent;
  editor.getEditor()?.commands.insertContent(text);
  fixture.detectChanges();
  await fixture.whenStable();
}

interface AdminEventsServiceMock {
  refundPayment: Mock;
  forceRefundAll: Mock;
  refundTicket: Mock;
  getManagementSummary: Mock;
  getManagementPurchases: Mock;
  getManagementResale: Mock;
  getTierPricingStats: Mock;
  listImportedTickets: Mock;
  getTicketPdf: Mock;
  sendTicketPurchaseReminder: Mock;
  updateResaleSettings: Mock;
}

/**
 * Combined test fixture — retains the old single-shape mock DTO for test
 * ergonomics, but splits into the three per-surface payloads at mock setup.
 */
interface FullMockData {
  event: EventManagementSummary['event'];
  soldCount: number;
  heldCount: number;
  remainingCount: number;
  isSoldOut: boolean;
  totalTickets: number;
  tierCounts: EventManagementSummary['tierCounts'];
  purchases: EventManagementPurchases['purchases'];
  salesByDay: EventManagementSummary['salesByDay'];
  revenue: EventManagementSummary['revenue'];
  revenueByTier: EventManagementSummary['revenueByTier'];
  checkInStats: EventManagementSummary['checkInStats'];
  resaleMetrics: EventManagementResale['resaleMetrics'];
  resaleListings: EventManagementResale['resaleListings'];
}

function summaryOf(data: FullMockData): EventManagementSummary {
  return {
    event: data.event,
    soldCount: data.soldCount,
    heldCount: data.heldCount,
    remainingCount: data.remainingCount,
    isSoldOut: data.isSoldOut,
    totalTickets: data.totalTickets,
    imported: {total: 0, checkedIn: 0, bySource: []},
    tierCounts: data.tierCounts,
    salesByDay: data.salesByDay,
    revenue: data.revenue,
    revenueByTier: data.revenueByTier,
    checkInStats: data.checkInStats,
  };
}

function purchasesOf(data: FullMockData): EventManagementPurchases {
  return {event: data.event, purchases: data.purchases};
}

function resaleOf(data: FullMockData): EventManagementResale {
  return {
    event: data.event,
    resaleMetrics: data.resaleMetrics,
    resaleListings: data.resaleListings,
  };
}

interface AlertDialogServiceMock {
  confirm: Mock;
}

interface ResaleServiceMock {
  cancelResaleListing: Mock;
}

interface SettlementExportServiceMock {
  export: Mock;
}

import {functionReferenceMatches} from '@/testing/convex-reference-matchers';

describe('EventManagement', () => {
  let fixture: ComponentFixture<EventManagement>;
  let harness: EventManagementHarness;
  let adminEventsServiceMock: AdminEventsServiceMock;
  let alertDialogServiceMock: AlertDialogServiceMock;
  let resaleServiceMock: ResaleServiceMock;
  let settlementExportServiceMock: SettlementExportServiceMock;
  let convexMock: MockConvexClient;
  let reminderAudienceData: TicketReminderAudience;
  let reminderAudienceError: Error | null;
  let guestsData: FunctionReturnType<typeof api.events.guests.listByEvent>;
  let tierPricingStatsData: EventTierPricingStats;
  let guestListFeatureOnData: ((value: {enabled: boolean}) => void) | null;
  let guestListFeatureOnError: ((error: Error) => void) | null;

  const defaultBroadcastAudience = {
    recipientCount: 5,
    exceedsCap: false,
  };
  let marketingAnnouncementStatus: {
    _id: Id<'eventMarketingEmails'>;
    status: 'scheduled' | 'sent' | 'cancelled';
    scheduledFor: number;
    recipientCount?: number;
    sentAt?: number;
  } | null;
  let marketingRecipientCount: {count: number; cappedAt500: boolean};

  const defaultTierPricingStats: EventTierPricingStats = {
    tiers: [
      {
        tier: 'notaflof',
        count: 4,
        min: 500,
        max: 1500,
        mean: 1000,
        median: 1000,
        mode: [1000],
      },
      {
        tier: 'supporter',
        count: 2,
        min: 3000,
        max: 5000,
        mean: 4000,
        median: 4000,
        mode: [3000, 5000],
      },
    ],
  };

  const eventId = 'event1' as EventManagementSummary['event']['_id'];
  const purchaseId =
    'order1' as EventManagementPurchases['purchases'][number]['id'];
  const userId =
    'user1' as EventManagementPurchases['purchases'][number]['userId'];

  const mockData: FullMockData = {
    event: {
      _id: eventId,
      _creationTime: 123,
      title: 'Neon Night',
      date: '2026-01-14',
      location: 'Underground',
      price: 2500,
      totalTickets: 10,
      status: 'published',
      ticketSalesStatus: 'active',
      visibility: 'public',
      id: eventId,
      organizerId: 'org1' as Id<'organizers'>,
      resaleEnabled: false,
      resaleFeePct: 4.2,
    },
    soldCount: 3,
    heldCount: 0,
    remainingCount: 7,
    isSoldOut: false,
    totalTickets: 10,
    tierCounts: {
      regular: 1,
      notaflof: 1,
      supporter: 1,
    },
    purchases: [
      {
        id: purchaseId,
        userId,
        userName: 'Test User',
        userEmail: 'test@example.com',
        quantity: 2,
        amount: 5000,
        tier: 'regular',
        status: 'completed',
        createdAt: 1700000000000,
        tickets: [
          {
            id: 'ticket-1' as Id<'tickets'>,
            status: 'valid',
            tier: 'regular',
          },
          {
            id: 'ticket-2' as Id<'tickets'>,
            status: 'used',
            tier: 'regular',
          },
        ],
      },
    ],
    salesByDay: [
      {date: '2026-01-13', quantity: 1},
      {date: '2026-01-14', quantity: 2},
    ],
    revenue: {
      grossCents: 5000,
      processingFeeCents: 175,
      platformFeeCents: 100,
      refundedCents: 0,
      lostProcessingFeeCents: 0,
      netCents: 4725,
    },
    revenueByTier: {
      regular: {grossCents: 5000, netCents: 4725, quantity: 2},
      notaflof: {grossCents: 0, netCents: 0, quantity: 0},
      supporter: {grossCents: 0, netCents: 0, quantity: 0},
    },
    checkInStats: {
      checkedIn: 1,
      checkInRate: 0.33,
      buckets: [{time: 1748822400000, count: 1}],
    },
    resaleMetrics: {
      totalListings: 0,
      activeListings: 0,
      pendingListings: 0,
      completedResales: 0,
      cancelledListings: 0,
      totalRefundedToSellersCents: 0,
      totalResaleFeesCents: 0,
      totalLostProcessingFeesCents: 0,
      notificationSubscribers: 0,
    },
    resaleListings: [],
  };

  async function reloadManagementData(data: FullMockData): Promise<void> {
    adminEventsServiceMock.getManagementSummary.mockResolvedValue(
      summaryOf(data),
    );
    adminEventsServiceMock.getManagementPurchases.mockResolvedValue(
      purchasesOf(data),
    );
    adminEventsServiceMock.getManagementResale.mockResolvedValue(
      resaleOf(data),
    );
    fixture.componentInstance.summaryResource.reload();
    fixture.componentInstance.purchasesResource.reload();
    fixture.componentInstance.resaleResource.reload();
    await fixture.whenStable().catch(() => undefined);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    vi.spyOn(toast, 'info').mockImplementation(() => '');

    marketingAnnouncementStatus = null;
    marketingRecipientCount = {
      count: 6,
      cappedAt500: false,
    };
    reminderAudienceData = {
      segment: 'approved_no_ticket',
      recipientCount: 4,
      missingOrganizer: false,
    };
    reminderAudienceError = null;
    guestsData = [];
    tierPricingStatsData = {
      ...defaultTierPricingStats,
      tiers: defaultTierPricingStats.tiers.map((tier) => ({...tier})),
    };
    guestListFeatureOnData = null;
    guestListFeatureOnError = null;

    adminEventsServiceMock = {
      refundPayment: vi.fn().mockResolvedValue(true),
      forceRefundAll: vi.fn().mockResolvedValue(true),
      refundTicket: vi.fn().mockResolvedValue(true),
      getManagementSummary: vi.fn().mockResolvedValue(summaryOf(mockData)),
      getManagementPurchases: vi.fn().mockResolvedValue(purchasesOf(mockData)),
      getManagementResale: vi.fn().mockResolvedValue(resaleOf(mockData)),
      getTierPricingStats: vi
        .fn()
        .mockImplementation(() => Promise.resolve(tierPricingStatsData)),
      listImportedTickets: vi.fn().mockResolvedValue([]),
      getTicketPdf: vi
        .fn()
        .mockResolvedValue('data:application/pdf;base64,abc123'),
      sendTicketPurchaseReminder: vi.fn().mockResolvedValue({
        segment: 'approved_no_ticket',
        recipientCount: 4,
      }),
      updateResaleSettings: vi.fn().mockResolvedValue(undefined),
    };

    alertDialogServiceMock = {
      confirm: vi.fn(),
    };

    resaleServiceMock = {
      cancelResaleListing: vi.fn().mockResolvedValue(undefined),
    };
    settlementExportServiceMock = {
      export: vi.fn().mockResolvedValue(undefined),
    };

    const query = vi.fn(() => Promise.resolve(null));

    // Emissions are deferred to a microtask because injectQueries registers a
    // subscription in its active-key map only after onUpdate() returns; a
    // synchronous emission is dropped by its staleness guard. The real
    // ConvexReactClient also never emits synchronously, so deferral matches
    // production timing for injectQuery consumers too.
    const onUpdate = vi.fn(
      (
        queryFn: unknown,
        _args: unknown,
        onData: (value: unknown) => void,
        onError: (error: Error) => void,
      ) => {
        queueMicrotask(() => {
          if (
            functionReferenceMatches(queryFn, api.guest_list.feature_state.get)
          ) {
            guestListFeatureOnData = onData;
            guestListFeatureOnError = onError;
            onData({enabled: true});
            return;
          }
          if (
            functionReferenceMatches(queryFn, api.events.guests.listByEvent)
          ) {
            onData(guestsData);
            return;
          }
          if (
            functionReferenceMatches(
              queryFn,
              api.events.reminders.getTicketReminderAudience,
            )
          ) {
            if (reminderAudienceError) onError(reminderAudienceError);
            else onData(reminderAudienceData);
            return;
          }
          if (
            functionReferenceMatches(queryFn, api.events.broadcasts.getAudience)
          ) {
            if (reminderAudienceError) onError(reminderAudienceError);
            else onData(defaultBroadcastAudience);
            return;
          }
          if (
            functionReferenceMatches(queryFn, api.events.broadcasts.listHistory)
          ) {
            onData([]);
            return;
          }
          if (
            functionReferenceMatches(
              queryFn,
              api.marketing.emails.getAnnouncementStatus,
            )
          ) {
            onData(marketingAnnouncementStatus);
            return;
          }
          if (
            functionReferenceMatches(
              queryFn,
              api.marketing.emails.getRecipientCount,
            )
          ) {
            onData(marketingRecipientCount);
            return;
          }
          onData(null);
        });

        return () => void 0;
      },
    );

    convexMock = createMockConvexClient();
    convexMock.query = query;
    convexMock.client.query = query;
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;
    convexMock.mutation.mockResolvedValue({success: true, recipientCount: 3});
    convexMock.action.mockResolvedValue(undefined);
    convexMock.connectionState.mockReturnValue({
      hasInflightRequests: false,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasEverConnected: true,
      connectionCount: 1,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    });

    await TestBed.configureTestingModule({
      imports: [EventManagement],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {
          provide: SettlementExportService,
          useValue: settlementExportServiceMock,
        },
        {provide: BraAlertDialogService, useValue: alertDialogServiceMock},
        {provide: ResaleService, useValue: resaleServiceMock},
        {provide: CONVEX, useValue: convexMock},
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({id: 'event1'})),
            queryParamMap: of(convertToParamMap({community: 'lot-45'})),
            // Mirror the real lazy-loaded tree for `/community-admin/events/:id/manage`:
            //   MainLayout('') → 'community-admin' → '' (guard wrapper) → 'events/:id/manage'
            // `section()` walks `pathFromRoot` looking for 'admin' or
            // 'community-admin', so the mock must expose the full chain
            // rather than only the immediate parent.
            pathFromRoot: [
              {routeConfig: null}, // root
              {routeConfig: {path: ''}}, // MainLayout
              {routeConfig: {path: 'community-admin'}}, // lazy segment
              {routeConfig: {path: ''}}, // guard wrapper
              {routeConfig: {path: 'events/:id/manage'}}, // this route
            ],
            parent: {
              routeConfig: {path: ''},
              parent: {
                routeConfig: {path: 'community-admin'},
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventManagement);
    fixture.componentRef.setInput('id', 'event1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventManagementHarness,
    );
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should keep edit navigation within the community-admin section', () => {
    expect(fixture.componentInstance.editEventLink()).toEqual([
      '/community-admin',
      'events',
      'event1',
      'edit',
    ]);
    expect(fixture.componentInstance.section()).toBe('community-admin');
    expect(fixture.componentInstance.backLink()).toEqual([
      '/community-admin',
      'events',
    ]);
    expect(fixture.componentInstance.routeQueryParams()).toEqual({
      community: 'lot-45',
    });
  });

  it('should resolve to the admin section when mounted under /admin/*', async () => {
    // Independent TestBed instance with an `/admin`-shaped route tree.
    // Regression guard against the earlier `this.route.parent?.routeConfig?.path`
    // bug where the guard-wrapper parent node masked the actual admin segment.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EventManagement],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {
          provide: SettlementExportService,
          useValue: settlementExportServiceMock,
        },
        {provide: BraAlertDialogService, useValue: alertDialogServiceMock},
        {provide: ResaleService, useValue: resaleServiceMock},
        {provide: CONVEX, useValue: convexMock},
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({id: 'event1'})),
            queryParamMap: of(convertToParamMap({community: 'lot-45'})),
            pathFromRoot: [
              {routeConfig: null},
              {routeConfig: {path: ''}},
              {routeConfig: {path: 'admin'}},
              {routeConfig: {path: ''}},
              {routeConfig: {path: 'events/:id/manage'}},
            ],
            parent: {
              routeConfig: {path: ''},
              parent: {routeConfig: {path: 'admin'}},
            },
          },
        },
      ],
    }).compileComponents();

    const adminFixture = TestBed.createComponent(EventManagement);
    adminFixture.componentRef.setInput('id', 'event1');
    adminFixture.detectChanges();
    await adminFixture.whenStable();
    adminFixture.detectChanges();

    expect(adminFixture.componentInstance.section()).toBe('admin');
    expect(adminFixture.componentInstance.editEventLink()).toEqual([
      '/admin',
      'events',
      'event1',
      'edit',
    ]);
    expect(adminFixture.componentInstance.backLink()).toEqual([
      '/admin',
      'communities',
    ]);
    expect(adminFixture.componentInstance.routeQueryParams()).toBeNull();
  });

  it('should load management data', async () => {
    expect(adminEventsServiceMock.getManagementSummary).toHaveBeenCalledWith(
      'event1',
    );
    expect(adminEventsServiceMock.getManagementPurchases).toHaveBeenCalledWith(
      'event1',
    );
    expect(adminEventsServiceMock.getManagementResale).toHaveBeenCalledWith(
      'event1',
    );
    expect(await harness.getTicketsSoldText()).toContain('3 / 10');
    expect(await harness.getPurchaseCountText()).toBe('1');
  });

  it('should surface explicit large-event limits instead of the generic load error', async () => {
    adminEventsServiceMock.getManagementSummary.mockRejectedValue(
      new ConvexError({
        code: 'MANAGEMENT_DATA_TOO_LARGE',
        message:
          'Event management tickets exceed the supported limit of 10000 records. Admin metrics would be incomplete, so loading has been blocked.',
      }),
    );

    fixture.componentInstance.summaryResource.reload();
    await fixture.whenStable();
    fixture.detectChanges();

    const errorAlertText = (await harness.getManagementLoadErrorText()) ?? '';
    expect(fixture.componentInstance.summary()).toBeNull();
    expect(fixture.componentInstance.guests()).toEqual([]);
    expect(fixture.componentInstance.errorMessage()).toBe(
      'Event management tickets exceed the supported limit of 10000 records. Admin metrics would be incomplete, so loading has been blocked.',
    );
    expect(errorAlertText).toContain('10000');
    expect(errorAlertText).not.toContain("couldn't load event data");
  });

  it('should default to analytics tab', async () => {
    expect(await harness.getActiveTabAttribute('analytics')).toBe('true');
    expect(await harness.getActiveTabAttribute('buyers')).toBe('false');
    expect(await harness.getActiveTabAttribute('guests')).toBe('false');
    expect(await harness.getActiveTabAttribute('resale')).toBe('false');
    expect(await harness.getActiveTabAttribute('email')).toBe('false');
  });

  it('should switch to buyers tab', async () => {
    await harness.clickTab('buyers');
    fixture.detectChanges();

    expect(await harness.getActiveTabAttribute('buyers')).toBe('true');
    expect(await harness.getActiveTabAttribute('analytics')).toBe('false');
  });

  it('should switch to guests tab', async () => {
    await harness.clickTab('guests');
    fixture.detectChanges();

    expect(await harness.getActiveTabAttribute('guests')).toBe('true');
    expect(await harness.getActiveTabAttribute('analytics')).toBe('false');
  });

  it('does not query or render the assignment workspace while the rollout gate is disabled', async () => {
    expect(guestListFeatureOnData).not.toBeNull();
    convexMock.client.onUpdate.mockClear();
    guestListFeatureOnData?.({enabled: false});
    fixture.componentRef.setInput('id', 'event2');
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickTab('guests');

    expect(await harness.hasGuestListAssignmentsWorkspace()).toBe(false);
    expect(await harness.getGuestListUnavailableText()).toContain(
      'Self-service guest lists are not enabled yet',
    );
    expect(
      convexMock.client.onUpdate.mock.calls.some(([queryFn]) =>
        functionReferenceMatches(
          queryFn,
          api.guest_list.assignments.getEventOverview,
        ),
      ),
    ).toBe(false);
    expect(
      convexMock.client.onUpdate.mock.calls.some(([queryFn]) =>
        functionReferenceMatches(
          queryFn,
          api.guest_list.assignments.listByEvent,
        ),
      ),
    ).toBe(false);
  });

  it('isolates a self-service feature-state failure to the guest-list workspace', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    expect(guestListFeatureOnError).not.toBeNull();
    guestListFeatureOnError?.(new Error('feature state unavailable'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getManagementLoadErrorText()).toBeNull();
    await harness.clickTab('guests');
    expect(await harness.getGuestListWorkspaceErrorText()).toContain(
      "Self-service guest lists couldn't load",
    );
    expect(await harness.hasGuestListAssignmentsWorkspace()).toBe(false);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to load event management guestListFeature',
      expect.any(Error),
    );
  });

  it('should show count badges on buyers and guests tabs', async () => {
    expect(await harness.getTabBadgeText('buyers')).toBe('1');
    expect(await harness.getTabBadgeText('guests')).toBe('0');
  });

  describe('refund actions', () => {
    it('should open a confirmation dialog before refunding a payment', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.clickRefundPaymentAction(purchaseId);

      expect(alertDialogServiceMock.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Refund Payment',
          zOkText: 'Refund Payment',
          zOkDestructive: true,
          zMaskClosable: false,
        }),
      );
    });

    it('should refund a payment after confirmation', async () => {
      alertDialogServiceMock.confirm.mockImplementation(
        (config: {zOnOk?: (() => void | Promise<void>) | undefined}) => {
          void config.zOnOk?.();
        },
      );

      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.clickRefundPaymentAction(purchaseId);
      await fixture.whenStable();

      expect(adminEventsServiceMock.refundPayment).toHaveBeenCalledWith(
        purchaseId,
      );
    });

    it('should render a force refund all action for paid purchases', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasForceRefundAllAction(purchaseId)).toBe(true);
    });

    it('should give repeated purchase refund actions row-specific accessible names', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getRefundPaymentActionAriaLabel(purchaseId)).toBe(
        'Refund payment for Test User, test@example.com, order ORDER1',
      );
      expect(await harness.getForceRefundAllActionAriaLabel(purchaseId)).toBe(
        'Force refund all tickets for Test User, test@example.com, order ORDER1',
      );
    });

    it('should open a confirmation dialog before force refunding all tickets', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.clickForceRefundAllAction(purchaseId);

      expect(alertDialogServiceMock.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Force Refund All',
          zOkText: 'Force Refund All',
          zOkDestructive: true,
          zMaskClosable: false,
        }),
      );
    });

    it('should force refund all tickets after confirmation', async () => {
      alertDialogServiceMock.confirm.mockImplementation(
        (config: {zOnOk?: (() => void | Promise<void>) | undefined}) => {
          void config.zOnOk?.();
        },
      );

      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.clickForceRefundAllAction(purchaseId);
      await fixture.whenStable();

      expect(adminEventsServiceMock.forceRefundAll).toHaveBeenCalledWith(
        purchaseId,
      );
    });

    it('should keep force refund all enabled when a partial refund left used tickets behind', async () => {
      const partiallyRefundedData = structuredClone(mockData);
      const purchase = partiallyRefundedData.purchases[0];
      purchase.status = 'refunded';
      purchase.tickets[0].status = 'refunded';
      purchase.tickets[1].status = 'used';
      purchase.refundedAmountCents = 2500;

      await reloadManagementData(partiallyRefundedData);
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasForceRefundAllAction(purchaseId)).toBe(true);
      expect(await harness.isForceRefundAllActionDisabled(purchaseId)).toBe(
        false,
      );
    });

    it('should confirm force refund all with the remaining refundable balance', async () => {
      const partiallyRefundedData = structuredClone(mockData);
      const purchase = partiallyRefundedData.purchases[0];
      purchase.tickets[0].status = 'refunded';
      purchase.tickets[1].status = 'used';
      purchase.refundedAmountCents = 2500;

      await reloadManagementData(partiallyRefundedData);
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.clickForceRefundAllAction(purchaseId);

      const lastConfirmCall = alertDialogServiceMock.confirm.mock.calls.at(
        -1,
      ) as unknown[] | undefined;
      const confirmOptions = lastConfirmCall?.[0] as
        {zDescription?: string} | undefined;
      expect(confirmOptions?.zDescription).toContain('$25.00');
    });
  });

  it('should render reminder recipient count in buyers tab', async () => {
    await harness.clickTab('buyers');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getReminderRecipientCountText()).toContain(
      '4 eligible recipients',
    );
  });

  it('should keep reminder send button disabled until form is valid', async () => {
    await harness.clickTab('buyers');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isReminderSendDisabled()).toBe(true);

    await harness.setReminderSubject('Reminder subject');
    await fillRichTextBody(
      fixture,
      'app-ticket-reminder-tab',
      'Reminder message body.',
    );
    fixture.detectChanges();

    expect(await harness.isReminderSendDisabled()).toBe(false);
  });

  it('should show reminder audience error when preview loading fails', async () => {
    // The reminder audience is a live subscription created at mount, so the
    // error must exist before the component subscribes — the old
    // reloadToken-driven refetch path no longer exists. Mount a fresh
    // component instead of mutating the shared fixture.
    reminderAudienceError = new Error('preview failed');

    const errorFixture = TestBed.createComponent(EventManagement);
    errorFixture.componentRef.setInput('id', 'event1');
    errorFixture.detectChanges();
    await errorFixture.whenStable();
    errorFixture.detectChanges();
    const errorHarness = await TestbedHarnessEnvironment.harnessForFixture(
      errorFixture,
      EventManagementHarness,
    );

    await errorHarness.clickTab('buyers');
    errorFixture.detectChanges();
    await errorFixture.whenStable();

    expect(await errorHarness.getReminderAudienceErrorText()).toContain(
      "couldn't load reminder audience",
    );
    expect(await errorHarness.isReminderSendDisabled()).toBe(true);
  });

  describe('single ticket refunds', () => {
    it('should expand a multi-ticket purchase to show ticket rows', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();

      expect(await harness.isPurchaseTicketsExpanded(purchaseId)).toBe(false);

      await harness.clickPurchaseTicketsToggle(purchaseId);
      fixture.detectChanges();

      expect(await harness.isPurchaseTicketsExpanded(purchaseId)).toBe(true);
    });

    it('should call payments.refundTicket when refunding a valid ticket', async () => {
      alertDialogServiceMock.confirm.mockImplementation(
        (config: {zOnOk?: (() => void | Promise<void>) | undefined}) => {
          void config.zOnOk?.();
        },
      );

      await harness.clickTab('buyers');
      fixture.detectChanges();
      await harness.clickPurchaseTicketsToggle(purchaseId);
      fixture.detectChanges();

      await harness.clickTicketRefund('ticket-1');
      await fixture.whenStable();

      expect(adminEventsServiceMock.refundTicket).toHaveBeenCalledWith(
        'ticket-1',
      );
    });

    it('should show non-refundable ticket status without refund action', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await harness.clickPurchaseTicketsToggle(purchaseId);
      fixture.detectChanges();

      expect(await harness.getTicketStatusText('ticket-2')).toContain('used');
      expect(await harness.hasTicketRefundButton('ticket-2')).toBe(false);
    });

    it('should give repeated ticket refund actions row-specific accessible names', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await harness.clickPurchaseTicketsToggle(purchaseId);
      fixture.detectChanges();

      expect(await harness.getTicketRefundAriaLabel('ticket-1')).toBe(
        'Refund ticket 1 for Test User, test@example.com, order ORDER1',
      );
    });

    it('should disable same-purchase refund controls while single-ticket refund is in flight', async () => {
      let resolveRefund: ((value: boolean) => void) | undefined;
      const pendingRefund = new Promise<boolean>((resolve) => {
        resolveRefund = resolve;
      });
      adminEventsServiceMock.refundTicket.mockReturnValueOnce(pendingRefund);

      alertDialogServiceMock.confirm.mockImplementation(
        (config: {zOnOk?: (() => void | Promise<void>) | undefined}) => {
          void config.zOnOk?.();
        },
      );

      await harness.clickTab('buyers');
      fixture.detectChanges();
      await harness.clickPurchaseTicketsToggle(purchaseId);
      fixture.detectChanges();

      await harness.clickTicketRefund('ticket-1');
      await Promise.resolve();
      fixture.detectChanges();

      expect(await harness.isTicketRefundDisabled('ticket-1')).toBe(true);
      expect(await harness.isRefundPaymentActionDisabled(purchaseId)).toBe(
        true,
      );
      expect(await harness.isForceRefundAllActionDisabled(purchaseId)).toBe(
        true,
      );

      resolveRefund?.(true);
      await Promise.resolve();
      fixture.detectChanges();
      await fixture.whenStable();
    });
  });

  describe('a11y: ARIA tab pattern', () => {
    it('should set aria-controls on each tab', async () => {
      expect(await harness.getTabAriaControls('analytics')).toBe(
        'panel-analytics',
      );
      expect(await harness.getTabAriaControls('buyers')).toBe('panel-buyers');
      expect(await harness.getTabAriaControls('guests')).toBe('panel-guests');
      expect(await harness.getTabAriaControls('resale')).toBe('panel-resale');
      expect(await harness.getTabAriaControls('email')).toBe('panel-email');
    });

    it('should set tabindex 0 on active tab and -1 on inactive tabs', async () => {
      expect(await harness.getTabTabindex('analytics')).toBe('0');
      expect(await harness.getTabTabindex('buyers')).toBe('-1');
      expect(await harness.getTabTabindex('guests')).toBe('-1');
      expect(await harness.getTabTabindex('resale')).toBe('-1');
      expect(await harness.getTabTabindex('email')).toBe('-1');

      await harness.clickTab('guests');
      fixture.detectChanges();

      expect(await harness.getTabTabindex('analytics')).toBe('-1');
      expect(await harness.getTabTabindex('buyers')).toBe('-1');
      expect(await harness.getTabTabindex('guests')).toBe('0');
      expect(await harness.getTabTabindex('resale')).toBe('-1');
      expect(await harness.getTabTabindex('email')).toBe('-1');
    });

    it('should link panel to tab via aria-labelledby and id', async () => {
      const panel = await harness.getPanelAttributes('analytics');
      expect(panel.id).toBe('panel-analytics');
      expect(panel.labelledby).toBe('tab-analytics');
      expect(panel.tabindex).toBe('0');
    });

    it('should update panel linkage when switching tabs', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();

      const panel = await harness.getPanelAttributes('buyers');
      expect(panel.id).toBe('panel-buyers');
      expect(panel.labelledby).toBe('tab-buyers');
    });

    it('should keep analytics panel in DOM but hidden when switching tabs', async () => {
      // Analytics panel visible by default
      const analyticsDefault = await harness.getPanelAttributes('analytics');
      expect(analyticsDefault.hidden).toBeNull();

      // Switch to buyers -- analytics should be hidden, not destroyed
      await harness.clickTab('buyers');
      fixture.detectChanges();

      const analyticsHidden = await harness.getPanelAttributes('analytics');
      expect(analyticsHidden.hidden).not.toBeNull();

      // Switch back -- analytics should be visible again
      await harness.clickTab('analytics');
      fixture.detectChanges();

      const analyticsVisible = await harness.getPanelAttributes('analytics');
      expect(analyticsVisible.hidden).toBeNull();
    });
  });

  describe('resale tab', () => {
    it('should switch to resale tab', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getActiveTabAttribute('resale')).toBe('true');
      expect(await harness.getActiveTabAttribute('analytics')).toBe('false');
    });

    it('should not show resale badge when no active listings', async () => {
      expect(await harness.getResaleTabBadgeText()).toBeNull();
    });

    it('should show resale toggle as off by default', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.isResaleToggleChecked()).toBe(false);
    });

    it('should render resale panel with correct ARIA attributes', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      const panel = await harness.getPanelAttributes('resale');
      expect(panel.id).toBe('panel-resale');
      expect(panel.labelledby).toBe('tab-resale');
      expect(panel.tabindex).toBe('0');
    });

    it('should show empty state in queue when no listings', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getResaleQueueCountText()).toBe('0 active');
      expect(await harness.getResaleListingRowCount()).toBe(0);
    });

    it('should show metrics with zero values by default', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getResaleCompletedCountText()).toBe('0');
      expect(await harness.getResaleNotificationSubsText()).toBe('0');
    });

    it('should not render negative zero for lost processing fees', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      const text = (await harness.getResaleLostProcessingFeesText()) ?? '';
      expect(text).not.toContain('-$0.00');
    });

    it('should call toggleResaleEnabled when toggle is clicked', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      await harness.clickResaleToggle();

      expect(adminEventsServiceMock.updateResaleSettings).toHaveBeenCalledWith(
        'event1',
        {
          resaleEnabled: true,
        },
      );
    });
  });

  describe('email tab', () => {
    it('should switch to email tab', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();

      expect(await harness.getActiveTabAttribute('email')).toBe('true');
      expect(await harness.getActiveTabAttribute('analytics')).toBe('false');
    });

    it('should render email panel with correct ARIA attributes', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();

      const panel = await harness.getPanelAttributes('email');
      expect(panel.id).toBe('panel-email');
      expect(panel.labelledby).toBe('tab-email');
      expect(panel.tabindex).toBe('0');
    });

    it('should disable send when form is empty', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isBroadcastSendDisabled()).toBe(true);
    });

    it('should show recipient count', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const text = await harness.getBroadcastRecipientCountText();
      expect(text).toContain('5');
      expect(text).toContain('recipients');
    });

    it('should show empty history', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isBroadcastHistoryEmpty()).toBe(true);
    });

    it('should render the marketing announcement card', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isMarketingAnnouncementCardVisible()).toBe(true);
      expect(await harness.getMarketingAnnouncementEmptyText()).toContain(
        'No marketing announcement is scheduled yet.',
      );
    });

    it('should enable send when form is filled and recipients exist', async () => {
      await harness.clickTab('email');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.setBroadcastSubject('Test Subject');
      await fillRichTextBody(
        fixture,
        'app-broadcast-email-tab',
        'Test Message Body',
      );
      fixture.detectChanges();

      expect(await harness.isBroadcastSendDisabled()).toBe(false);
    });
  });

  describe('settlement report', () => {
    it('should show visible feedback after exporting a settlement report', async () => {
      const analyticsHarness = await harness.getAnalyticsTabHarness();
      expect(analyticsHarness).not.toBeNull();

      await analyticsHarness!.clickSettlementReport();
      await fixture.whenStable();

      expect(settlementExportServiceMock.export).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith(
        'Settlement report download started.',
      );
    });

    it('should show a visible error when settlement export fails', async () => {
      settlementExportServiceMock.export.mockRejectedValueOnce(
        new Error('PDF failed'),
      );
      const analyticsHarness = await harness.getAnalyticsTabHarness();
      expect(analyticsHarness).not.toBeNull();

      await analyticsHarness!.clickSettlementReport();
      await fixture.whenStable();

      expect(toast.error).toHaveBeenCalledWith(
        'Failed to export settlement report.',
      );
    });

    it('should not silently no-op when settlement data is not ready', async () => {
      vi.mocked(toast.error).mockClear();
      adminEventsServiceMock.getManagementSummary.mockReturnValueOnce(
        new Promise(() => undefined),
      );

      const pendingFixture = TestBed.createComponent(EventManagement);
      pendingFixture.componentRef.setInput('id', 'event1');
      pendingFixture.detectChanges();

      await pendingFixture.componentInstance.exportSettlementReport();

      expect(settlementExportServiceMock.export).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'Settlement report data is still loading.',
      );

      pendingFixture.destroy();
    });
  });

  describe('resale tab with active listings', () => {
    const listingId =
      'listing1' as EventManagementResale['resaleListings'][number]['_id'];
    const sellerId =
      'seller1' as EventManagementResale['resaleListings'][number]['sellerId'];
    const ticketId =
      'ticket1' as EventManagementResale['resaleListings'][number]['ticketId'];

    const mockDataWithResale: FullMockData = {
      ...mockData,
      event: {
        ...mockData.event,
        resaleEnabled: true,
        resaleFeePct: 4.2,
      },
      resaleMetrics: {
        totalListings: 3,
        activeListings: 1,
        pendingListings: 1,
        completedResales: 2,
        cancelledListings: 0,
        totalRefundedToSellersCents: 4800,
        totalResaleFeesCents: 210,
        totalLostProcessingFeesCents: 145,
        notificationSubscribers: 5,
      },
      resaleListings: [
        {
          _id: listingId,
          _creationTime: 1700000000000,
          ticketId,
          eventId,
          sellerId,
          sellerName: 'Jane Doe',
          sellerEmail: 'jane@example.com',
          status: 'listed',
        },
      ],
    };

    beforeEach(async () => {
      await reloadManagementData(mockDataWithResale);
      fixture.detectChanges();
    });

    it('should show resale tab badge with active listing count', async () => {
      // 1 listed + 0 pending in our mock = 1
      expect(await harness.getResaleTabBadgeText()).toBe('1');
    });

    it('should show resale toggle as on', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.isResaleToggleChecked()).toBe(true);
    });

    it('should show listing rows in queue', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getResaleListingRowCount()).toBeGreaterThanOrEqual(
        1,
      );
    });

    it('should show metrics with correct values', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getResaleCompletedCountText()).toBe('2');
      expect(await harness.getResaleNotificationSubsText()).toBe('5');
    });

    it('should show queue count as active', async () => {
      await harness.clickTab('resale');
      fixture.detectChanges();

      expect(await harness.getResaleQueueCountText()).toBe('1 active');
    });
  });

  describe('check-in stats card and chart', () => {
    const mockDataWithCheckIn: FullMockData = {
      ...mockData,
      soldCount: 20,
      checkInStats: {
        checkedIn: 5,
        checkInRate: 0.25,
        buckets: [
          {time: 1748822400000, count: 3},
          {time: 1748823300000, count: 2},
        ],
      },
    };

    beforeEach(async () => {
      await reloadManagementData(mockDataWithCheckIn);
      fixture.detectChanges();
    });

    it('should render checked-in count as checkedIn / soldCount', async () => {
      expect(await harness.getCheckedInCountText()).toContain('5 / 20');
    });

    it('should show correct percentage in the badge', async () => {
      expect(await harness.getCheckInPercentageText()).toBe('25%');
    });

    it('should show correct remaining count in not-yet-scanned message', async () => {
      expect(await harness.getCheckInNotScannedText()).toContain(
        '15 not yet scanned',
      );
    });

    it('should show chart card when buckets are non-empty', async () => {
      expect(await harness.isCheckInChartCardPresent()).toBe(true);
    });

    it('should hide chart card when buckets are empty', async () => {
      const mockDataNoBuckets: FullMockData = {
        ...mockDataWithCheckIn,
        checkInStats: {
          checkedIn: 0,
          checkInRate: 0,
          buckets: [],
        },
      };

      await reloadManagementData(mockDataNoBuckets);

      expect(await harness.isCheckInChartCardPresent()).toBe(false);
    });
  });

  describe('tier pricing stats', () => {
    it('should show pricing cards when stats exist and slidingScaleEnabled is false', async () => {
      await fixture.whenStable();

      expect(adminEventsServiceMock.getTierPricingStats).toHaveBeenCalledWith(
        eventId,
      );
      expect(await harness.getTierPricingCardCount()).toBe(2);
    });

    it('should not fetch pricing stats for regular-only flat events', async () => {
      const regularOnlyData = structuredClone(mockData);
      regularOnlyData.tierCounts = {
        regular: 3,
        notaflof: 0,
        supporter: 0,
      };
      regularOnlyData.revenueByTier = {
        regular: {grossCents: 5000, netCents: 4725, quantity: 2},
        notaflof: {grossCents: 0, netCents: 0, quantity: 0},
        supporter: {grossCents: 0, netCents: 0, quantity: 0},
      };

      adminEventsServiceMock.getTierPricingStats.mockClear();
      await reloadManagementData(regularOnlyData);
      await fixture.whenStable();

      expect(adminEventsServiceMock.getTierPricingStats).not.toHaveBeenCalled();
      expect(await harness.getTierPricingCardCount()).toBe(0);
    });

    it('should show pricing cards when slidingScaleEnabled is true', async () => {
      const mockDataWithSliding: FullMockData = {
        ...mockData,
        event: {
          ...mockData.event,
          slidingScaleEnabled: true,
          slidingScaleMin: 500,
          slidingScaleMax: 3000,
        },
      };

      await reloadManagementData(mockDataWithSliding);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.getTierPricingCardCount()).toBe(2);
    });

    it('should render correct stat values', async () => {
      const mockDataWithSliding: FullMockData = {
        ...mockData,
        event: {
          ...mockData.event,
          slidingScaleEnabled: true,
          slidingScaleMin: 500,
          slidingScaleMax: 3000,
        },
      };

      await reloadManagementData(mockDataWithSliding);
      await fixture.whenStable();
      fixture.detectChanges();

      const minTexts = await harness.getTierStatTexts('tier-stat-min');
      const maxTexts = await harness.getTierStatTexts('tier-stat-max');

      // Verify at least one card renders currency values
      expect(minTexts.length).toBeGreaterThan(0);
      expect(minTexts[0]).toContain('$');
      expect(maxTexts[0]).toContain('$');
    });

    it('should show no pricing cards when no tiers have data', async () => {
      tierPricingStatsData = {tiers: []};

      const mockDataWithSlidingNoSales: FullMockData = {
        ...mockData,
        event: {
          ...mockData.event,
          slidingScaleEnabled: true,
          slidingScaleMin: 500,
          slidingScaleMax: 3000,
        },
      };

      await reloadManagementData(mockDataWithSlidingNoSales);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.getTierPricingCardCount()).toBe(0);
    });

    it('should show a non-blocking alert and log once when pricing stats fail', async () => {
      const pricingError = new Error('pricing stats failed');
      const loggerErrorSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => undefined);
      adminEventsServiceMock.getTierPricingStats.mockRejectedValue(
        pricingError,
      );

      fixture.componentInstance.tierPricingStatsResource.reload();
      await fixture.whenStable().catch(() => undefined);
      fixture.detectChanges();

      expect(await harness.getTierPricingErrorText()).toContain(
        'Pricing cards are temporarily unavailable. Try refreshing the page.',
      );
      expect(await harness.getTierPricingCardCount()).toBe(0);

      fixture.detectChanges();
      await fixture.whenStable().catch(() => undefined);
      fixture.detectChanges();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to load tier pricing stats',
        pricingError,
      );
    });
  });

  describe('viewTicket', () => {
    const pdfDataUrl = 'data:application/pdf;base64,abc123';

    it('should open a new window and create an iframe via safe DOM API', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      const mockIframe = {src: '', style: {cssText: ''}, setAttribute: vi.fn()};
      const mockBody = {style: {margin: ''}, appendChild: vi.fn()};
      const mockWin = {
        document: {
          createElement: vi.fn().mockReturnValue(mockIframe),
          write: vi.fn(),
          body: mockBody,
          title: '',
        },
      };
      const openSpy = vi
        .spyOn(window, 'open')
        .mockReturnValue(mockWin as unknown as Window);

      await harness.clickViewTicketAction(purchaseId);
      await fixture.whenStable();

      expect(openSpy).toHaveBeenCalledWith('', '_blank');
      expect(mockWin.document.write).not.toHaveBeenCalled();
      expect(mockWin.document.createElement).toHaveBeenCalledWith('iframe');
      expect(mockIframe.src).toBe(pdfDataUrl);
      expect(mockIframe.setAttribute).toHaveBeenCalledWith(
        'allowfullscreen',
        '',
      );
      expect(mockBody.appendChild).toHaveBeenCalledWith(mockIframe);
      expect(mockWin.document.title).toBe('Ticket PDF');

      openSpy.mockRestore();
    });

    it('should toast an error when popup is blocked without replacing page content', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

      await harness.clickViewTicketAction(purchaseId);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('popup blocked'),
      );
      // PDF failures must NOT replace the management page content via errorMessage
      expect(fixture.componentInstance.errorMessage()).toBeNull();

      openSpy.mockRestore();
    });

    it('should toast an error when PDF generation fails without replacing page content', async () => {
      await harness.clickTab('buyers');
      fixture.detectChanges();
      await fixture.whenStable();

      adminEventsServiceMock.getTicketPdf.mockRejectedValue(
        new Error('PDF failed'),
      );

      await harness.clickViewTicketAction(purchaseId);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(toast.error).toHaveBeenCalledWith('failed to generate ticket pdf');
      expect(fixture.componentInstance.errorMessage()).toBeNull();
    });
  });
});

// ── Pure-function tests — no TestBed required ──────────────────────────────

describe('computePayoutStatus', () => {
  const baseEvent = {
    status: 'published' as const,
    date: '2025-01-10',
  };

  it('returns null when event is cancelled', () => {
    expect(computePayoutStatus({...baseEvent, status: 'cancelled'})).toBeNull();
  });

  it('returns {state: "paid"} with a Date when paidOutAt is set', () => {
    const paidOutAt = new Date(2025, 0, 15).getTime(); // Jan 15 2025
    const result = computePayoutStatus({...baseEvent, paidOutAt});
    expect(result).toEqual({state: 'paid', date: new Date(paidOutAt)});
  });

  it('returns {state: "pre-event"} when the current time is before the event date', () => {
    // Event is in the future relative to the injected `now`
    const futureEvent = {...baseEvent, date: '2030-06-15'};
    const now = new Date(2030, 5, 14); // June 14 2030 — one day before the event
    expect(computePayoutStatus(futureEvent, now)).toEqual({state: 'pre-event'});
  });

  it('returns {state: "pending"} when within 3 days after the event', () => {
    // Legacy date-only event date resolves to Jan 10 midnight in the event timezone.
    const now = new Date('2025-01-12T08:00:00.000Z');
    const result = computePayoutStatus({...baseEvent, date: '2025-01-10'}, now);
    expect(result).not.toBeNull();
    expect(result?.state).toBe('pending');
    if (result?.state === 'pending') {
      const expectedPayoutDate = new Date(
        new Date('2025-01-10T08:00:00.000Z').getTime() + 3 * 86400000,
      );
      expect(result.payoutDate).toEqual(expectedPayoutDate);
    }
  });

  it('returns {state: "processing"} when more than 3 days have passed since the event', () => {
    // Event date: Jan 10 2025; now: Jan 14 2025 — 4 days after
    const now = new Date(2025, 0, 14);
    expect(
      computePayoutStatus({...baseEvent, date: '2025-01-10'}, now),
    ).toEqual({
      state: 'processing',
    });
  });

  it('returns {state: "error"} for invalid event dates', () => {
    expect(
      computePayoutStatus({...baseEvent, date: '2025-02-31'}, new Date()),
    ).toEqual({state: 'error'});
  });

  it('returns {state: "error"} for a corrupt endDate rather than keying off the start', () => {
    // A valid past start with a malformed end must fail closed — surfacing an
    // error state, never a start-based "processing" that would release funds.
    const result = computePayoutStatus(
      {
        status: 'published',
        date: '2025-01-01T20:00:00.000Z',
        endDate: '2025-02-31T20:00:00.000Z',
      },
      new Date('2025-06-01T00:00:00.000Z'),
    );
    expect(result).toEqual({state: 'error'});
  });

  it('returns {state: "pending"} at the boundary (exactly 3 days have not elapsed yet)', () => {
    // Event: Jan 10 midnight; payoutDate: Jan 13 midnight; now: just before Jan 13 midnight
    const eventDate = new Date(2025, 0, 10);
    const justBeforePayoutDate = new Date(
      eventDate.getTime() + 3 * 86400000 - 1,
    );
    const result = computePayoutStatus(
      {...baseEvent, date: eventDate.toISOString()},
      justBeforePayoutDate,
    );
    expect(result?.state).toBe('pending');
  });

  it('returns {state: "processing"} exactly at the payout date boundary', () => {
    // now === payoutDate: the window has closed
    const eventDate = new Date(2025, 0, 10);
    const exactPayoutDate = new Date(eventDate.getTime() + 3 * 86400000);
    const result = computePayoutStatus(
      {...baseEvent, date: eventDate.toISOString()},
      exactPayoutDate,
    );
    expect(result?.state).toBe('processing');
  });

  it('keys the payout window off endDate for a running multi-day event', () => {
    const multiDay = {
      status: 'published' as const,
      date: '2025-01-01T20:00:00.000Z',
      endDate: '2025-01-08T20:00:00.000Z',
    };
    // Three days after the start but before the end: still pre-payout, even
    // though the naive start+delay window would already be "processing".
    expect(
      computePayoutStatus(multiDay, new Date('2025-01-04T20:00:00.000Z')),
    ).toEqual({state: 'pre-event'});
    // Four days after the end: the window has fully elapsed.
    expect(
      computePayoutStatus(multiDay, new Date('2025-01-12T20:00:00.000Z')),
    ).toEqual({state: 'processing'});
  });
});
