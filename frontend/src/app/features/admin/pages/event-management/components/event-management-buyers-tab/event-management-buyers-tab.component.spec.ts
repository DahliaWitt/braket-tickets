import '../../../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CONVEX} from 'convex-angular';
import {logger} from '@/utils/logger';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {EventManagementBuyersTabComponent} from './event-management-buyers-tab.component';
import {EventManagementBuyersTabHarness} from './event-management-buyers-tab.component.harness';

describe('EventManagementBuyersTabComponent', () => {
  let fixture: ComponentFixture<EventManagementBuyersTabComponent>;
  let harness: EventManagementBuyersTabHarness;
  let convexMock: MockConvexClient;
  let adminEventsServiceMock: {
    importTicketBatch: ReturnType<typeof vi.fn>;
    removeImportedEntry: ReturnType<typeof vi.fn>;
    removeImportedBatch: ReturnType<typeof vi.fn>;
    sendTicketPurchaseReminder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    convexMock = createMockConvexClient();
    const onUpdate = vi.fn(
      (_query: unknown, _args: unknown, onData: (v: unknown) => void) => {
        onData({recipientCount: 0, missingOrganizer: false});
        return () => undefined;
      },
    );
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;
    convexMock.query = vi
      .fn()
      .mockResolvedValue({recipientCount: 0, missingOrganizer: false});

    adminEventsServiceMock = {
      importTicketBatch: vi.fn().mockResolvedValue({
        insertedCount: 1,
        skippedCount: 0,
        outcomes: [{rowIndex: 0, status: 'inserted'}],
      }),
      removeImportedEntry: vi.fn().mockResolvedValue(undefined),
      removeImportedBatch: vi
        .fn()
        .mockResolvedValue({removedCount: 1, checkedInCount: 0}),
      sendTicketPurchaseReminder: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [EventManagementBuyersTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {provide: BraDialogService, useValue: {create: vi.fn()}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventManagementBuyersTabComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('eventTitle', 'Warehouse Night');
    fixture.componentRef.setInput('eventDate', '2026-07-06T20:00:00.000Z');
    fixture.componentRef.setInput('purchases', []);
    fixture.componentRef.setInput('guests', []);
    fixture.componentRef.setInput('importedEntries', []);
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventManagementBuyersTabHarness,
    );
  });

  it('imports external tickets with dedupMode, sourceLabel, and batchKey', async () => {
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickImportButton();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isImportPanelOpen()).toBe(true);
    const surface = await harness.getImportSurfaceHarness();
    expect(surface).not.toBeNull();

    // Paste an RA-style two-column list (Billing name maps to name; Barcode
    // maps to the external reference).
    await surface!.pasteText('Billing name\tBarcode\nZoe Example\tRA-0001');
    await surface!.clickNext();
    fixture.detectChanges();
    await fixture.whenStable();

    // Buyer target offers the dedup toggle and a source label.
    expect(await surface!.hasDedupToggle()).toBe(true);
    await surface!.setSourceLabel('RA');
    fixture.detectChanges();
    await fixture.whenStable();

    await surface!.clickConfirm();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(adminEventsServiceMock.importTicketBatch).toHaveBeenCalledTimes(1);
    const [eventId, batchKey, dedupMode, rows, sourceLabel] =
      adminEventsServiceMock.importTicketBatch.mock.calls[0] as [
        string,
        string,
        string,
        unknown,
        string,
      ];
    expect(eventId).toBe('event-1');
    expect(typeof batchKey).toBe('string');
    expect(batchKey.length).toBeGreaterThan(0);
    expect(dedupMode).toBe('skip');
    expect(sourceLabel).toBe('RA');
    expect(rows).toEqual([
      {
        name: 'Zoe Example',
        email: undefined,
        externalRef: 'RA-0001',
        orderRef: undefined,
        ticketTypeLabel: undefined,
        purchaseDateRaw: undefined,
      },
    ]);

    expect(await surface!.getReportInsertedText()).toContain('1 added');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('passes include dedup mode when the admin toggles it', async () => {
    await harness.clickImportButton();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const surface = await harness.getImportSurfaceHarness();
    await surface!.pasteText('Billing name\tBarcode\nZoe Example\tRA-0001');
    await surface!.clickNext();
    fixture.detectChanges();
    await fixture.whenStable();

    await surface!.toggleDedup();
    fixture.detectChanges();
    await fixture.whenStable();

    await surface!.clickConfirm();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const [, , dedupMode] = adminEventsServiceMock.importTicketBatch.mock
      .calls[0] as [string, string, string, unknown, string];
    expect(dedupMode).toBe('include');
  });

  it('feeds imported barcodes into the preview as auto-skip duplicates', async () => {
    fixture.componentRef.setInput('importedEntries', [
      {
        _id: 'imp-1',
        _creationTime: 0,
        eventId: 'event-1',
        name: 'Prior Holder',
        externalRef: 'RA-0001',
        sourceLabel: 'RA',
        batchKey: 'batch-0',
      },
    ]);
    fixture.detectChanges();

    await harness.clickImportButton();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const surface = await harness.getImportSurfaceHarness();
    await surface!.pasteText('Billing name\tBarcode\nZoe Example\tRA-0001');
    await surface!.clickNext();
    fixture.detectChanges();
    await fixture.whenStable();

    // Same barcode as a prior import → duplicate partition in skip mode.
    expect(await surface!.getRowCountByPartition('duplicate')).toBe(1);
  });
});
