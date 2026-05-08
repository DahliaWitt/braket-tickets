import {DatabaseReader} from '../_generated/server';
import {Id} from '../_generated/dataModel';

/**
 * Inventory result from calculating event availability.
 *
 * Note: this intentionally exposes `soldCount` + `remaining` only. The
 * underlying `event_inventory.heldCount` is folded into `remaining` — callers
 * that need the transient hold count should read it from the inventory row
 * directly (e.g. buildManagementSummary). Keeping `heldCount` off this
 * interface avoids a naming collision with buyer/order counts in management
 * reporting.
 */
export interface EventInventory {
  /** Number of tickets in 'valid' or 'used' status */
  soldCount: number;
  /** Remaining tickets available (clamped to 0, accounts for sold + held) */
  remaining: number;
}

/**
 * Load canonical event inventory from the linked inventory row.
 *
 * @param db - Database reader.
 * @param eventId - The event ID to calculate inventory for.
 * @param totalTickets - The `totalTickets` allowed for the event (event capacity).
 * @returns The canonical inventory snapshot for this event.
 */
export async function calculateEventInventory(
  db: DatabaseReader,
  eventId: Id<'events'>,
  totalTickets: number,
): Promise<EventInventory> {
  const event = await db.get('events', eventId);
  if (!event?.inventoryId) {
    throw new Error(`Event ${eventId} is missing inventoryId`);
  }

  const inventory = await db.get('event_inventory', event.inventoryId);
  if (!inventory || inventory.eventId !== eventId) {
    throw new Error(`Event ${eventId} has invalid inventory linkage`);
  }

  const remaining = Math.max(
    0,
    totalTickets - inventory.soldCount - inventory.heldCount,
  );

  return {
    soldCount: inventory.soldCount,
    remaining,
  };
}
