import {TestBed} from '@angular/core/testing';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {CONVEX} from 'convex-angular';
import {vi, describe, it, expect, beforeEach} from 'vitest';

import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';

describe('ResaleService', () => {
  let service: ResaleService;

  let convexMock: MockConvexClient;

  beforeEach(() => {
    convexMock = createMockConvexClient();
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [ResaleService, {provide: CONVEX, useValue: convexMock}],
    });

    service = TestBed.inject(ResaleService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('listTicketForResale', () => {
    it('should call mutation with ticket ID', async () => {
      convexMock.mutation.mockResolvedValue('listing-123');

      const result = await service.listTicketForResale('ticket-1');

      expect(convexMock.mutation).toHaveBeenCalledWith(expect.anything(), {
        ticketId: 'ticket-1',
      });
      expect(result).toBe('listing-123');
    });

    it('logs and rethrows mutation failures', async () => {
      const error = new Error('resale failed');
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      convexMock.mutation.mockRejectedValue(error);

      await expect(service.listTicketForResale('ticket-1')).rejects.toThrow(
        'resale failed',
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '%c[ERROR]%c [ResaleService] Failed to list ticket for resale',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cancelResaleListing', () => {
    it('should call mutation with listing ID', async () => {
      convexMock.mutation.mockResolvedValue(undefined);

      await service.cancelResaleListing('listing-1');

      expect(convexMock.mutation).toHaveBeenCalledWith(expect.anything(), {
        listingId: 'listing-1',
      });
    });
  });

  describe('getMyResaleListings', () => {
    it('should call query with event ID', async () => {
      const mockListings = [{_id: 'L1', ticketId: 'T1', status: 'listed'}];
      convexMock.client.query.mockResolvedValue(mockListings);

      const result = await service.getMyResaleListings('event-1');

      expect(convexMock.client.query).toHaveBeenCalledWith(expect.anything(), {
        eventId: 'event-1',
      });
      expect(result).toEqual(mockListings);
    });

    it('logs and rethrows query failures', async () => {
      const error = new Error('query failed');
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      convexMock.client.query.mockRejectedValue(error);

      await expect(service.getMyResaleListings('event-1')).rejects.toThrow(
        'query failed',
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '%c[ERROR]%c [ResaleService] Failed to get my resale listings',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('subscribeToResaleNotifications', () => {
    it('should call mutation with event ID', async () => {
      convexMock.mutation.mockResolvedValue('sub-123');

      const result = await service.subscribeToResaleNotifications('event-1');

      expect(convexMock.mutation).toHaveBeenCalledWith(expect.anything(), {
        eventId: 'event-1',
      });
      expect(result).toBe('sub-123');
    });
  });

  describe('unsubscribeFromResaleNotifications', () => {
    it('should call mutation with event ID', async () => {
      convexMock.mutation.mockResolvedValue(null);

      await service.unsubscribeFromResaleNotifications('event-1');

      expect(convexMock.mutation).toHaveBeenCalledWith(expect.anything(), {
        eventId: 'event-1',
      });
    });
  });
});
