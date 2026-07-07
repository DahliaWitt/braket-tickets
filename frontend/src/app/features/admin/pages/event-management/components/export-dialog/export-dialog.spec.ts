import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {
  ExportDialogComponent,
  type ExportDialogData,
} from './export-dialog.component';
import {ExportDialogHarness} from './export-dialog.harness';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {
  AttendeeExportService,
  DEFAULT_EXPORT_FIELDS,
} from '@/features/admin/services/attendee-export.service';
import {type Id} from '@convex/_generated/dataModel';

describe('ExportDialogComponent', () => {
  let fixture: ComponentFixture<ExportDialogComponent>;
  let harness: ExportDialogHarness;
  let dialogRefMock: {close: ReturnType<typeof vi.fn>};
  let exportServiceMock: {export: ReturnType<typeof vi.fn>};

  const mockDialogData: ExportDialogData = {
    purchases: [
      {
        id: 'order1' as Id<'ticket_orders'>,
        userId: 'user1' as Id<'users'>,
        userName: 'John Doe',
        userEmail: 'john@example.com',
        quantity: 2,
        amount: 5000,
        tier: 'regular',
        status: 'completed',
        createdAt: Date.now(),
        tickets: [
          {
            id: 'ticket1' as Id<'tickets'>,
            status: 'valid',
            tier: 'regular',
          },
        ],
      },
    ],
    eventTitle: 'Test Concert',
    eventDate: 'June 15, 2024',
  };

  beforeEach(async () => {
    dialogRefMock = {close: vi.fn()};
    exportServiceMock = {export: vi.fn().mockResolvedValue(undefined)};

    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDialogRef, useValue: dialogRefMock},
        {provide: BRA_MODAL_DATA, useValue: mockDialogData},
        {provide: AttendeeExportService, useValue: exportServiceMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExportDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ExportDialogHarness,
    );
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display all export field checkboxes', async () => {
    expect(await harness.getCheckboxCount()).toBe(DEFAULT_EXPORT_FIELDS.length);
  });

  it('should display field labels', async () => {
    expect(await harness.getFieldLabels()).toEqual(
      expect.arrayContaining([
        'Name',
        'Email',
        'Tier',
        'Quantity',
        'Amount',
        'Purchase Date',
      ]),
    );
  });

  it('should close dialog when cancel is clicked', async () => {
    await harness.clickCancel();

    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  it('should export CSV and close dialog when export is clicked', async () => {
    await harness.selectCsvFormat();

    await harness.clickExport();

    expect(exportServiceMock.export).toHaveBeenCalledWith(
      mockDialogData.purchases,
      expect.objectContaining({
        format: 'csv',
        eventTitle: 'Test Concert',
        eventDate: 'June 15, 2024',
      }),
      mockDialogData.guests,
      mockDialogData.importedEntries,
    );
    expect(dialogRefMock.close).toHaveBeenCalledWith({exported: true});
  });

  it('should export PDF when PDF format is selected', async () => {
    await harness.selectPdfFormat();
    fixture.detectChanges();

    await harness.clickExport();

    expect(exportServiceMock.export).toHaveBeenCalledWith(
      mockDialogData.purchases,
      expect.objectContaining({
        format: 'pdf',
      }),
      mockDialogData.guests,
      mockDialogData.importedEntries,
    );
  });

  it('should toggle field selection', () => {
    const component = fixture.componentInstance;

    // Initially all fields are enabled
    expect(component.fields().every((f) => f.enabled)).toBe(true);

    // Toggle one field off
    component.toggleField('userName', false);

    const userNameField = component.fields().find((f) => f.key === 'userName');
    expect(userNameField?.enabled).toBe(false);
  });

  it('should report no selected fields when all are disabled', () => {
    const component = fixture.componentInstance;

    // Disable all fields
    for (const field of DEFAULT_EXPORT_FIELDS) {
      component.toggleField(field.key, false);
    }

    expect(component.hasSelectedFields()).toBe(false);
  });

  it('should show refunded export options for partially refunded purchases', async () => {
    const partialRefundData: ExportDialogData = {
      ...mockDialogData,
      purchases: [
        {
          ...mockDialogData.purchases[0],
          refundedAmountCents: 2500,
          tickets: [
            {
              id: 'ticket1' as Id<'tickets'>,
              status: 'valid',
              tier: 'regular',
            },
            {
              id: 'ticket2' as Id<'tickets'>,
              status: 'refunded',
              tier: 'regular',
            },
          ],
        },
      ],
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: BraDialogRef, useValue: dialogRefMock},
        {provide: BRA_MODAL_DATA, useValue: partialRefundData},
        {provide: AttendeeExportService, useValue: exportServiceMock},
      ],
    }).compileComponents();

    const partialFixture = TestBed.createComponent(ExportDialogComponent);
    partialFixture.detectChanges();
    await partialFixture.whenStable();
    const partialHarness = await TestbedHarnessEnvironment.harnessForFixture(
      partialFixture,
      ExportDialogHarness,
    );

    expect(partialFixture.componentInstance.hasRefundedPurchases()).toBe(true);
    expect(await partialHarness.getFieldLabels()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Include refunded tickets') as string,
      ]),
    );
  });
});
