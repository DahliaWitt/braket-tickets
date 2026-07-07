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
    updateGuest: ReturnType<typeof vi.fn>;
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
      updateGuest: vi.fn().mockResolvedValue(null),
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

  it('shows a success toast and refreshes after editing a guest from the dialog', async () => {
    fixture.componentRef.setInput('guests', [mockGuest]);
    fixture.detectChanges();

    const editResult = {
      name: 'Pat Guest Updated',
      email: 'pat.updated@example.com',
      type: 'staff' as const,
      notes: 'Updated notes',
    };
    dialogServiceMock.create.mockReturnValue({
      afterClosed$: of(editResult),
    });
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickEditGuestButton(0);
    await fixture.whenStable();

    expect(dialogServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Edit Guest',
        zData: {
          eventId: 'event-1',
          guest: {
            name: mockGuest.name,
            email: mockGuest.email,
            type: mockGuest.type,
            notes: mockGuest.notes,
          },
        },
      }),
    );
    expect(adminEventsServiceMock.updateGuest).toHaveBeenCalledWith(
      mockGuest._id,
      editResult,
    );
    expect(toast.success).toHaveBeenCalledWith('Guest updated');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast and does not refresh when editing a guest fails', async () => {
    fixture.componentRef.setInput('guests', [mockGuest]);
    fixture.detectChanges();

    adminEventsServiceMock.updateGuest.mockRejectedValue(new Error('boom'));
    dialogServiceMock.create.mockReturnValue({
      afterClosed$: of(addGuestResult),
    });
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickEditGuestButton(0);
    await fixture.whenStable();

    expect(toast.error).toHaveBeenCalledWith('Failed to update guest');
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
    expect(new Set(await harness.getEditButtonAriaLabels())).toEqual(
      new Set([
        'Edit Pat Guest, pat@example.com, guest, id GUEST-1',
        'Edit Riley Staff, riley@example.com, staff, id GUEST-2',
      ]),
    );
    expect(new Set(await harness.getRemoveButtonAriaLabels())).toEqual(
      new Set([
        'Remove Pat Guest, pat@example.com, guest, id GUEST-1',
        'Remove Riley Staff, riley@example.com, staff, id GUEST-2',
      ]),
    );
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
