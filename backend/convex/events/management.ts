import {v} from 'convex/values';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import {
  adminList as adminListImpl,
  continueCancelledEventOrderCleanup as continueCancelledEventOrderCleanupImpl,
  continueEventRemovalCleanup as continueEventRemovalCleanupImpl,
  create as createImpl,
  getForEdit as getForEditImpl,
  getInternal as getInternalImpl,
  getManagementPurchases as getManagementPurchasesImpl,
  getManagementPurchasesInternal as getManagementPurchasesInternalImpl,
  getManagementResale as getManagementResaleImpl,
  getManagementResaleInternal as getManagementResaleInternalImpl,
  getManagementSummary as getManagementSummaryImpl,
  getManagementSummaryInternal as getManagementSummaryInternalImpl,
  remove as removeImpl,
  update as updateImpl,
} from './_impl/management_handlers';
import {
  adminEventListItemValidator,
  createEventArgs,
  eventDocValidator,
  eventEditDetailValidator,
  managementPurchasesValidator,
  managementResaleValidator,
  managementSummaryValidator,
  updateEventArgs,
} from '../lib/events/validators';

export type {
  ManagementPurchases,
  ManagementResaleData,
  ManagementSummary,
} from './_impl/types';

/**
 * List events for admin dashboard.
 *
 * Admin-only query that returns events regardless of status (draft,
 * published, cancelled). Platform admins may omit `organizerId` for the
 * global dashboard; community-admin surfaces should pass `organizerId` to
 * keep the list scoped to the active community.
 *
 * @throws ConvexError if user is not authenticated or not admin
 * @returns Array of visible events with posterUrl resolved
 */
export const adminList = query({
  args: {organizerId: v.optional(v.id('organizers'))},
  returns: v.array(adminEventListItemValidator),
  handler: adminListImpl,
});

/**
 * Get event for editing — community-scoped.
 *
 * Unlike `get` (public, returns any published event), this query enforces
 * event edit authorization via the event edit preamble, preventing
 * cross-community data leakage in the admin edit page.
 */
export const getForEdit = query({
  args: {id: v.id('events')},
  returns: eventEditDetailValidator,
  handler: getForEditImpl,
});

/**
 * Internal query powering the summary/check-in surface of the admin event
 * management page.
 *
 * Returns: event details, canonical sold/held/remaining/isSoldOut, tier counts,
 * revenue totals, revenue-by-tier, sales-by-day, and check-in stats.
 *
 * @internal Used by getManagementSummary action.
 */
export const getManagementSummaryInternal = internalQuery({
  args: {eventId: v.id('events'), requestUserId: v.id('users')},
  returns: managementSummaryValidator,
  handler: getManagementSummaryInternalImpl,
});

/**
 * Event-manager action returning the summary/check-in payload. Writes the
 * `event.management.view` audit log via the shared gate.
 */
export const getManagementSummary = action({
  args: {eventId: v.id('events')},
  returns: managementSummaryValidator,
  handler: getManagementSummaryImpl,
});

/**
 * Internal query powering the purchases surface of the admin event
 * management page.
 *
 * @internal Used by getManagementPurchases action.
 */
export const getManagementPurchasesInternal = internalQuery({
  args: {eventId: v.id('events'), requestUserId: v.id('users')},
  returns: managementPurchasesValidator,
  handler: getManagementPurchasesInternalImpl,
});

/**
 * Event-manager action returning completed purchase rows (with financial
 * summaries, ticket summaries, and buyer fields). Writes the
 * `event.management.view` audit log via the shared gate so buyer-PII access
 * is always logged. Bounded by the per-surface dataset limits — throws
 * `MANAGEMENT_DATA_TOO_LARGE` when exceeded.
 */
export const getManagementPurchases = action({
  args: {eventId: v.id('events')},
  returns: managementPurchasesValidator,
  handler: getManagementPurchasesImpl,
});

/**
 * Internal query powering the resale surface of the admin event
 * management page.
 *
 * @internal Used by getManagementResale action.
 */
export const getManagementResaleInternal = internalQuery({
  args: {eventId: v.id('events'), requestUserId: v.id('users')},
  returns: managementResaleValidator,
  handler: getManagementResaleInternalImpl,
});

/**
 * Event-manager action returning the resale surface: resale listings, resale
 * metrics, and the resale notification subscriber count. Writes the
 * `event.management.view` audit log via the shared gate so seller/buyer PII
 * access is always logged.
 */
export const getManagementResale = action({
  args: {eventId: v.id('events')},
  returns: managementResaleValidator,
  handler: getManagementResaleImpl,
});

/**
 * Create a new event.
 *
 * Admin-only mutation to create events. Validates input lengths and
 * logs creation to adminAuditLogs. Supports sliding scale pricing
 * via sliderConfig.
 *
 * @param title - Event title (max 200 chars)
 * @param description - Optional event description (max 5000 chars)
 * @param date - Event date as ISO string
 * @param location - Optional venue/location (max 500 chars)
 * @param price - Base ticket price in cents
 * @param totalTickets - Total ticket inventory
 * @param status - Event visibility status
 * @param poster - Optional storage ID for event poster image
 * @param organizerId - Community reference
 * @param supporterDefaultPrice - Optional default price for supporter tier
 * @param maxTicketsPerUser - Optional limit on tickets per user
 * @param sliderConfig - Optional sliding scale pricing configuration
 * @throws Error if not authenticated, not admin, or validation fails
 * @returns Created event document ID
 */
export const create = mutation({
  args: createEventArgs,
  returns: v.id('events'),
  handler: createImpl,
});

/**
 * Update an existing event.
 *
 * Staff-only mutation for partial event updates. All fields except id are optional.
 * Validates input lengths and logs updates to adminAuditLogs.
 *
 * Organizer reassignment is a tenant-boundary operation and requires destination
 * community admin access via the centralized access layer.
 *
 * @param id - Event document ID to update
 * @param title - Optional new title (max 200 chars)
 * @param description - Optional new description (max 5000 chars)
 * @param date - Optional new event date
 * @param status - Optional new visibility status (draft/published/cancelled)
 * @param totalTickets - Optional new inventory count
 * @param price - Optional new base price in cents
 * @param location - Optional new location (max 500 chars)
 * @param poster - Optional new poster storage ID
 * @param organizerId - Optional community to reassign
 * @param ticketSalesStatus - Optional sales status (active/paused/ended)
 * @param supporterDefaultPrice - Optional supporter tier default price
 * @param maxTicketsPerUser - Optional per-user ticket limit
 * @param slidingScaleEnabled - Optional sliding scale toggle
 * @param slidingScaleMin - Optional sliding scale minimum
 * @param slidingScaleMax - Optional sliding scale maximum
 * @param sliderConfig - Optional combined slider configuration
 * @throws Error if not authenticated, unauthorized, or validation fails
 */
export const update = mutation({
  args: updateEventArgs,
  returns: v.null(),
  handler: updateImpl,
});

/**
 * Delete an event.
 *
 * Staff-only mutation to permanently delete an event. Prevents deletion
 * if the event has any associated tickets (to preserve purchase history).
 * Logs deletion to adminAuditLogs.
 *
 * @param id - Event document ID to delete
 * @throws Error if not authenticated, unauthorized, or event has tickets
 */
export const remove = mutation({
  args: {id: v.id('events')},
  returns: v.null(),
  handler: removeImpl,
});

export const continueCancelledEventOrderCleanup = internalMutation({
  args: {eventId: v.id('events')},
  returns: v.null(),
  handler: continueCancelledEventOrderCleanupImpl,
});

export const continueEventRemovalCleanup = internalMutation({
  args: {
    adminId: v.id('users'),
    eventId: v.id('events'),
  },
  returns: v.null(),
  handler: continueEventRemovalCleanupImpl,
});

/**
 * Internal query to fetch an event by ID.
 *
 * No authentication or authorization checks - for internal use only
 * (e.g., by other Convex functions that have already verified permissions).
 *
 * @internal
 * @param id - Event document ID
 * @returns Event document or null if not found
 */
export const getInternal = internalQuery({
  args: {id: v.id('events')},
  returns: v.union(v.null(), eventDocValidator),
  handler: getInternalImpl,
});
