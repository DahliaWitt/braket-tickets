import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {ConvexError} from 'convex/values';
import {describe, it, expect, beforeEach} from 'vitest';
import {
  AdminEventsService,
  type TicketSalesStatus,
} from '@/features/admin/services/admin-events.service';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';
import {
  type EventManagementPurchases,
  type EventManagementResale,
  type EventManagementSummary,
  type EventTierPricingStats,
  type Guest,
  type GuestType,
  type TicketReminderAudience,
  type TicketReminderSendResult,
} from '../models/event-management.model';

describe('AdminEventsService', () => {
  let service: AdminEventsService;
  let convexMock: MockConvexClient;

  const mockEventId = 'event123' as Id<'events'>;
  const mockGuestId = 'guest456' as Id<'guests'>;
  const mockOrderId = 'order123' as Id<'ticket_orders'>;
  const mockTicketId = 'ticket999' as Id<'tickets'>;

  const mockEvent = {
    _id: mockEventId,
    _creationTime: Date.now(),
    title: 'Test Event',
    date: '2024-01-01T20:00:00.000Z',
    price: 2500,
    totalTickets: 100,
    status: 'published' as const,
    ticketSalesStatus: 'active' as const,
    visibility: 'public' as const,
    organizerId: 'org1' as Id<'organizers'>,
  };

  const mockManagementSummary: EventManagementSummary = {
    event: {...mockEvent, id: mockEventId},
    soldCount: 50,
    heldCount: 0,
    remainingCount: 50,
    isSoldOut: false,
    totalTickets: 100,
    tierCounts: {regular: 40, notaflof: 5, supporter: 5},
    salesByDay: [{date: '2024-01-01', quantity: 10}],
    revenue: {
      grossCents: 125000,
      processingFeeCents: 3750,
      platformFeeCents: 6250,
      refundedCents: 0,
      lostProcessingFeeCents: 0,
      netCents: 115000,
    },
    revenueByTier: {
      regular: {grossCents: 100000, netCents: 92000, quantity: 40},
      notaflof: {grossCents: 12500, netCents: 11500, quantity: 5},
      supporter: {grossCents: 12500, netCents: 11500, quantity: 5},
    },
    checkInStats: {checkedIn: 0, checkInRate: 0, buckets: []},
  };

  const mockManagementPurchases: EventManagementPurchases = {
    event: {...mockEvent, id: mockEventId},
    purchases: [
      {
        id: mockOrderId,
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
  };

  const mockManagementResale: EventManagementResale = {
    event: {...mockEvent, id: mockEventId},
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

  const mockGuests: Guest[] = [
    {
      _id: mockGuestId,
      _creationTime: Date.now(),
      eventId: mockEventId,
      name: 'VIP Guest',
      email: 'vip@example.com',
      type: 'guest',
      notes: 'Important guest',
    },
  ];

  beforeEach(() => {
    convexMock = createMockConvexClient();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AdminEventsService,
        {provide: CONVEX, useValue: convexMock},
      ],
    });
    service = TestBed.inject(AdminEventsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getManagementSummary', () => {
    it('should fetch and return event summary data', async () => {
      convexMock.action.mockResolvedValue(mockManagementSummary);

      const result = await service.getManagementSummary(mockEventId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.events.management.getManagementSummary,
        {
          eventId: mockEventId,
        },
      );
      expect(result.event._id).toBe(mockEventId);
      expect(result.event.id).toBe(mockEventId);
      expect(result.soldCount).toBe(50);
      expect(convexMock.action).toHaveBeenCalledTimes(1);
    });

    it('should retry transient failures and return data', async () => {
      convexMock.action
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValue(mockManagementSummary);

      const result = await service.getManagementSummary(mockEventId);

      expect(result.event._id).toBe(mockEventId);
      expect(convexMock.action).toHaveBeenCalledTimes(2);
    });

    it('should throw when action fails', async () => {
      convexMock.action.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getManagementSummary(mockEventId)).rejects.toThrow(
        'Failed to fetch',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(5);
    });

    it('should not retry explicit large-event failures', async () => {
      convexMock.action.mockRejectedValue(
        new ConvexError({
          code: 'MANAGEMENT_DATA_TOO_LARGE',
          message:
            'Event management tickets exceed the supported limit of 10000 records. Admin metrics would be incomplete, so loading has been blocked.',
        }),
      );

      await expect(service.getManagementSummary(mockEventId)).rejects.toThrow(
        'MANAGEMENT_DATA_TOO_LARGE',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(1);
    });
  });

  describe('getManagementPurchases', () => {
    it('should fetch purchases surface via gated admin action', async () => {
      convexMock.action.mockResolvedValue(mockManagementPurchases);

      const result = await service.getManagementPurchases(mockEventId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.events.management.getManagementPurchases,
        {
          eventId: mockEventId,
        },
      );
      expect(result.event._id).toBe(mockEventId);
      expect(result.event.id).toBe(mockEventId);
      expect(result.purchases).toHaveLength(1);
    });

    it('should preserve purchase status from backend', async () => {
      const payload: EventManagementPurchases = {
        ...mockManagementPurchases,
        purchases: [
          {...mockManagementPurchases.purchases[0], status: 'refunded'},
        ],
      };
      convexMock.action.mockResolvedValue(payload);

      const result = await service.getManagementPurchases(mockEventId);

      expect(result.purchases[0].status).toBe('refunded');
    });

    it('should retry transient failures and return data', async () => {
      convexMock.action
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValue(mockManagementPurchases);

      const result = await service.getManagementPurchases(mockEventId);

      expect(result.event._id).toBe(mockEventId);
      expect(convexMock.action).toHaveBeenCalledTimes(2);
    });

    it('should throw when action fails', async () => {
      convexMock.action.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getManagementPurchases(mockEventId)).rejects.toThrow(
        'Failed to fetch',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(5);
    });

    it('should not retry explicit large-event failures', async () => {
      convexMock.action.mockRejectedValue(
        new ConvexError({
          code: 'MANAGEMENT_DATA_TOO_LARGE',
          message:
            'Event management orders exceed the supported limit of 10000 records. Admin metrics would be incomplete, so loading has been blocked.',
        }),
      );

      await expect(service.getManagementPurchases(mockEventId)).rejects.toThrow(
        'MANAGEMENT_DATA_TOO_LARGE',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(1);
    });
  });

  describe('getManagementResale', () => {
    it('should fetch resale surface via gated admin action', async () => {
      convexMock.action.mockResolvedValue(mockManagementResale);

      const result = await service.getManagementResale(mockEventId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.events.management.getManagementResale,
        {
          eventId: mockEventId,
        },
      );
      expect(result.event._id).toBe(mockEventId);
      expect(result.event.id).toBe(mockEventId);
      expect(result.resaleListings).toHaveLength(0);
      expect(result.resaleMetrics.notificationSubscribers).toBe(0);
    });

    it('should retry transient failures and return data', async () => {
      convexMock.action
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValue(mockManagementResale);

      const result = await service.getManagementResale(mockEventId);

      expect(result.event._id).toBe(mockEventId);
      expect(convexMock.action).toHaveBeenCalledTimes(2);
    });

    it('should throw when action fails', async () => {
      convexMock.action.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getManagementResale(mockEventId)).rejects.toThrow(
        'Failed to fetch',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(5);
    });

    it('should not retry explicit large-event failures', async () => {
      convexMock.action.mockRejectedValue(
        new ConvexError({
          code: 'MANAGEMENT_DATA_TOO_LARGE',
          message:
            'Event management resale listings exceed the supported limit of 5000 records. Admin metrics would be incomplete, so loading has been blocked.',
        }),
      );

      await expect(service.getManagementResale(mockEventId)).rejects.toThrow(
        'MANAGEMENT_DATA_TOO_LARGE',
      );
      expect(convexMock.action).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTierPricingStats', () => {
    it('should fetch tier pricing stats for an event', async () => {
      const mockStats: EventTierPricingStats = {
        tiers: [
          {
            tier: 'notaflof',
            count: 2,
            min: 1000,
            max: 1500,
            mean: 1250,
            median: 1250,
            mode: [1000, 1500],
          },
        ],
      };
      convexMock.query.mockResolvedValue(mockStats);

      const result = await service.getTierPricingStats(mockEventId);

      expect(convexMock.query).toHaveBeenCalledWith(
        api.events.pricing.getEventTierPricingStats,
        {
          eventId: mockEventId,
        },
      );
      expect(result).toEqual(mockStats);
    });
  });

  describe('updateTicketSalesStatus', () => {
    it('should update ticket sales status to active', async () => {
      const status: TicketSalesStatus = 'active';
      convexMock.mutation.mockResolvedValue(undefined);

      await service.updateTicketSalesStatus(mockEventId, status);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.management.update,
        {
          id: mockEventId,
          ticketSalesStatus: 'active',
        },
      );
    });

    it('should update ticket sales status to paused', async () => {
      const status: TicketSalesStatus = 'paused';
      convexMock.mutation.mockResolvedValue(undefined);

      await service.updateTicketSalesStatus(mockEventId, status);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.management.update,
        {
          id: mockEventId,
          ticketSalesStatus: 'paused',
        },
      );
    });

    it('should update ticket sales status to ended', async () => {
      const status: TicketSalesStatus = 'ended';
      convexMock.mutation.mockResolvedValue(undefined);

      await service.updateTicketSalesStatus(mockEventId, status);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.management.update,
        {
          id: mockEventId,
          ticketSalesStatus: 'ended',
        },
      );
    });

    it('should throw when mutation fails', async () => {
      convexMock.mutation.mockRejectedValue(new Error('Unauthorized'));

      await expect(
        service.updateTicketSalesStatus(mockEventId, 'active'),
      ).rejects.toThrow('Unauthorized');
      expect(convexMock.mutation).toHaveBeenCalledTimes(3);
    });

    it('should retry transient mutation failures and then succeed', async () => {
      convexMock.mutation
        .mockRejectedValueOnce(new Error('Transient timeout'))
        .mockResolvedValueOnce(undefined);

      await service.updateTicketSalesStatus(mockEventId, 'paused');

      expect(convexMock.mutation).toHaveBeenCalledTimes(2);
      expect(convexMock.mutation).toHaveBeenLastCalledWith(
        api.events.management.update,
        {
          id: mockEventId,
          ticketSalesStatus: 'paused',
        },
      );
    });
  });

  describe('refundPayment', () => {
    it('should call the standard refund action', async () => {
      convexMock.action.mockResolvedValue({success: true});

      const result = await service.refundPayment(mockOrderId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.payments.refunds.refund,
        {
          orderId: mockOrderId,
        },
      );
      expect(result).toBe(true);
    });
  });

  describe('forceRefundAll', () => {
    it('should call the force refund all action', async () => {
      convexMock.action.mockResolvedValue({success: true});

      const result = await service.forceRefundAll(mockOrderId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.payments.refunds.forceRefundAll,
        {
          orderId: mockOrderId,
        },
      );
      expect(result).toBe(true);
    });
  });

  describe('refundTicket', () => {
    it('should call the single-ticket refund action', async () => {
      convexMock.action.mockResolvedValue({success: true});

      const result = await service.refundTicket(mockTicketId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.payments.refunds.refundTicket,
        {
          ticketId: mockTicketId,
        },
      );
      expect(result).toBe(true);
    });
  });

  describe('getTicketReminderAudience', () => {
    it('should fetch reminder audience preview for an event', async () => {
      const mockAudience: TicketReminderAudience = {
        segment: 'approved_no_ticket',
        recipientCount: 7,
        missingOrganizer: false,
      };
      convexMock.client.query.mockResolvedValue(mockAudience);

      const result = await service.getTicketReminderAudience(mockEventId);

      expect(convexMock.client.query).toHaveBeenCalledWith(
        api.events.reminders.getTicketReminderAudience,
        {
          eventId: mockEventId,
        },
      );
      expect(result).toEqual(mockAudience);
    });
  });

  describe('sendTicketPurchaseReminder', () => {
    it('should call reminder mutation with subject and message', async () => {
      const mockResult: TicketReminderSendResult = {
        segment: 'approved_no_ticket',
        recipientCount: 3,
      };
      convexMock.mutation.mockResolvedValue(mockResult);

      const result = await service.sendTicketPurchaseReminder(
        mockEventId,
        'Reminder Subject',
        'Reminder message body.',
      );

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.reminders.sendTicketPurchaseReminder,
        {
          eventId: mockEventId,
          subject: 'Reminder Subject',
          message: 'Reminder message body.',
        },
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getGuests', () => {
    it('should return guest list for an event', async () => {
      convexMock.client.query.mockResolvedValue(mockGuests);

      const result = await service.getGuests(mockEventId);

      expect(convexMock.client.query).toHaveBeenCalledWith(
        api.events.guests.listByEvent,
        {
          eventId: mockEventId,
        },
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('VIP Guest');
    });

    it('should return empty array when no guests exist', async () => {
      convexMock.client.query.mockResolvedValue([]);

      const result = await service.getGuests(mockEventId);

      expect(result).toHaveLength(0);
    });

    it('should throw when query fails', async () => {
      convexMock.client.query.mockRejectedValue(new Error('Event not found'));

      await expect(service.getGuests(mockEventId)).rejects.toThrow(
        'Event not found',
      );
      expect(convexMock.client.query).toHaveBeenCalledTimes(5);
    });
  });

  describe('addGuest', () => {
    it('should add a guest with all fields', async () => {
      const guestData = {
        name: 'New Guest',
        email: 'guest@example.com',
        type: 'guest' as GuestType,
        notes: 'Comp ticket',
      };
      convexMock.mutation.mockResolvedValue('new-guest-id');

      const result = await service.addGuest(mockEventId, guestData);

      expect(convexMock.mutation).toHaveBeenCalledWith(api.events.guests.add, {
        eventId: mockEventId,
        ...guestData,
      });
      expect(result).toBe('new-guest-id');
    });

    it('should add a guest with minimal fields', async () => {
      const guestData = {
        name: 'Minimal Guest',
        type: 'staff' as GuestType,
      };
      convexMock.mutation.mockResolvedValue('new-guest-id');

      const result = await service.addGuest(mockEventId, guestData);

      expect(convexMock.mutation).toHaveBeenCalledWith(api.events.guests.add, {
        eventId: mockEventId,
        name: 'Minimal Guest',
        type: 'staff',
      });
      expect(result).toBe('new-guest-id');
    });

    it('should add guest with artist guest type', async () => {
      const guestData = {
        name: 'Performer',
        type: 'artist guest' as GuestType,
      };
      convexMock.mutation.mockResolvedValue('artist-guest-id');

      const result = await service.addGuest(mockEventId, guestData);

      expect(convexMock.mutation).toHaveBeenCalledWith(api.events.guests.add, {
        eventId: mockEventId,
        name: 'Performer',
        type: 'artist guest',
      });
      expect(result).toBe('artist-guest-id');
    });

    it('should throw when mutation fails', async () => {
      convexMock.mutation.mockRejectedValue(new Error('Duplicate guest'));

      await expect(
        service.addGuest(mockEventId, {name: 'Test', type: 'guest'}),
      ).rejects.toThrow('Duplicate guest');
    });
  });

  describe('updateGuest', () => {
    it('should update a guest with all fields', async () => {
      const guestData = {
        name: 'Updated Guest',
        email: 'updated@example.com',
        type: 'staff' as GuestType,
        notes: 'Updated notes',
      };
      convexMock.mutation.mockResolvedValue(null);

      const result = await service.updateGuest(mockGuestId, guestData);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.guests.update,
        {
          id: mockGuestId,
          ...guestData,
        },
      );
      expect(result).toBeNull();
    });

    it('should update a guest with minimal fields', async () => {
      const guestData = {
        name: 'Minimal Guest',
        type: 'guest' as GuestType,
      };
      convexMock.mutation.mockResolvedValue(null);

      await service.updateGuest(mockGuestId, guestData);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.guests.update,
        {
          id: mockGuestId,
          name: 'Minimal Guest',
          type: 'guest',
        },
      );
    });

    it('should throw when mutation fails', async () => {
      convexMock.mutation.mockRejectedValue(new Error('Guest not found'));

      await expect(
        service.updateGuest(mockGuestId, {name: 'Test', type: 'guest'}),
      ).rejects.toThrow('Guest not found');
    });
  });

  describe('removeGuest', () => {
    it('should remove a guest by ID', async () => {
      convexMock.mutation.mockResolvedValue(undefined);

      await service.removeGuest(mockGuestId);

      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.events.guests.remove,
        {
          id: mockGuestId,
        },
      );
    });

    it('should throw when guest not found', async () => {
      convexMock.mutation.mockRejectedValue(new Error('Guest not found'));

      await expect(service.removeGuest('nonexistent-id')).rejects.toThrow(
        'Guest not found',
      );
    });
  });

  describe('sendGuestTicket', () => {
    it('should send ticket email to guest', async () => {
      convexMock.client.action.mockResolvedValue(undefined);

      await service.sendGuestTicket(mockGuestId);

      expect(convexMock.client.action).toHaveBeenCalledWith(
        api.events.guest_actions.sendTicket,
        {
          guestId: mockGuestId,
        },
      );
    });

    it('should throw when guest has no email', async () => {
      convexMock.client.action.mockRejectedValue(
        new Error('Guest has no email'),
      );

      await expect(service.sendGuestTicket(mockGuestId)).rejects.toThrow(
        'Guest has no email',
      );
    });

    it('should throw when email service fails', async () => {
      convexMock.client.action.mockRejectedValue(
        new Error('Email service unavailable'),
      );

      await expect(service.sendGuestTicket(mockGuestId)).rejects.toThrow(
        'Email service unavailable',
      );
    });
  });

  describe('getTicketPdf', () => {
    it('should return PDF data URL for order', async () => {
      const mockPdfDataUrl = 'data:application/pdf;base64,JVBERi0xLjQ=';
      convexMock.action.mockResolvedValue(mockPdfDataUrl);

      const result = await service.getTicketPdf(mockOrderId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.tickets.actions['generateTicketPdf'],
        {
          orderId: mockOrderId,
        },
      );
      expect(result).toBe(mockPdfDataUrl);
    });

    it('should throw when order not found', async () => {
      convexMock.action.mockRejectedValue(new Error('Order not found'));

      await expect(service.getTicketPdf('invalid-order')).rejects.toThrow(
        'Order not found',
      );
    });
  });

  describe('getGuestTicketPdf', () => {
    it('should return PDF data URL for guest', async () => {
      const mockPdfDataUrl = 'data:application/pdf;base64,JVBERi0xLjQ=';
      convexMock.action.mockResolvedValue(mockPdfDataUrl);

      const result = await service.getGuestTicketPdf(mockGuestId);

      expect(convexMock.action).toHaveBeenCalledWith(
        api.events.guest_actions.getGuestTicketPdf,
        {
          guestId: mockGuestId,
        },
      );
      expect(result).toBe(mockPdfDataUrl);
    });

    it('should throw when guest not found', async () => {
      convexMock.action.mockRejectedValue(new Error('Guest not found'));

      await expect(service.getGuestTicketPdf('invalid-guest')).rejects.toThrow(
        'Guest not found',
      );
    });
  });
});
