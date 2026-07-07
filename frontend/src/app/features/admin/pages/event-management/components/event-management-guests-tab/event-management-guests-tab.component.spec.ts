import '../../../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {of} from 'rxjs';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {EventManagementGuestsTabComponent} from './event-management-guests-tab.component';
import {EventManagementGuestsTabHarness} from './event-management-guests-tab.component.harness';

describe('EventManagementGuestsTabComponent', () => {
  let fixture: ComponentFixture<EventManagementGuestsTabComponent>;
  let harness: EventManagementGuestsTabHarness;
  let adminEventsServiceMock: {
    addGuest: ReturnType<typeof vi.fn>;
    bulkAddGuests: ReturnType<typeof vi.fn>;
    removeGuest: ReturnType<typeof vi.fn>;
    sendGuestTicket: ReturnType<typeof vi.fn>;
    getGuestTicketPdf: ReturnType<typeof vi.fn>;
  };
  let dialogServiceMock: {
    create: ReturnType<typeof vi.fn>;
  };
  let browserPlatformMock: {
    downloadBlob: ReturnType<typeof vi.fn>;
  };

  const addGuestResult = {
    name: 'Pat Guest',
    email: 'pat@example.com',
    type: 'guest' as const,
    notes: 'Backstage',
  };
  const mockGuest = {
    _id: 'guest-1',
    _creationTime: 0,
    eventId: 'event-1',
    name: addGuestResult.name,
    email: addGuestResult.email,
    type: addGuestResult.type,
    notes: addGuestResult.notes,
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '' as string & number);
    vi.spyOn(toast, 'error').mockImplementation(() => '' as string & number);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    adminEventsServiceMock = {
      addGuest: vi.fn().mockResolvedValue('guest-1'),
      bulkAddGuests: vi.fn().mockResolvedValue({
        insertedCount: 1,
        skippedCount: 0,
        outcomes: [{rowIndex: 0, status: 'inserted'}],
      }),
      removeGuest: vi.fn().mockResolvedValue(undefined),
      sendGuestTicket: vi.fn().mockResolvedValue(undefined),
      getGuestTicketPdf: vi
        .fn()
        .mockResolvedValue('data:application/pdf;base64,JVBERg=='),
    };
    dialogServiceMock = {
      create: vi.fn(),
    };
    browserPlatformMock = {
      downloadBlob: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [EventManagementGuestsTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminEventsService, useValue: adminEventsServiceMock},
        {provide: BraDialogService, useValue: dialogServiceMock},
        {provide: BrowserPlatformService, useValue: browserPlatformMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventManagementGuestsTabComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('guests', []);
    fixture.componentRef.setInput('isLoading', false);
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventManagementGuestsTabHarness,
    );
  });

  it('shows a success toast and refreshes after adding a guest from the dialog', async () => {
    dialogServiceMock.create.mockReturnValue({
      afterClosed$: of(addGuestResult),
    });
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickAddGuestButton();
    await fixture.whenStable();

    expect(dialogServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Add Guest',
        zData: {eventId: 'event-1'},
      }),
    );
    expect(adminEventsServiceMock.addGuest).toHaveBeenCalledWith(
      'event-1',
      addGuestResult,
    );
    expect(toast.success).toHaveBeenCalledWith('Guest added');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast and does not refresh when adding a guest fails', async () => {
    adminEventsServiceMock.addGuest.mockRejectedValue(new Error('boom'));
    dialogServiceMock.create.mockReturnValue({
      afterClosed$: of(addGuestResult),
    });
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickAddGuestButton();
    await fixture.whenStable();

    expect(toast.error).toHaveBeenCalledWith('Failed to add guest');
    expect(dataChangedSpy).not.toHaveBeenCalled();
  });

  it('uses row-specific accessible names for guest actions', async () => {
    fixture.componentRef.setInput('guests', [
      mockGuest,
      {
        ...mockGuest,
        _id: 'guest-2',
        name: 'Riley Staff',
        email: 'riley@example.com',
        type: 'staff' as const,
      },
    ]);
    fixture.detectChanges();

    expect(new Set(await harness.getDownloadButtonAriaLabels())).toEqual(
      new Set([
        'Download ticket for Pat Guest, pat@example.com, guest, id GUEST-1',
        'Download ticket for Riley Staff, riley@example.com, staff, id GUEST-2',
      ]),
    );
    expect(new Set(await harness.getSendButtonAriaLabels())).toEqual(
      new Set([
        'Send ticket to Pat Guest, pat@example.com, guest, id GUEST-1',
        'Send ticket to Riley Staff, riley@example.com, staff, id GUEST-2',
      ]),
    );
    expect(new Set(await harness.getRemoveButtonAriaLabels())).toEqual(
      new Set([
        'Remove Pat Guest, pat@example.com, guest, id GUEST-1',
        'Remove Riley Staff, riley@example.com, staff, id GUEST-2',
      ]),
    );
  });

  it('opens the bulk-import surface and reaches addMany with the guest row shape', async () => {
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickImportButton();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isImportPanelOpen()).toBe(true);

    const surface = await harness.getImportSurfaceHarness();
    expect(surface).not.toBeNull();

    // Paste a two-column guest list (name/email) and advance to preview.
    await surface!.pasteText('name\temail\nZoe Example\tzoe@example.test');
    await surface!.clickNext();
    fixture.detectChanges();
    await fixture.whenStable();

    await surface!.clickConfirm();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(adminEventsServiceMock.bulkAddGuests).toHaveBeenCalledTimes(1);
    const [eventId, batchKey, rows] = adminEventsServiceMock.bulkAddGuests.mock
      .calls[0] as [string, string, unknown];
    expect(eventId).toBe('event-1');
    expect(typeof batchKey).toBe('string');
    expect(batchKey.length).toBeGreaterThan(0);
    // guestType is mapped to the mutation's `type` field; email preserved.
    expect(rows).toEqual([
      {
        name: 'Zoe Example',
        email: 'zoe@example.test',
        type: 'guest',
        notes: undefined,
      },
    ]);

    // Server-authoritative report renders on the surface's report step.
    expect(await surface!.getReportInsertedText()).toContain('1 added');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('flags an existing guest as a duplicate in the bulk-import preview', async () => {
    fixture.componentRef.setInput('guests', [
      {...mockGuest, name: 'Zoe Example', email: 'zoe@example.test'},
    ]);
    fixture.detectChanges();

    await harness.clickImportButton();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    const surface = await harness.getImportSurfaceHarness();
    expect(surface).not.toBeNull();

    await surface!.pasteText('name\temail\nZoe Example\tzoe@example.test');
    await surface!.clickNext();
    fixture.detectChanges();
    await fixture.whenStable();

    // The existing guest name+email key flows into the preview → duplicate.
    expect(await surface!.getRowCountByPartition('duplicate')).toBe(1);
  });

  it('shows visible feedback after starting a guest ticket download', async () => {
    await fixture.componentInstance.downloadGuestTicket('guest-1');

    expect(adminEventsServiceMock.getGuestTicketPdf).toHaveBeenCalledWith(
      'guest-1',
    );
    expect(browserPlatformMock.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'guest-ticket-guest-1.pdf',
    );
    const [blob] = browserPlatformMock.downloadBlob.mock.calls[0] as [Blob];
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(4);
    expect(toast.success).toHaveBeenCalledWith(
      'Guest ticket download started.',
    );
  });
});
