import '../../../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {type Id} from '@convex/_generated/dataModel';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {type ImportedTicketHolder} from '@/features/admin/models/event-management.model';
import {EventManagementPurchasesPanelComponent} from './event-management-purchases-panel.component';
import {EventManagementPurchasesPanelHarness} from './event-management-purchases-panel.component.harness';

/** Minimal shape of the alert-dialog confirm options this panel passes. */
interface ConfirmDialogOptions {
  zTitle: string;
  zDescription: string;
  zOkDestructive?: boolean;
  zOnOk: () => void | Promise<void>;
}

function entry(overrides: {
  _id: string;
  batchKey: string;
  name?: string;
  sourceLabel?: string;
  externalRef?: string;
  email?: string;
  checkedInAt?: number;
}): ImportedTicketHolder {
  return {
    _id: overrides._id as Id<'importedTicketHolders'>,
    _creationTime: 0,
    eventId: 'event-1' as Id<'events'>,
    name: overrides.name ?? 'External Holder',
    sourceLabel: overrides.sourceLabel ?? 'RA',
    batchKey: overrides.batchKey,
    ...(overrides.externalRef !== undefined
      ? {externalRef: overrides.externalRef}
      : {}),
    ...(overrides.email !== undefined ? {email: overrides.email} : {}),
    ...(overrides.checkedInAt !== undefined
      ? {checkedInAt: overrides.checkedInAt}
      : {}),
  };
}

describe('EventManagementPurchasesPanelComponent — imported entries', () => {
  let fixture: ComponentFixture<EventManagementPurchasesPanelComponent>;
  let harness: EventManagementPurchasesPanelHarness;
  let adminEventsServiceMock: {
    removeImportedEntry: ReturnType<typeof vi.fn>;
    removeImportedBatch: ReturnType<typeof vi.fn>;
  };
  let alertDialogMock: {confirm: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    adminEventsServiceMock = {
      removeImportedEntry: vi.fn().mockResolvedValue(undefined),
      removeImportedBatch: vi
        .fn()
        .mockResolvedValue({removedCount: 2, checkedInCount: 1}),
    };
    alertDialogMock = {confirm: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [EventManagementPurchasesPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {provide: BraAlertDialogService, useValue: alertDialogMock},
        {provide: BraDialogService, useValue: {create: vi.fn()}},
        {provide: BrowserPlatformService, useValue: {downloadBlob: vi.fn()}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventManagementPurchasesPanelComponent);
    fixture.componentRef.setInput('eventTitle', 'Warehouse Night');
    fixture.componentRef.setInput('eventDate', '2026-07-06T20:00:00.000Z');
    fixture.componentRef.setInput('purchases', []);
    fixture.componentRef.setInput('guests', []);
    fixture.componentRef.setInput('importedEntries', []);
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventManagementPurchasesPanelHarness,
    );
  });

  it('renders imported entries grouped by batch with a source badge', async () => {
    fixture.componentRef.setInput('importedEntries', [
      entry({
        _id: 'imp-1',
        batchKey: 'batch-a',
        name: 'Zoe',
        sourceLabel: 'RA',
      }),
      entry({
        _id: 'imp-2',
        batchKey: 'batch-a',
        name: 'Sam',
        sourceLabel: 'RA',
      }),
      entry({
        _id: 'imp-3',
        batchKey: 'batch-b',
        name: 'Kai',
        sourceLabel: 'dice',
      }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isImportedSectionVisible()).toBe(true);
    expect(await harness.getImportedBatchCount()).toBe(2);
    expect(await harness.getImportedRowCount()).toBe(3);
    // One source badge per batch, showing that batch's source label.
    expect(new Set(await harness.getSourceBadgeTexts())).toEqual(
      new Set(['RA', 'dice']),
    );
  });

  it('is hidden when there are no imported entries', async () => {
    expect(await harness.isImportedSectionVisible()).toBe(false);
  });

  it('removes a single imported entry and refreshes', async () => {
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);
    fixture.componentRef.setInput('importedEntries', [
      entry({_id: 'imp-1', batchKey: 'batch-a', name: 'Zoe'}),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickRemoveImportedEntry('imp-1');
    await fixture.whenStable();

    expect(adminEventsServiceMock.removeImportedEntry).toHaveBeenCalledWith(
      'imp-1',
    );
    expect(toast.success).toHaveBeenCalledWith('external ticket removed');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('warns with the checked-in count before removing a batch', async () => {
    fixture.componentRef.setInput('importedEntries', [
      entry({
        _id: 'imp-1',
        batchKey: 'batch-a',
        name: 'Zoe',
        checkedInAt: 1_700_000_000_000,
      }),
      entry({_id: 'imp-2', batchKey: 'batch-a', name: 'Sam'}),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickRemoveImportedBatch('batch-a');

    expect(alertDialogMock.confirm).toHaveBeenCalledTimes(1);
    const [config] = alertDialogMock.confirm.mock.calls[0] as [
      ConfirmDialogOptions,
    ];
    // The warning surfaces the 1 checked-in entry so the organizer knows the
    // door count will drop.
    expect(config.zDescription).toContain('1');
    expect(config.zDescription).toContain('checked in');
    expect(config.zOkDestructive).toBe(true);
  });

  it('removes the whole batch when the warning is confirmed', async () => {
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);
    fixture.componentRef.setInput('importedEntries', [
      entry({_id: 'imp-1', batchKey: 'batch-a', name: 'Zoe'}),
      entry({_id: 'imp-2', batchKey: 'batch-a', name: 'Sam'}),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickRemoveImportedBatch('batch-a');
    // Invoke the confirm callback the dialog would have run on OK.
    const [config] = alertDialogMock.confirm.mock.calls[0] as [
      ConfirmDialogOptions,
    ];
    await config.zOnOk();
    await fixture.whenStable();

    expect(adminEventsServiceMock.removeImportedBatch).toHaveBeenCalledWith(
      'event-1',
      'batch-a',
    );
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });
});
