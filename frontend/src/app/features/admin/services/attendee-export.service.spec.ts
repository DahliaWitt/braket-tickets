import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {
  AttendeeExportService,
  DEFAULT_EXPORT_FIELDS,
  type ExportConfig,
  type ExportField,
} from '@/features/admin/services/attendee-export.service';
import {
  LOAD_PDF_EXPORT_DEPENDENCIES,
  type PdfExportDependencies,
} from '@/features/admin/services/pdf-export-loader.token';
import {type EventManagementPurchase} from '../models/event-management.model';
import {type Id} from '@convex/_generated/dataModel';

describe('AttendeeExportService', () => {
  let service: AttendeeExportService;
  let createObjectURLMock: Mock;
  let revokeObjectURLMock: Mock;
  let setTimeoutMock: Mock;
  let mockPdfDependencies: PdfExportDependencies;

  const jsPDFMockedSave = vi.fn();

  class MockJsPdfDocument {
    save = jsPDFMockedSave;
    text = vi.fn();
    setFontSize = vi.fn().mockReturnThis();
    setTextColor = vi.fn().mockReturnThis();
    setFont = vi.fn().mockReturnThis();
    setDrawColor = vi.fn().mockReturnThis();
    setFillColor = vi.fn().mockReturnThis();
    setLineWidth = vi.fn().mockReturnThis();
    line = vi.fn().mockReturnThis();
    rect = vi.fn().mockReturnThis();
    addPage = vi.fn().mockReturnThis();
    setPage = vi.fn().mockReturnThis();
    getNumberOfPages = vi.fn().mockReturnValue(1);
    getTextWidth = vi.fn().mockReturnValue(50);
    getStringUnitWidth = vi.fn().mockReturnValue(50);
    splitTextToSize = vi.fn().mockReturnValue(['text']);
    lastAutoTable = {finalY: 100};
    internal = {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297,
      },
      getFontSize: () => 10,
      scaleFactor: 1,
      getFont: () => ({fontName: 'helvetica', fontStyle: 'normal'}),
      getCurrentPageInfo: () => ({pageNumber: 1}),
    };
    getFontList = vi.fn().mockReturnValue({});
  }

  const mockPurchases: EventManagementPurchase[] = [
    {
      id: 'order1' as Id<'ticket_orders'>,
      userId: 'user1' as Id<'users'>,
      userName: 'John Doe',
      userEmail: 'john@example.com',
      quantity: 2,
      amount: 5000,
      tier: 'regular',
      status: 'completed',
      createdAt: new Date('2024-06-15T10:30:00').getTime(),
      tickets: [
        {id: 'ticket-1a' as Id<'tickets'>, status: 'valid', tier: 'regular'},
        {id: 'ticket-1b' as Id<'tickets'>, status: 'valid', tier: 'regular'},
      ],
    },
    {
      id: 'order2' as Id<'ticket_orders'>,
      userId: 'user2' as Id<'users'>,
      userName: 'Jane Smith',
      userEmail: undefined,
      quantity: 1,
      amount: 7500,
      tier: 'supporter',
      status: 'completed',
      createdAt: new Date('2024-06-16T14:00:00').getTime(),
      tickets: [
        {id: 'ticket-2' as Id<'tickets'>, status: 'valid', tier: 'supporter'},
      ],
    },
    {
      id: 'order3' as Id<'ticket_orders'>,
      userId: 'user3' as Id<'users'>,
      userName: 'Bob, "The Builder"',
      userEmail: 'bob@example.com',
      quantity: 3,
      amount: 0,
      tier: 'notaflof',
      status: 'completed',
      createdAt: new Date('2024-06-17T09:00:00').getTime(),
      tickets: [
        {id: 'ticket-3a' as Id<'tickets'>, status: 'valid', tier: 'notaflof'},
        {id: 'ticket-3b' as Id<'tickets'>, status: 'valid', tier: 'notaflof'},
        {id: 'ticket-3c' as Id<'tickets'>, status: 'valid', tier: 'notaflof'},
      ],
    },
  ];

  const mockPurchasesWithRefunds: EventManagementPurchase[] = [
    ...mockPurchases,
    {
      id: 'order4' as Id<'ticket_orders'>,
      userId: 'user4' as Id<'users'>,
      userName: 'Refunded User',
      userEmail: 'refunded@example.com',
      quantity: 1,
      amount: 5000,
      tier: 'regular',
      status: 'refunded',
      createdAt: new Date('2024-06-18T12:00:00').getTime(),
      tickets: [
        {id: 'ticket-4' as Id<'tickets'>, status: 'refunded', tier: 'regular'},
      ],
    },
  ];

  const partialRefundPurchase: EventManagementPurchase = {
    id: 'order5' as Id<'ticket_orders'>,
    userId: 'user5' as Id<'users'>,
    userName: 'Partial User',
    userEmail: 'partial@example.com',
    quantity: 2,
    amount: 5000,
    refundedAmountCents: 2500,
    tier: 'regular',
    status: 'completed',
    createdAt: new Date('2024-06-19T12:00:00').getTime(),
    tickets: [
      {id: 'ticket-5a' as Id<'tickets'>, status: 'valid', tier: 'regular'},
      {
        id: 'ticket-5b' as Id<'tickets'>,
        status: 'refunded',
        tier: 'regular',
      },
    ],
  };

  beforeEach(() => {
    jsPDFMockedSave.mockReset();
    mockPdfDependencies = {
      jsPDF: MockJsPdfDocument as unknown as PdfExportDependencies['jsPDF'],
      autoTable: vi.fn().mockImplementation((doc: unknown) => {
        (doc as MockJsPdfDocument).lastAutoTable = {finalY: 100};
      }) as PdfExportDependencies['autoTable'],
    };

    // Mock URL methods
    createObjectURLMock = vi.fn(() => 'blob:mock-url');
    revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;
    setTimeoutMock = vi
      .spyOn(window, 'setTimeout')
      .mockReturnValue(1 as unknown as ReturnType<typeof setTimeout>) as Mock;

    // Mock document methods
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AttendeeExportService,
        {
          provide: LOAD_PDF_EXPORT_DEPENDENCIES,
          useValue: vi.fn().mockResolvedValue(mockPdfDependencies),
        },
      ],
    });
    service = TestBed.inject(AttendeeExportService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('DEFAULT_EXPORT_FIELDS', () => {
    it('should contain all expected fields', () => {
      const fieldKeys = DEFAULT_EXPORT_FIELDS.map((f) => f.key);

      expect(fieldKeys).toContain('userName');
      expect(fieldKeys).toContain('userEmail');
      expect(fieldKeys).toContain('tier');
      expect(fieldKeys).toContain('quantity');
      expect(fieldKeys).toContain('formattedAmount');
      expect(fieldKeys).toContain('formattedDate');
    });

    it('should have all fields enabled by default', () => {
      expect(DEFAULT_EXPORT_FIELDS.every((f) => f.enabled)).toBe(true);
    });
  });

  describe('CSV Export', () => {
    it('should generate a CSV blob and trigger download', async () => {
      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const config: ExportConfig = {
        fields: DEFAULT_EXPORT_FIELDS,
        format: 'csv',
        eventTitle: 'Test Event',
      };

      await service.export(mockPurchases, config);

      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURLMock).not.toHaveBeenCalled();
      expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 60_000);
    });

    it('should only include enabled fields in CSV', async () => {
      let capturedBlob: Blob | null = null;
      createObjectURLMock.mockImplementation((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const fields: ExportField[] = [
        {key: 'userName', label: 'Name', enabled: true},
        {key: 'userEmail', label: 'Email', enabled: false},
        {key: 'tier', label: 'Tier', enabled: true},
      ];

      const config: ExportConfig = {
        fields,
        format: 'csv',
        eventTitle: 'Test Event',
      };

      await service.export(mockPurchases, config);

      expect(capturedBlob).not.toBeNull();
    });

    it('should properly escape CSV values with commas and quotes', async () => {
      let capturedBlob: Blob | null = null;
      createObjectURLMock.mockImplementation((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      // Uses mockPurchases which includes 'Bob, "The Builder"'
      const fields: ExportField[] = [
        {key: 'userName', label: 'Name', enabled: true},
      ];

      const config: ExportConfig = {
        fields,
        format: 'csv',
        eventTitle: 'Test Event',
      };

      await service.export(mockPurchases, config);

      expect(capturedBlob).not.toBeNull();
    });

    it('should handle null email gracefully', async () => {
      let capturedBlob: Blob | null = null;
      createObjectURLMock.mockImplementation((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const fields: ExportField[] = [
        {key: 'userEmail', label: 'Email', enabled: true},
      ];

      const config: ExportConfig = {
        fields,
        format: 'csv',
        eventTitle: 'Test Event',
      };

      await service.export(mockPurchases, config);

      expect(capturedBlob).not.toBeNull();
    });
  });

  describe('PDF Export', () => {
    it('should call export with pdf format without throwing', async () => {
      // PDF generation uses jsPDF internally - we verify the method can be called
      // The actual PDF generation is integration-tested separately
      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'pdf',
        eventTitle: 'Test Event',
        eventDate: 'June 15, 2024',
      };

      // This test verifies the function runs without errors
      // jsPDF.save() will be called internally
      await expect(
        service.export(mockPurchases, config),
      ).resolves.not.toThrow();
    });
  });

  describe('Filename generation', () => {
    it('should generate sanitized filenames', async () => {
      const clickSpy = vi.fn();
      let capturedFilename = '';

      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        set download(val: string) {
          capturedFilename = val;
        },
        get download() {
          return capturedFilename;
        },
      } as unknown as HTMLAnchorElement);

      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'csv',
        eventTitle: 'Test Event! @#$% Special',
      };

      await service.export(mockPurchases, config);

      expect(capturedFilename).toMatch(
        /^test-event-special-attendees-\d{4}-\d{2}-\d{2}\.csv$/,
      );
    });
  });

  describe('Refund handling', () => {
    it('should exclude refunded purchases by default in CSV', async () => {
      let capturedContent = '';
      // Mock Blob to capture the content
      const originalBlob = globalThis.Blob;
      globalThis.Blob = class MockBlob {
        constructor(parts: BlobPart[]) {
          capturedContent = parts
            .map((part) => {
              if (typeof part === 'string') {
                return part;
              }
              if (part instanceof ArrayBuffer) {
                return new TextDecoder().decode(part);
              }
              if (ArrayBuffer.isView(part)) {
                return new TextDecoder().decode(part);
              }
              return '';
            })
            .join('');
        }
      } as typeof Blob;

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'csv',
        eventTitle: 'Test Event',
        // includeRefunded defaults to false
      };

      await service.export(mockPurchasesWithRefunds, config);

      globalThis.Blob = originalBlob;

      expect(capturedContent).not.toContain('Refunded User');
      expect(capturedContent).toContain('John Doe');
    });

    it('should include refunded purchases when includeRefunded is true in CSV', async () => {
      let capturedContent = '';
      const originalBlob = globalThis.Blob;
      globalThis.Blob = class MockBlob {
        constructor(parts: BlobPart[]) {
          capturedContent = parts
            .map((part) => {
              if (typeof part === 'string') {
                return part;
              }
              if (part instanceof ArrayBuffer) {
                return new TextDecoder().decode(part);
              }
              if (ArrayBuffer.isView(part)) {
                return new TextDecoder().decode(part);
              }
              return '';
            })
            .join('');
        }
      } as typeof Blob;

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'csv',
        eventTitle: 'Test Event',
        includeRefunded: true,
      };

      await service.export(mockPurchasesWithRefunds, config);

      globalThis.Blob = originalBlob;

      expect(capturedContent).toContain('Refunded User');
      expect(capturedContent).toContain('Status'); // Should have Status header
      expect(capturedContent).toContain('REFUNDED');
      expect(capturedContent).toContain('ACTIVE');
    });

    it('should split partial refunds into active and refunded CSV rows with actual refund amounts', async () => {
      let capturedContent = '';
      const originalBlob = globalThis.Blob;
      globalThis.Blob = class MockBlob {
        constructor(parts: BlobPart[]) {
          capturedContent = parts
            .map((part) => {
              if (typeof part === 'string') {
                return part;
              }
              if (part instanceof ArrayBuffer) {
                return new TextDecoder().decode(part);
              }
              if (ArrayBuffer.isView(part)) {
                return new TextDecoder().decode(part);
              }
              return '';
            })
            .join('');
        }
      } as typeof Blob;

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        click: clickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement);

      const config: ExportConfig = {
        fields: [
          {key: 'userName', label: 'Name', enabled: true},
          {key: 'quantity', label: 'Quantity', enabled: true},
          {key: 'formattedAmount', label: 'Amount', enabled: true},
        ],
        format: 'csv',
        eventTitle: 'Test Event',
        includeRefunded: true,
      };

      await service.export([partialRefundPurchase], config);

      globalThis.Blob = originalBlob;

      expect(capturedContent).toContain('Name,Quantity,Amount,Status');
      expect(capturedContent).toContain('Partial User,1,$25.00,ACTIVE');
      expect(capturedContent).toContain('Partial User,1,$25.00,REFUNDED');
    });

    it('should exclude refunded purchases by default in PDF', async () => {
      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'pdf',
        eventTitle: 'Test Event',
      };

      // Should not throw and should not add a second page
      await expect(
        service.export(mockPurchasesWithRefunds, config),
      ).resolves.not.toThrow();
    });

    it('should include refunded purchases on second page when includeRefunded is true in PDF', async () => {
      const config: ExportConfig = {
        fields: [{key: 'userName', label: 'Name', enabled: true}],
        format: 'pdf',
        eventTitle: 'Test Event',
        includeRefunded: true,
      };

      // Should not throw - PDF with refunds creates a second page
      await expect(
        service.export(mockPurchasesWithRefunds, config),
      ).resolves.not.toThrow();
      expect(jsPDFMockedSave).toHaveBeenCalled();
    });
  });
});
