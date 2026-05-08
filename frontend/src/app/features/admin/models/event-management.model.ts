import type {api} from '@convex/_generated/api';
import {type Doc, type Id} from '@convex/_generated/dataModel';
import type {FunctionReturnType} from 'convex/server';

// Backend wire types — keep locked to the registered Convex functions so the
// frontend never re-declares shapes the backend already owns.
type ManagementSummary = FunctionReturnType<
  typeof api.events.management.getManagementSummary
>;
type ManagementPurchases = FunctionReturnType<
  typeof api.events.management.getManagementPurchases
>;
type ManagementResale = FunctionReturnType<
  typeof api.events.management.getManagementResale
>;

// Derived from Convex schema — keep in sync automatically
export type GuestType = Doc<'guests'>['type'];
export type Guest = Doc<'guests'>;
export type EventTierPricingStats = FunctionReturnType<
  typeof api.events.pricing.getEventTierPricingStats
>;

// Derived from the narrowed backend wire types. Each surface is consumed
// independently by the event-management page's per-tab resources.
export type EventManagementPurchase = ManagementPurchases['purchases'][number];
export type ResaleListing = ManagementResale['resaleListings'][number];
export type ResaleMetrics = ManagementResale['resaleMetrics'];

// Frontend view models. Each extends the backend wire type with the
// frontend-only `id` alias on the event doc (used by routing helpers).
type EventWithId<E> = E & {id: Id<'events'>};

export type EventManagementSummary = Omit<ManagementSummary, 'event'> & {
  event: EventWithId<ManagementSummary['event']>;
};

export type EventManagementPurchases = Omit<ManagementPurchases, 'event'> & {
  event: EventWithId<ManagementPurchases['event']>;
};

export type EventManagementResale = Omit<ManagementResale, 'event'> & {
  event: EventWithId<ManagementResale['event']>;
};

/**
 * Narrowed shape accepted by the settlement export service. The CSV export
 * only needs a small subset of the full management payload, so the page
 * composes one at call time instead of leaking any single wire type.
 */
export interface SettlementExportInput {
  event: {
    _id: Id<'events'>;
    title: string;
    date: string;
    location?: string;
  };
  revenue: ManagementSummary['revenue'];
  revenueByTier: ManagementSummary['revenueByTier'];
  purchases: ManagementPurchases['purchases'];
  resaleMetrics: ManagementResale['resaleMetrics'];
  resaleListings: ManagementResale['resaleListings'];
}

export type TicketReminderAudience = FunctionReturnType<
  typeof api.events.reminders.getTicketReminderAudience
>;
export type TicketReminderSendResult = FunctionReturnType<
  typeof api.events.reminders.sendTicketPurchaseReminder
>;
