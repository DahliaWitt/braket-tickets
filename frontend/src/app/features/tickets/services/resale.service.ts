import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {toEventId} from '@/utils/convex-id';
import type {FunctionReturnType} from 'convex/server';
import {logger} from '@/utils/logger';

export type ListTicketForResaleResult = FunctionReturnType<
  typeof api.resale.listings.listTicketForResale
>;
export type MyResaleListings = FunctionReturnType<
  typeof api.resale.listings.getMyResaleListings
>;
export type ResaleNotificationSubscriptionResult = FunctionReturnType<
  typeof api.resale.listings.subscribeToResaleNotifications
>;

/**
 * Service for ticket resale operations.
 *
 * Provides methods for sellers to list/cancel tickets, buyers to subscribe
 * to notifications, and shared queries for resale availability.
 */
@Injectable({
  providedIn: 'root',
})
export class ResaleService {
  private convex = injectConvex();

  /**
   * List a ticket for resale.
   * @param ticketId - The ticket to list
   * @returns The created listing ID
   */
  listTicketForResale(ticketId: string): Promise<ListTicketForResaleResult> {
    return this.runResaleOperation('list ticket for resale', () =>
      this.convex.mutation(api.resale.listings.listTicketForResale, {
        ticketId: this.toTicketId(ticketId),
      }),
    );
  }

  /**
   * Cancel an active resale listing.
   * @param listingId - The listing to cancel
   */
  async cancelResaleListing(listingId: string): Promise<void> {
    await this.runResaleOperation('cancel resale listing', () =>
      this.convex.mutation(api.resale.listings.cancelResaleListing, {
        listingId: this.toResaleListingId(listingId),
      }),
    );
  }

  /**
   * Get the current user's resale listings for an event.
   * @param eventId - The event to check
   * @returns Array of the user's resale listings
   */
  getMyResaleListings(eventId: string): Promise<MyResaleListings> {
    const convexEventId = toEventId(eventId);
    return this.runResaleOperation('get my resale listings', () =>
      this.convex.query(api.resale.listings.getMyResaleListings, {
        eventId: convexEventId,
      }),
    );
  }

  /**
   * Subscribe to resale notifications for an event.
   * @param eventId - The event to subscribe to
   * @returns The notification subscription ID
   */
  subscribeToResaleNotifications(
    eventId: string,
  ): Promise<ResaleNotificationSubscriptionResult> {
    const convexEventId = toEventId(eventId);
    return this.runResaleOperation('subscribe to resale notifications', () =>
      this.convex.mutation(api.resale.listings.subscribeToResaleNotifications, {
        eventId: convexEventId,
      }),
    );
  }

  /**
   * Unsubscribe from resale notifications for an event.
   * @param eventId - The event to unsubscribe from
   */
  async unsubscribeFromResaleNotifications(eventId: string): Promise<void> {
    const convexEventId = toEventId(eventId);
    await this.runResaleOperation('unsubscribe from resale notifications', () =>
      this.convex.mutation(
        api.resale.listings.unsubscribeFromResaleNotifications,
        {
          eventId: convexEventId,
        },
      ),
    );
  }

  private toTicketId(ticketId: string): Id<'tickets'> {
    return ticketId as Id<'tickets'>;
  }

  private toResaleListingId(listingId: string): Id<'resale_listings'> {
    return listingId as Id<'resale_listings'>;
  }

  private async runResaleOperation<T>(
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      logger.error(`[ResaleService] Failed to ${operation}`, error);
      throw error;
    }
  }
}
