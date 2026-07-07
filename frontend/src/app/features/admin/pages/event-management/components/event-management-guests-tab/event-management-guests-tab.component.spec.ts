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

type SendGuestTicketFn = (
  guestId: string,
  options?: {skipIfAlreadyEmailed?: boolean},
) => Promise<{status: 'sent' | 'skipped'}>;

describe('EventManagementGuestsTabComponent', () => {
  let fixture: ComponentFixture<EventManagementGuestsTabComponent>;
  let harness: EventManagementGuestsTabHarness;
  let adminEventsServiceMock: {
    addGuest: ReturnType<typeof vi.fn>;
    updateGuest: ReturnType<typeof vi.fn>;
    removeGuest: ReturnType<typeof vi.fn>;
    sendGuestTicket: ReturnType<typeof vi.fn<SendGuestTicketFn>>;
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
    vi.spyOn(toast, 'info').mockImplementation(() => '' as string & number);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    adminEventsServiceMock = {
      addGuest: vi.fn().mockResolvedValue('guest-1'),
      updateGuest: vi.fn().mockResolvedValue(null),
      removeGuest: vi.fn().mockResolvedValue(undefined),
      sendGuestTicket: vi
        .fn<SendGuestTicketFn>()
        .mockResolvedValue({status: 'sent'}),
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

  it('dispatches sends for multiple guests without blocking on an in-flight send', async () => {
    const resolvers: (() => void)[] = [];
    adminEventsServiceMock.sendGuestTicket.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({status: 'sent'}));
        }),
    );

    const firstSend = fixture.componentInstance.sendGuestTicket('guest-1');
    const secondSend = fixture.componentInstance.sendGuestTicket('guest-2');

    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledTimes(2);
    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledWith(
      'guest-1',
      {skipIfAlreadyEmailed: false},
    );
    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledWith(
      'guest-2',
      {skipIfAlreadyEmailed: false},
    );

    for (const resolve of resolvers) resolve();
    await Promise.all([firstSend, secondSend]);
    expect(toast.success).toHaveBeenCalledTimes(2);
  });

  it('ignores a duplicate send for a guest whose send is already in flight', async () => {
    let resolveSend!: () => void;
    adminEventsServiceMock.sendGuestTicket.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = () => resolve({status: 'sent'});
        }),
    );

    const firstSend = fixture.componentInstance.sendGuestTicket('guest-1');
    const duplicateSend = fixture.componentInstance.sendGuestTicket('guest-1');

    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledTimes(1);

    resolveSend();
    await Promise.all([firstSend, duplicateSend]);
  });

  it('surfaces a neutral notice when a single send is skipped as already in flight', async () => {
    adminEventsServiceMock.sendGuestTicket.mockResolvedValue({
      status: 'skipped',
    });
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await fixture.componentInstance.sendGuestTicket('guest-1');

    expect(toast.info).toHaveBeenCalledWith(
      'This ticket is already being sent',
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(dataChangedSpy).not.toHaveBeenCalled();
  });

  it('keeps the send button label stable and marks it busy while a send is in flight', async () => {
    let resolveSend!: () => void;
    adminEventsServiceMock.sendGuestTicket.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = () => resolve({status: 'sent'});
        }),
    );
    fixture.componentRef.setInput('guests', [mockGuest]);
    fixture.detectChanges();

    const sendPromise = fixture.componentInstance.sendGuestTicket('guest-1');
    fixture.detectChanges();

    // Desktop and mobile variants both render the button.
    expect(await harness.getSendButtonAriaBusyStates()).toEqual([
      'true',
      'true',
    ]);
    // Label must not change while sending — a text swap resizes the button
    // and makes the spinner drift in the right-aligned actions cell.
    expect(await harness.getSendButtonTexts()).toEqual(['Send', 'Send']);

    resolveSend();
    await sendPromise;
    fixture.detectChanges();

    expect(await harness.getSendButtonAriaBusyStates()).toEqual([
      'false',
      'false',
    ]);
  });

  it('sends tickets to all guests with an email that have not been emailed yet', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.componentRef.setInput('guests', [
      mockGuest,
      {...mockGuest, _id: 'guest-2', name: 'Riley Staff'},
      {...mockGuest, _id: 'guest-3', name: 'Already Sent', emailedAt: 123},
      {...mockGuest, _id: 'guest-4', name: 'No Email', email: undefined},
    ]);
    fixture.detectChanges();
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    expect(await harness.getSendAllButtonText()).toContain('Send All (2)');

    await harness.clickSendAllButton();
    await fixture.whenStable();

    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledTimes(2);
    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledWith(
      'guest-1',
      {skipIfAlreadyEmailed: true},
    );
    expect(adminEventsServiceMock.sendGuestTicket).toHaveBeenCalledWith(
      'guest-2',
      {skipIfAlreadyEmailed: true},
    );
    expect(toast.success).toHaveBeenCalledWith('Sent 2 tickets');
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('reports partial failures when some send-all dispatches fail', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    adminEventsServiceMock.sendGuestTicket.mockImplementation((guestId) =>
      guestId === 'guest-2'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({status: 'sent'}),
    );
    fixture.componentRef.setInput('guests', [
      mockGuest,
      {...mockGuest, _id: 'guest-2', name: 'Riley Staff'},
    ]);
    fixture.detectChanges();

    await harness.clickSendAllButton();
    await fixture.whenStable();

    expect(toast.success).toHaveBeenCalledWith('Sent 1 ticket');
    expect(toast.error).toHaveBeenCalledWith('Failed to send 1 ticket');
  });

  it('reports skips from a concurrent admin and reconciles the roster', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    adminEventsServiceMock.sendGuestTicket.mockImplementation((guestId) =>
      Promise.resolve({status: guestId === 'guest-2' ? 'skipped' : 'sent'}),
    );
    fixture.componentRef.setInput('guests', [
      mockGuest,
      {...mockGuest, _id: 'guest-2', name: 'Riley Staff'},
    ]);
    fixture.detectChanges();
    const dataChangedSpy = vi.fn();
    fixture.componentInstance.dataChanged.subscribe(dataChangedSpy);

    await harness.clickSendAllButton();
    await fixture.whenStable();

    expect(toast.success).toHaveBeenCalledWith('Sent 1 ticket');
    expect(toast.info).toHaveBeenCalledWith('Skipped 1 already-sent guest');
    expect(toast.error).not.toHaveBeenCalled();
    // A skip means another admin advanced server state, so the roster still
    // needs reconciling even though this batch sent only one.
    expect(dataChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('does not send anything when the send-all confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fixture.componentRef.setInput('guests', [mockGuest]);
    fixture.detectChanges();

    await harness.clickSendAllButton();
    await fixture.whenStable();

    expect(adminEventsServiceMock.sendGuestTicket).not.toHaveBeenCalled();
  });

  it('disables the send-all button when no guest needs a ticket email', async () => {
    fixture.componentRef.setInput('guests', [
      {...mockGuest, emailedAt: 123},
      {...mockGuest, _id: 'guest-2', email: undefined},
    ]);
    fixture.detectChanges();

    expect(await harness.isSendAllButtonDisabled()).toBe(true);
    expect(await harness.getSendAllButtonText()).toContain('Send All (0)');
    // Disabled outline buttons get no visual treatment from the variants, so
    // the count-0 state must carry an explicit muted affordance.
    expect(await harness.isSendAllButtonMuted()).toBe(true);
  });

  it('shows the send-all button in an active (non-muted) state when guests are pending', async () => {
    fixture.componentRef.setInput('guests', [mockGuest]);
    fixture.detectChanges();

    expect(await harness.isSendAllButtonDisabled()).toBe(false);
    expect(await harness.isSendAllButtonMuted()).toBe(false);
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
