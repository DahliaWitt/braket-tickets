import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {SettlementExportService} from '@/features/admin/services/settlement-export.service';
import {summarizeSettlementRefunds} from '@/features/admin/services/settlement-export-data';
import {
  LOAD_PDF_EXPORT_DEPENDENCIES,
  type PdfExportDependencies,
} from '@/features/admin/services/pdf-export-loader.token';
import {
  type ResaleListing,
  type ResaleMetrics,
  type SettlementExportInput,
} from '../models/event-management.model';
import {type Id} from '@convex/_generated/dataModel';

describe('SettlementExportService', () => {
  let service: SettlementExportService;
  let mockPdfDependencies: PdfExportDependencies;

  const jsPDFMockedSave = vi.fn();
  const jsPDFMockedAddPage = vi.fn();
  const jsPDFMockedGetNumberOfPages = vi.fn(() => 1);
  let lastPdfDocument: MockJsPdfDocument | null = null;

  function rememberPdfDocument(document: MockJsPdfDocument): void {
    lastPdfDocument = document;
  }

  class MockJsPdfDocument {
    save = jsPDFMockedSave;
    addPage = jsPDFMockedAddPage;
    text = vi.fn().mockReturnThis();
    setFontSize = vi.fn().mockReturnThis();
    setTextColor = vi.fn().mockReturnThis();
    setFont = vi.fn().mockReturnThis();
    setDrawColor = vi.fn().mockReturnThis();
    setFillColor = vi.fn().mockReturnThis();
    setLineWidth = vi.fn().mockReturnThis();
    line = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    setPage = vi.fn().mockReturnThis();
    getNumberOfPages = jsPDFMockedGetNumberOfPages;
    lastAutoTable = {finalY: 100};
    internal = {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297,
      },
    };

    constructor() {
      rememberPdfDocument(this);
    }
  }

  const createMockData = (includeRefunds: boolean): SettlementExportInput => {
    const event: SettlementExportInput['event'] = {
      _id: 'event1' as Id<'events'>,
      title: 'Settlement Test Event',
      date: '2024-06-15T20:00:00Z',
      location: 'The Venue',
    };

    return {
      event,
      purchases: includeRefunds
        ? [
            {
              id: 'order1' as Id<'ticket_orders'>,
              userId: 'user1' as Id<'users'>,
              userName: 'Test User',
              userEmail: 'test@example.com',
              quantity: 2,
              amount: 2000,
              tier: 'regular' as const,
              status: 'completed' as const,
              createdAt: 12345678,
              tickets: [
                {
                  id: 't1' as Id<'tickets'>,
                  status: 'valid' as const,
                  tier: 'regular' as const,
                },
                {
                  id: 't2' as Id<'tickets'>,
                  status: 'valid' as const,
                  tier: 'regular' as const,
                },
              ],
            },
            {
              id: 'order2' as Id<'ticket_orders'>,
              userId: 'user2' as Id<'users'>,
              userName: 'Refund User',
              userEmail: 'refund@example.com',
              quantity: 1,
              amount: 1000,
              tier: 'regular' as const,
              status: 'refunded' as const,
              createdAt: 12345679,
              tickets: [
                {
                  id: 't3' as Id<'tickets'>,
                  status: 'refunded' as const,
                  tier: 'regular' as const,
                },
              ],
            },
          ]
        : [
            {
              id: 'order1' as Id<'ticket_orders'>,
              userId: 'user1' as Id<'users'>,
              userName: 'Test User',
              userEmail: 'test@example.com',
              quantity: 2,
              amount: 2000,
              tier: 'regular' as const,
              status: 'completed' as const,
              createdAt: 12345678,
              tickets: [
                {
                  id: 't1' as Id<'tickets'>,
                  status: 'valid' as const,
                  tier: 'regular' as const,
                },
                {
                  id: 't2' as Id<'tickets'>,
                  status: 'valid' as const,
                  tier: 'regular' as const,
                },
              ],
            },
          ],
      revenue: {
        grossCents: 3000,
        processingFeeCents: 100,
        platformFeeCents: 60,
        refundedCents: includeRefunds ? 1000 : 0,
        lostProcessingFeeCents: includeRefunds ? 59 : 0, // 2.9% + 30¢ on $10 refund
        netCents: includeRefunds ? 1781 : 2840, // 3000 - 100 - 60 - 1000 - 59 = 1781
      },
      revenueByTier: {
        regular: {grossCents: 2000, netCents: 1840, quantity: 10},
        notaflof: {grossCents: 0, netCents: 0, quantity: 0},
        supporter: {grossCents: 0, netCents: 0, quantity: 0},
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
  };

  beforeEach(() => {
    jsPDFMockedSave.mockReset();
    jsPDFMockedAddPage.mockReset();
    jsPDFMockedGetNumberOfPages.mockReset();
    jsPDFMockedGetNumberOfPages.mockReturnValue(1);
    lastPdfDocument = null;

    mockPdfDependencies = {
      jsPDF: MockJsPdfDocument as unknown as PdfExportDependencies['jsPDF'],
      autoTable: vi.fn().mockImplementation((doc: unknown) => {
        (doc as MockJsPdfDocument).lastAutoTable = {finalY: 100};
      }) as PdfExportDependencies['autoTable'],
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SettlementExportService,
        {
          provide: LOAD_PDF_EXPORT_DEPENDENCIES,
          useValue: vi.fn().mockResolvedValue(mockPdfDependencies),
        },
      ],
    });
    service = TestBed.inject(SettlementExportService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should generate a PDF and call save without throwing', async () => {
    const mockData = createMockData(false);
    await expect(service.export(mockData)).resolves.not.toThrow();
    expect(jsPDFMockedSave).toHaveBeenCalled();
    const filename = jsPDFMockedSave.mock.calls[0][0] as string;
    expect(filename).toContain('settlement-test-event-settlement-');
    expect(filename).toContain('.pdf');
  });

  it('formats the event date in the platform timezone in the PDF', async () => {
    const mockData = createMockData(false);
    mockData.event.date = '2026-02-27T07:30:00.000Z';

    await service.export(mockData);

    const textCalls = lastPdfDocument?.text.mock.calls ?? [];
    expect(textCalls).toContainEqual([
      'Date: Thursday, February 26, 2026',
      18,
      49,
    ]);
    expect(
      textCalls.some(([text]) => text === 'Date: Friday, February 27, 2026'),
    ).toBe(false);
  });

  it('prints Unknown instead of falling back to browser-local formatting for invalid event dates', async () => {
    const mockData = createMockData(false);
    mockData.event.date = '2026-02-31';

    await service.export(mockData);

    expect(lastPdfDocument?.text.mock.calls).toContainEqual([
      'Date: Unknown',
      18,
      49,
    ]);
  });

  it('should NOT add a second page when there are no refunds', async () => {
    const mockData = createMockData(false);
    jsPDFMockedAddPage.mockClear();
    await service.export(mockData);
    expect(jsPDFMockedAddPage).not.toHaveBeenCalled();
  });

  it('should add a refund appendix page when there are refunded purchases', async () => {
    const mockData = createMockData(true);
    jsPDFMockedAddPage.mockClear();
    jsPDFMockedGetNumberOfPages.mockReturnValue(2);
    await service.export(mockData);
    expect(jsPDFMockedAddPage).toHaveBeenCalledTimes(1);
  });

  it('should add a refund appendix page for partial refunds on completed purchases', async () => {
    const mockData = createMockData(false);
    mockData.purchases[0] = {
      ...mockData.purchases[0],
      refundedAmountCents: 1000,
      tickets: [
        {
          id: 't1' as Id<'tickets'>,
          status: 'valid' as const,
          tier: 'regular' as const,
        },
        {
          id: 't2' as Id<'tickets'>,
          status: 'refunded' as const,
          tier: 'regular' as const,
        },
      ],
    };
    mockData.revenue = {
      ...mockData.revenue,
      refundedCents: 1000,
      lostProcessingFeeCents: 59,
    };

    jsPDFMockedAddPage.mockClear();
    jsPDFMockedGetNumberOfPages.mockReturnValue(2);
    await service.export(mockData);

    expect(jsPDFMockedAddPage).toHaveBeenCalledTimes(1);
  });

  it('summarizes partial refunds using refundedAmountCents instead of full purchase amount', () => {
    const mockData = createMockData(false);
    const partialPurchase = {
      ...mockData.purchases[0],
      refundedAmountCents: 1000,
      tickets: [
        {
          id: 't1' as Id<'tickets'>,
          status: 'valid' as const,
          tier: 'regular' as const,
        },
        {
          id: 't2' as Id<'tickets'>,
          status: 'refunded' as const,
          tier: 'regular' as const,
        },
      ],
    };

    const summary = summarizeSettlementRefunds([partialPurchase]);

    expect(summary.hasRefunds).toBe(true);
    expect(summary.totalRefundedTickets).toBe(1);
    expect(summary.refundsByTier.regular).toEqual({
      quantity: 1,
      amountCents: 1000,
    });
  });

  describe('resale appendix', () => {
    const completedResaleListing: ResaleListing = {
      _id: 'rl1' as Id<'resale_listings'>,
      _creationTime: 1700000000000,
      ticketId: 'ticket1' as Id<'tickets'>,
      eventId: 'event1' as Id<'events'>,
      sellerId: 'seller1' as Id<'users'>,
      sellerName: 'Jane Seller',
      sellerEmail: 'jane@example.com',
      status: 'completed',
      buyerId: 'buyer1' as Id<'users'>,
      buyerName: 'Bob Buyer',
      completedAt: 1700000100000,
      resaleFeeCents: 105,
      sellerRefundAmountCents: 2395,
      lostProcessingFeeCents: 103,
    };

    const resaleMetricsWithCompleted: ResaleMetrics = {
      totalListings: 2,
      activeListings: 0,
      pendingListings: 0,
      completedResales: 1,
      cancelledListings: 1,
      totalRefundedToSellersCents: 2395,
      totalResaleFeesCents: 105,
      totalLostProcessingFeesCents: 103,
      notificationSubscribers: 3,
    };

    it('should NOT add a resale page when there are no completed resales', async () => {
      const mockData = createMockData(false);
      jsPDFMockedAddPage.mockClear();
      await service.export(mockData);
      expect(jsPDFMockedAddPage).not.toHaveBeenCalled();
    });

    it('should add a resale appendix page when completed resales exist', async () => {
      const mockData: SettlementExportInput = {
        ...createMockData(false),
        resaleMetrics: resaleMetricsWithCompleted,
        resaleListings: [completedResaleListing],
      };
      jsPDFMockedAddPage.mockClear();
      jsPDFMockedGetNumberOfPages.mockReturnValue(2);
      await service.export(mockData);
      expect(jsPDFMockedAddPage).toHaveBeenCalledTimes(1);
    });

    it('should add both refund and resale appendix pages', async () => {
      const mockData: SettlementExportInput = {
        ...createMockData(true),
        resaleMetrics: resaleMetricsWithCompleted,
        resaleListings: [completedResaleListing],
      };
      jsPDFMockedAddPage.mockClear();
      jsPDFMockedGetNumberOfPages.mockReturnValue(3);
      await service.export(mockData);
      // Page 2 = refund appendix, Page 3 = resale appendix
      expect(jsPDFMockedAddPage).toHaveBeenCalledTimes(2);
    });

    it('should generate without throwing when resale data is present', async () => {
      const mockData: SettlementExportInput = {
        ...createMockData(false),
        resaleMetrics: resaleMetricsWithCompleted,
        resaleListings: [completedResaleListing],
      };
      await expect(service.export(mockData)).resolves.not.toThrow();
      expect(jsPDFMockedSave).toHaveBeenCalled();
    });
  });
});
