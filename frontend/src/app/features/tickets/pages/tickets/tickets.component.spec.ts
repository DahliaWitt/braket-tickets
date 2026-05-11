import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TicketsComponent} from './tickets.component';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {AuthService} from '@/core/services/auth.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {CONVEX} from 'convex-angular';
import {EventsService} from '@/features/admin/services/events.service';
import {signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ZardTicketsHarness} from './tickets.component.harness';
import {provideRouter} from '@angular/router';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {toast} from 'ngx-sonner';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

describe('TicketsComponent', () => {
  let component: TicketsComponent;
  let fixture: ComponentFixture<TicketsComponent>;
  let harness: ZardTicketsHarness;

  // Mock signals for ticketsResource
  const ticketsValue = signal<unknown[] | undefined>([]);
  const ticketsIsLoading = signal(false);
  const ticketsError = signal<Error | undefined>(undefined);

  const paymentServiceMock = {
    getMyTickets: vi.fn().mockResolvedValue([]),
    getMyTicketPdf: vi
      .fn()
      .mockResolvedValue('data:application/pdf;base64,abc123'),
    ticketsResource: {
      value: ticketsValue,
      isLoading: ticketsIsLoading,
      error: ticketsError,
    },
    triggerRefresh: vi.fn(),
  };

  const authServiceMock = {
    user: signal({_id: 'U1', name: 'Test User'}),
    userRole: signal('user' as string | null),
    isScannerStaff: signal(false),
    isCommunityAdmin: signal(false),
    logout: vi.fn(),
  };

  const resaleServiceMock = {
    listTicketForResale: vi.fn().mockResolvedValue('listing-1'),
    cancelResaleListing: vi.fn().mockResolvedValue(undefined),
  };

  let availabilityByKey: Record<string, Record<string, unknown>>;
  let resaleListingsByKey: Record<
    string,
    Record<string, {_id: string; ticketId: string; status: string}[]>
  >;

  const eventsServiceMock = {
    getBatchAvailability: vi.fn(async (eventIds: string[]) => {
      const key = [...eventIds].sort().join(',');
      return availabilityByKey[key] ?? {};
    }),
  };

  const convexClientMock: MockConvexClient = createMockConvexClient();
  const browserPlatformMock = {
    navigateWithAnchor: vi.fn(),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    focusElementById: vi.fn((id: string) => {
      document.getElementById(id)?.focus();
    }),
  };

  function makeTicket(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'T1',
      _creationTime: Date.now(),
      eventId: 'E1',
      userId: 'U1',
      status: 'valid',
      tier: 'regular',
      resolvedEvent: {
        _id: 'E1',
        _creationTime: Date.now(),
        title: 'Test Event',
        date: '2026-06-01',
        resaleEnabled: true,
        resaleFeePct: 4.2,
      },
      resaleSellerSettlement: {
        sellerPaidAmount: 2500,
        resaleFeeCents: 105,
        sellerRefundAmount: 2395,
        lostProcessingFeeCents: 103,
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    // Reset signals and mocks
    ticketsValue.set([]);
    ticketsIsLoading.set(false);
    ticketsError.set(undefined);
    availabilityByKey = {};
    resaleListingsByKey = {};
    vi.clearAllMocks();
    browserPlatformMock.writeClipboardText.mockResolvedValue(undefined);
    paymentServiceMock.getMyTicketPdf.mockResolvedValue(
      'data:application/pdf;base64,abc123',
    );
    vi.spyOn(toast, 'success').mockImplementation(() => '' as string & number);
    vi.spyOn(toast, 'error').mockImplementation(() => '' as string & number);

    convexClientMock.onUpdate = vi.fn(
      (_query: unknown, args: unknown, onData: (value: unknown) => void) => {
        const eventIds = (args as {eventIds?: string[]} | undefined)?.eventIds;
        if (!eventIds || eventIds.length === 0) {
          onData({});
          return () => void 0;
        }

        const key = [...eventIds].sort().join(',');
        onData(resaleListingsByKey[key] ?? {});
        return () => void 0;
      },
    );
    convexClientMock.client.onUpdate = convexClientMock.onUpdate;

    await TestBed.configureTestingModule({
      imports: [TicketsComponent],
      providers: [
        {provide: PaymentService, useValue: paymentServiceMock},
        {provide: AuthService, useValue: authServiceMock},
        {provide: ResaleService, useValue: resaleServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: EventsService, useValue: eventsServiceMock},
        {provide: BrowserPlatformService, useValue: browserPlatformMock},
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TicketsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ZardTicketsHarness,
    );
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should consume tickets from the service resource', () => {
    expect(component.tickets()).toEqual([]);
    expect(component.isLoading()).toBe(false);
  });

  it('should show empty state when no tickets are found', async () => {
    expect(await harness.getTicketCount()).toBe(0);
    expect(await harness.hasEmptyState()).toBe(true);
  });

  it('should render ticket list when tickets are available', async () => {
    ticketsValue.set([
      makeTicket({_id: 'T1'}),
      makeTicket({_id: 'T2', eventId: 'E2'}),
    ]);
    fixture.detectChanges();

    expect(await harness.getTicketCount()).toBe(2);
    expect(await harness.hasEmptyState()).toBe(false);
  });

  it('should request availability with unique event IDs', async () => {
    ticketsValue.set([
      makeTicket({_id: 'T1', eventId: 'E1'}),
      makeTicket({_id: 'T2', eventId: 'E1'}),
      makeTicket({_id: 'T3', eventId: 'E2'}),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(eventsServiceMock.getBatchAvailability).toHaveBeenCalledWith([
      'E1',
      'E2',
    ]);
  });

  it('should copy ticket ID', () => {
    component.copyId('T1');
    expect(browserPlatformMock.writeClipboardText).toHaveBeenCalledWith('T1');
  });

  it('should show visible confirmation after copying ticket ID', async () => {
    component.copyId('T1');
    await fixture.whenStable();

    expect(toast.success).toHaveBeenCalledWith('Ticket ID copied.');
  });

  it('should show a visible error when copying ticket ID fails', async () => {
    browserPlatformMock.writeClipboardText.mockRejectedValueOnce(
      new Error('denied'),
    );

    component.copyId('T1');
    await fixture.whenStable();

    expect(toast.error).toHaveBeenCalledWith('Failed to copy ticket ID.');
  });

  it('should trigger ticket PDF download and show visible feedback', async () => {
    ticketsValue.set([makeTicket({_id: 'T1'})]);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = await harness.getTicketCard(0);
    await card.clickDownloadPdf();
    await fixture.whenStable();

    expect(paymentServiceMock.getMyTicketPdf).toHaveBeenCalledWith('T1');
    expect(browserPlatformMock.navigateWithAnchor).toHaveBeenCalledWith(
      'data:application/pdf;base64,abc123',
      'ticket-T1.pdf',
    );
    expect(toast.success).toHaveBeenCalledWith('Ticket PDF download started.');
  });

  describe('resale - State B: eligible to list', () => {
    beforeEach(async () => {
      const key = 'E1';
      availabilityByKey[key] = {
        E1: {isSoldOut: false, resaleAvailable: 0, resaleEnabled: true},
      };
      resaleListingsByKey[key] = {
        E1: [],
      };

      ticketsValue.set([makeTicket()]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('should show List for Resale button when resale is enabled', async () => {
      const card = await harness.getTicketCard(0);
      expect(await card.hasListForResaleButton()).toBe(true);
    });

    it('should not show cancel button when no listing exists', async () => {
      const card = await harness.getTicketCard(0);
      expect(await card.hasCancelListingButton()).toBe(false);
    });

    it('should open a confirmation flow before listing', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      expect(await card.hasResaleConfirmationPanel()).toBe(true);
      await card.waitForConfirmResaleListingFocus();
      expect(await card.isConfirmResaleListingFocused()).toBe(true);
      expect(resaleServiceMock.listTicketForResale).not.toHaveBeenCalled();
    });

    it('should disclose seller payout math before listing', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      const disclosure = await card.getResaleSellerDisclosureText();
      expect(disclosure).toContain('Original ticket price');
      expect(disclosure).toContain('$25');
      expect(disclosure).toContain('4.2%');
      expect(disclosure).toContain('$1.05');
      expect(disclosure).toContain('$23.95');
      expect(disclosure).not.toContain('$1.03');
      const disclosureNote = await card.getResaleSellerDisclosureNoteText();
      expect(disclosureNote).toContain('$1.03');
    });

    it('should block resale confirmation when payout math is unavailable', async () => {
      ticketsValue.set([makeTicket({resaleSellerSettlement: undefined})]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      expect(await card.getResaleSellerDisclosureText()).toBeNull();
      const unavailableText =
        await card.getResaleSellerDisclosureUnavailableText();
      expect(unavailableText).toContain("We can't calculate the resale payout");
      expect(await card.isConfirmResaleListingDisabled()).toBe(true);
      await card.clickConfirmResaleListing();
      await fixture.whenStable();
      expect(resaleServiceMock.listTicketForResale).not.toHaveBeenCalled();
    });

    it('should close the confirmation flow without listing', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      await card.clickCancelResaleFlow();
      fixture.detectChanges();

      expect(await card.hasResaleConfirmationPanel()).toBe(false);
      expect(resaleServiceMock.listTicketForResale).not.toHaveBeenCalled();
    });

    it('should call resaleService.listTicketForResale after confirmation', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      await card.clickConfirmResaleListing();
      await fixture.whenStable();

      expect(resaleServiceMock.listTicketForResale).toHaveBeenCalledWith('T1');
    });

    it('should show listed state immediately after successful confirmation', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      await card.clickConfirmResaleListing();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await card.getStatusBadgeText()).toBe('LISTED');
      expect(await card.hasListForResaleButton()).toBe(false);
      expect(await card.hasCancelListingButton()).toBe(true);
    });

    it('should rely on realtime query updates instead of manual refresh', async () => {
      const card = await harness.getTicketCard(0);
      await card.clickListForResale();
      fixture.detectChanges();

      await card.clickConfirmResaleListing();
      await fixture.whenStable();
      expect(paymentServiceMock.triggerRefresh).not.toHaveBeenCalled();
    });

    it('should disable other resale entry buttons while a listing is in flight', async () => {
      let resolveListing!: (listingId: string) => void;
      resaleServiceMock.listTicketForResale.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveListing = resolve;
        }),
      );
      ticketsValue.set([
        makeTicket({_id: 'T1', eventId: 'E1'}),
        makeTicket({
          _id: 'T2',
          eventId: 'E2',
          resolvedEvent: {
            _id: 'E2',
            _creationTime: Date.now(),
            title: 'Second Event',
            date: '2026-06-02',
            resaleEnabled: true,
          },
        }),
      ]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const firstCard = await harness.getTicketCard(0);
      const secondCard = await harness.getTicketCard(1);
      await firstCard.clickListForResale();
      fixture.detectChanges();
      await firstCard.clickConfirmResaleListing();
      fixture.detectChanges();

      expect(await secondCard.isListForResaleDisabled()).toBe(true);

      resolveListing('listing-1');
      await fixture.whenStable();
      fixture.detectChanges();
    });
  });

  describe('resale - State A: resale not enabled', () => {
    it('should not show resale button when event has resale disabled', async () => {
      ticketsValue.set([
        makeTicket({
          resolvedEvent: {
            _id: 'E1',
            _creationTime: Date.now(),
            title: 'Test Event',
            date: '2026-06-01',
            resaleEnabled: false,
          },
        }),
      ]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const card = await harness.getTicketCard(0);
      expect(await card.hasListForResaleButton()).toBe(false);
    });
  });

  describe('resale - non-valid tickets', () => {
    it('should not show List for Resale for used tickets', async () => {
      ticketsValue.set([makeTicket({status: 'used'})]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const card = await harness.getTicketCard(0);
      expect(await card.hasListForResaleButton()).toBe(false);
    });
  });

  describe('error state', () => {
    it('should show error state when tickets query errors', async () => {
      ticketsError.set(new Error('Network failure'));
      fixture.detectChanges();

      expect(await harness.hasErrorState()).toBe(true);
      expect(await harness.hasEmptyState()).toBe(false);
      expect(await harness.getTicketCount()).toBe(0);
    });

    it('should not show error state when there is no error', async () => {
      ticketsValue.set([makeTicket()]);
      fixture.detectChanges();

      expect(await harness.hasErrorState()).toBe(false);
    });

    it('should return empty tickets array and set hasLoadError when in error state', () => {
      ticketsError.set(new Error('Server error'));
      fixture.detectChanges();

      expect(component.tickets()).toEqual([]);
      expect(component.hasLoadError()).toBe(true);
    });
  });
});
