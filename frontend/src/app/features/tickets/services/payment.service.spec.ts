import '../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ConvexError} from 'convex/values';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

import {AuthService} from '@/core/services/auth.service';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {
  createMockAuthService,
  createMockConvexClient,
  type MockAuthService,
  type MockConvexClient,
} from '../../../../testing/mock-types';

describe('PaymentService', () => {
  let service: PaymentService;
  let convexClientMock: MockConvexClient;
  let authServiceMock: MockAuthService;

  const flushReactiveWork = async (): Promise<void> => {
    TestBed.tick();
    await Promise.resolve();
  };

  beforeEach(() => {
    localStorage.clear();
    convexClientMock = createMockConvexClient();
    authServiceMock = createMockAuthService({
      user: {
        _id: 'u1' as Id<'users'>,
        _creationTime: Date.now(),
        name: 'Test User',
        email: 'test@example.com',
      },
      isAuthenticated: true,
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        PaymentService,
        {provide: CONVEX, useValue: convexClientMock},
        {provide: AuthService, useValue: authServiceMock},
      ],
    });

    service = TestBed.inject(PaymentService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startPrimaryCheckoutSession', () => {
    it('opens an order and starts checkout', async () => {
      convexClientMock.mutation.mockResolvedValueOnce({
        orderId: 'order_123',
        expiresAt: Date.now() + 1_000,
        state: 'open',
      });
      convexClientMock.action.mockResolvedValueOnce({
        orderId: 'order_123',
        stripeCheckoutSessionId: 'cs_123',
        clientSecret: 'cs_secret_123',
        expiresAt: Date.now() + 1_000,
      });

      const result = await service.startPrimaryCheckoutSession(
        'event_1',
        2,
        'regular',
        2000,
        'light',
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.orders.core.open,
        expect.objectContaining({
          eventId: 'event_1',
          quantity: 2,
          tier: 'regular',
          totalAmount: 2000,
        }),
      );
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.orders.core.startCheckout,
        expect.objectContaining({orderId: 'order_123', checkoutTheme: 'light'}),
      );
      expect(result).toMatchObject({
        orderId: 'order_123',
        stripeCheckoutSessionId: 'cs_123',
        clientSecret: 'cs_secret_123',
      });
      expect(result.expiresAt).toEqual(expect.any(Number));
    });

    it('maps SOLD_OUT to a user-friendly message', async () => {
      convexClientMock.mutation.mockRejectedValue(
        new ConvexError({code: 'SOLD_OUT'}),
      );

      await expect(
        service.startPrimaryCheckoutSession(
          'event_1',
          1,
          'regular',
          1000,
          'light',
        ),
      ).rejects.toThrow('This event is sold out');
    });
  });

  describe('startGuestCheckoutSession', () => {
    it('opens a guest order and starts checkout with the session token', async () => {
      convexClientMock.mutation.mockResolvedValueOnce({
        orderId: 'order_guest_123',
        expiresAt: Date.now() + 1_000,
        state: 'open',
      });
      convexClientMock.action.mockResolvedValueOnce({
        orderId: 'order_guest_123',
        stripeCheckoutSessionId: 'cs_guest_123',
        clientSecret: 'cs_guest_secret_123',
        expiresAt: Date.now() + 1_000,
      });

      const result = await service.startGuestCheckoutSession(
        'event_1',
        1,
        'supporter',
        5000,
        'guest_session_token',
        'dark',
        true,
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.orders.core.openForGuest,
        expect.objectContaining({
          sessionToken: 'guest_session_token',
          eventId: 'event_1',
          quantity: 1,
          tier: 'supporter',
          totalAmount: 5000,
          termsAccepted: true,
        }),
      );
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.orders.core.startCheckout,
        expect.objectContaining({
          orderId: 'order_guest_123',
          checkoutTheme: 'dark',
          sessionToken: 'guest_session_token',
        }),
      );
      expect(result.clientSecret).toBe('cs_guest_secret_123');
    });
  });

  describe('startResaleCheckoutSession', () => {
    it('opens a resale order and starts checkout', async () => {
      convexClientMock.mutation.mockResolvedValueOnce({
        orderId: 'order_resale_123',
        expiresAt: Date.now() + 1_000,
        state: 'open',
      });
      convexClientMock.action.mockResolvedValueOnce({
        orderId: 'order_resale_123',
        stripeCheckoutSessionId: 'cs_resale_123',
        clientSecret: 'cs_resale_secret_123',
        expiresAt: Date.now() + 1_000,
      });

      const result = await service.startResaleCheckoutSession(
        'event_1',
        'regular',
        1200,
        'light',
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.orders.core.openResale,
        expect.objectContaining({
          eventId: 'event_1',
          tier: 'regular',
          totalAmount: 1200,
        }),
      );
      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.orders.core.startCheckout,
        expect.objectContaining({
          orderId: 'order_resale_123',
          checkoutTheme: 'light',
        }),
      );
      expect(result.clientSecret).toBe('cs_resale_secret_123');
    });
  });

  describe('syncCheckoutSession', () => {
    it('calls the order sync action', async () => {
      convexClientMock.action.mockResolvedValue({
        orderId: 'order_123',
        state: 'completed',
        kind: 'primary',
        expiresAt: Date.now() + 1_000,
        completedAt: Date.now(),
      });

      const result = await service.syncCheckoutSession('cs_123', 'guest_token');

      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.orders.core.syncCheckoutSession,
        {
          checkoutSessionId: 'cs_123',
          sessionToken: 'guest_token',
        },
      );
      expect(result.state).toBe('completed');
    });
  });

  describe('getCheckoutStatus', () => {
    it('calls the order status query', async () => {
      convexClientMock.query.mockResolvedValue({
        orderId: 'order_123',
        state: 'open',
        kind: 'primary',
        expiresAt: Date.now() + 1_000,
      });

      const result = await service.getCheckoutStatus(
        'order_123',
        'guest_token',
      );

      expect(convexClientMock.query).toHaveBeenCalledWith(
        api.orders.core.getCheckoutStatus,
        {
          orderId: 'order_123',
          sessionToken: 'guest_token',
        },
      );
      expect(result.state).toBe('open');
    });
  });

  describe('initiateGuestSession', () => {
    it('passes through the stored guest session token when one exists for the email', async () => {
      convexClientMock.action.mockResolvedValue({sessionToken: 'sess_123'});
      localStorage.setItem(
        'bt-guest-session-token:guest@example.com',
        'existing_guest_session',
      );

      const result = await service.initiateGuestSession(
        'guest@example.com',
        'magic_token_abc',
        'event_123' as never,
      );

      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: 'guest@example.com',
          eventId: 'event_123',
          existingSessionToken: 'existing_guest_session',
          magicLinkToken: 'magic_token_abc',
        },
      );
      expect(
        localStorage.getItem('bt-guest-session-token:guest@example.com'),
      ).toBe('sess_123');
      expect(result).toEqual({sessionToken: 'sess_123'});
    });

    it('passes through the magic link token when provided', async () => {
      convexClientMock.action.mockResolvedValue({sessionToken: 'sess_magic'});

      const result = await service.initiateGuestSession(
        'guest@example.com',
        'magic_token_abc',
        'event_123' as never,
      );

      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: 'guest@example.com',
          eventId: 'event_123',
          magicLinkToken: 'magic_token_abc',
        },
      );
      expect(
        localStorage.getItem('bt-guest-session-token:guest@example.com'),
      ).toBe('sess_magic');
      expect(result).toEqual({sessionToken: 'sess_magic'});
    });

    it('omits magicLinkToken when one is not provided', async () => {
      convexClientMock.action.mockResolvedValue({sessionToken: 'sess_456'});
      await service.initiateGuestSession(' First@Example.com ');

      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email: ' First@Example.com ',
        },
      );
      expect(
        localStorage.getItem('bt-guest-session-token:first@example.com'),
      ).toBe('sess_456');
    });
  });

  describe('rememberGuestSessionToken', () => {
    it('stores a guest session token under the normalized email key', () => {
      service.rememberGuestSessionToken(' Guest@Example.com ', 'resume_token');

      expect(
        localStorage.getItem('bt-guest-session-token:guest@example.com'),
      ).toBe('resume_token');
    });
  });

  describe('claim free tickets', () => {
    it('claims a free ticket for authenticated users through orders.claimFreeTicket', async () => {
      convexClientMock.mutation.mockResolvedValue({
        success: true,
        orderId: 'order_123',
      });

      const result = await service.claimFreeTicket('event_1', 1, 'regular');

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.orders.core.claimFreeTicket,
        {
          eventId: 'event_1',
          quantity: 1,
          tier: 'regular',
        },
      );
      expect(result.success).toBe(true);
    });

    it('claims a free ticket for guests through orders.claimFreeTicketAsGuest', async () => {
      convexClientMock.mutation.mockResolvedValue({
        success: true,
        orderId: 'order_456',
      });

      const result = await service.claimFreeTicketAsGuest(
        'event_1',
        1,
        'notaflof',
        'guest_token',
        true,
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.orders.core.claimFreeTicketAsGuest,
        {
          eventId: 'event_1',
          quantity: 1,
          tier: 'notaflof',
          sessionToken: 'guest_token',
          termsAccepted: true,
        },
      );
      expect(result.success).toBe(true);
    });
  });

  describe('getMyTickets', () => {
    it('maps ticket rows from Convex', async () => {
      const mockTickets = [
        {
          _id: 'ticket_1',
          _creationTime: Date.now(),
          eventId: 'e1',
          userId: 'u1',
          status: 'valid',
          tier: 'regular',
        },
      ];
      convexClientMock.query.mockResolvedValue(mockTickets);

      const tickets = await service.getMyTickets();

      expect(convexClientMock.query).toHaveBeenCalledWith(
        api.tickets.public.getMyTickets,
        {},
      );
      expect(tickets.length).toBe(1);
      expect(tickets[0]._id).toBe('ticket_1');
    });
  });

  describe('tickets resource refresh scheduling', () => {
    it('defers auth-scope refetches until the active query settles', async () => {
      TestBed.resetTestingModule();

      const localConvexMock = createMockConvexClient();
      const localAuthMock: MockAuthService = createMockAuthService({
        user: {
          _id: 'u1' as Id<'users'>,
          _creationTime: Date.now(),
          name: 'Test User',
          email: 'test@example.com',
        },
        isAuthenticated: true,
      });

      const firstUnsubscribe = vi.fn();
      const secondUnsubscribe = vi.fn();
      let firstOnData: ((value: unknown) => void) | undefined;
      let secondOnData: ((value: unknown) => void) | undefined;

      localConvexMock.onUpdate
        .mockImplementationOnce(
          (_query, _args, onData: (value: unknown) => void) => {
            firstOnData = onData;
            return firstUnsubscribe;
          },
        )
        .mockImplementationOnce(
          (_query, _args, onData: (value: unknown) => void) => {
            secondOnData = onData;
            return secondUnsubscribe;
          },
        );
      localConvexMock.client.onUpdate = localConvexMock.onUpdate;

      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          PaymentService,
          {provide: CONVEX, useValue: localConvexMock},
          {provide: AuthService, useValue: localAuthMock},
        ],
      });

      const localService = TestBed.inject(PaymentService);
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(1);

      localAuthMock.user.set({
        _id: 'u2' as Id<'users'>,
        _creationTime: Date.now(),
        name: 'Next User',
        email: 'next@example.com',
      });
      await flushReactiveWork();

      expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);
      expect(localService.ticketsResource.value()).toEqual([]);

      firstOnData?.([
        {
          _id: 'ticket_stale',
          _creationTime: Date.now(),
          eventId: 'event_1',
          userId: 'u1',
          status: 'valid',
          tier: 'regular',
        },
      ]);
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);
      expect(localService.ticketsResource.value()).toEqual([]);

      secondOnData?.([
        {
          _id: 'ticket_fresh',
          _creationTime: Date.now(),
          eventId: 'event_2',
          userId: 'u2',
          status: 'valid',
          tier: 'supporter',
        },
      ]);
      await flushReactiveWork();

      expect(secondUnsubscribe).not.toHaveBeenCalled();
      expect(localService.ticketsResource.value()).toEqual([
        expect.objectContaining({
          _id: 'ticket_fresh',
          userId: 'u2',
        }),
      ]);
    });

    it('defers manual refreshes until the active query settles', async () => {
      TestBed.resetTestingModule();

      const localConvexMock = createMockConvexClient();
      const localAuthMock: MockAuthService = createMockAuthService({
        user: {
          _id: 'u1' as Id<'users'>,
          _creationTime: Date.now(),
          name: 'Test User',
          email: 'test@example.com',
        },
        isAuthenticated: true,
      });

      const firstUnsubscribe = vi.fn();
      let firstOnData: ((value: unknown) => void) | undefined;

      localConvexMock.onUpdate
        .mockImplementationOnce(
          (_query, _args, onData: (value: unknown) => void) => {
            firstOnData = onData;
            return firstUnsubscribe;
          },
        )
        .mockImplementationOnce(() => () => void 0);
      localConvexMock.client.onUpdate = localConvexMock.onUpdate;

      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          PaymentService,
          {provide: CONVEX, useValue: localConvexMock},
          {provide: AuthService, useValue: localAuthMock},
        ],
      });

      const localService = TestBed.inject(PaymentService);
      await flushReactiveWork();

      localService.triggerRefresh();
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(1);
      expect(localService.ticketsResource.value()).toEqual([]);

      firstOnData?.([
        {
          _id: 'ticket_1',
          _creationTime: Date.now(),
          eventId: 'event_1',
          userId: 'u1',
          status: 'valid',
          tier: 'regular',
        },
      ]);
      await flushReactiveWork();

      expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);
      expect(localService.ticketsResource.value()).toEqual([]);
    });

    it('clears queued refresh state when auth scope is skipped before the query settles', async () => {
      TestBed.resetTestingModule();

      const localConvexMock = createMockConvexClient();
      const localAuthMock: MockAuthService = createMockAuthService({
        user: {
          _id: 'u1' as Id<'users'>,
          _creationTime: Date.now(),
          name: 'Test User',
          email: 'test@example.com',
        },
        isAuthenticated: true,
      });

      const firstUnsubscribe = vi.fn();
      let firstOnData: ((value: unknown) => void) | undefined;
      let secondOnData: ((value: unknown) => void) | undefined;

      localConvexMock.onUpdate
        .mockImplementationOnce(
          (_query, _args, onData: (value: unknown) => void) => {
            firstOnData = onData;
            return firstUnsubscribe;
          },
        )
        .mockImplementationOnce(
          (_query, _args, onData: (value: unknown) => void) => {
            secondOnData = onData;
            return () => void 0;
          },
        );
      localConvexMock.client.onUpdate = localConvexMock.onUpdate;

      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          PaymentService,
          {provide: CONVEX, useValue: localConvexMock},
          {provide: AuthService, useValue: localAuthMock},
        ],
      });

      const localService = TestBed.inject(PaymentService);
      await flushReactiveWork();

      localService.triggerRefresh();
      await flushReactiveWork();

      localAuthMock.isAuthenticated.set(false);
      localAuthMock.user.set(null);
      await flushReactiveWork();

      expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
      expect(localService.ticketsResource.value()).toEqual([]);

      localAuthMock.isAuthenticated.set(true);
      localAuthMock.user.set({
        _id: 'u1' as Id<'users'>,
        _creationTime: Date.now(),
        name: 'Test User',
        email: 'test@example.com',
      });
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);

      firstOnData?.([
        {
          _id: 'ticket_stale',
          _creationTime: Date.now(),
          eventId: 'event_1',
          userId: 'u1',
          status: 'valid',
          tier: 'regular',
        },
      ]);
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);
      expect(localService.ticketsResource.value()).toEqual([]);

      secondOnData?.([
        {
          _id: 'ticket_fresh',
          _creationTime: Date.now(),
          eventId: 'event_2',
          userId: 'u1',
          status: 'valid',
          tier: 'supporter',
        },
      ]);
      await flushReactiveWork();

      expect(localConvexMock.onUpdate).toHaveBeenCalledTimes(2);
      expect(localService.ticketsResource.value()).toEqual([
        expect.objectContaining({
          _id: 'ticket_fresh',
          userId: 'u1',
        }),
      ]);
    });
  });

  describe('refundTicket', () => {
    it('calls the refund ticket action', async () => {
      convexClientMock.action.mockResolvedValue({success: true});

      const result = await service.refundTicket('ticket_1');

      expect(convexClientMock.action).toHaveBeenCalledWith(
        api.payments.refunds.refundTicket,
        {
          ticketId: 'ticket_1',
        },
      );
      expect(result).toBe(true);
    });
  });

  describe('extractErrorMessage via live entrypoints', () => {
    it('returns the explicit message from ConvexError object data', async () => {
      convexClientMock.mutation.mockRejectedValue(
        new ConvexError({
          code: 'RESERVATION_EXPIRED',
          message: 'Invalid or expired session',
        }),
      );

      await expect(
        service.startPrimaryCheckoutSession(
          'event_1',
          1,
          'regular',
          1000,
          'light',
        ),
      ).rejects.toThrow('Invalid or expired session');
    });

    it('maps PRICE_MISMATCH to a user-friendly message', async () => {
      convexClientMock.mutation.mockRejectedValue(
        new ConvexError({code: 'PRICE_MISMATCH'}),
      );

      await expect(
        service.startPrimaryCheckoutSession(
          'event_1',
          1,
          'regular',
          1000,
          'light',
        ),
      ).rejects.toThrow('Price has changed, please refresh');
    });

    it('maps RATE_LIMITED to a user-friendly message', async () => {
      convexClientMock.mutation.mockRejectedValue(
        new ConvexError({code: 'RATE_LIMITED'}),
      );

      await expect(
        service.startPrimaryCheckoutSession(
          'event_1',
          1,
          'regular',
          1000,
          'light',
        ),
      ).rejects.toThrow('Too many attempts, try again later');
    });

    it('returns the raw code when no mapping exists', async () => {
      convexClientMock.mutation.mockRejectedValue(
        new ConvexError({code: 'UNKNOWN_CODE'}),
      );

      await expect(
        service.startPrimaryCheckoutSession(
          'event_1',
          1,
          'regular',
          1000,
          'light',
        ),
      ).rejects.toThrow('UNKNOWN_CODE');
    });
  });

  it('skips realtime ticket subscription when unauthenticated', () => {
    const localConvexMock = createMockConvexClient();
    const localAuthMock = createMockAuthService({
      user: null,
      isAuthenticated: false,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        PaymentService,
        {provide: CONVEX, useValue: localConvexMock},
        {provide: AuthService, useValue: localAuthMock},
      ],
    });

    const unauthenticatedService = TestBed.inject(PaymentService);

    expect(localConvexMock.client.onUpdate).not.toHaveBeenCalled();
    expect(unauthenticatedService.ticketsResource.value()).toEqual([]);
  });
});
