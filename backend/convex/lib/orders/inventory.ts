import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {throwOrderError} from './access';

type InventoryReadCtx = {
  db: QueryCtx['db'] | MutationCtx['db'];
};

export type EventWithInventory = {
  event: Doc<'events'>;
  inventory: Doc<'event_inventory'>;
};

export function getRemainingPrimaryInventory(
  event: Pick<Doc<'events'>, 'totalTickets'>,
  inventory: Pick<Doc<'event_inventory'>, 'soldCount' | 'heldCount'>,
): number {
  return Math.max(0, event.totalTickets - inventory.soldCount - inventory.heldCount);
}

export async function requireEventWithInventory(
  ctx: InventoryReadCtx,
  eventId: Id<'events'>,
): Promise<EventWithInventory> {
  const event = await ctx.db.get('events', eventId);
  if (!event) {
    throwOrderError('EVENT_UNAVAILABLE', 'Event not found');
  }

  if (!event.inventoryId) {
    throwOrderError(
      'INVALID_STATE',
      'Event inventory is not configured for this event',
    );
  }

  const inventory = await ctx.db.get('event_inventory', event.inventoryId);
  if (!inventory) {
    throwOrderError(
      'INVALID_STATE',
      'Event inventory row could not be loaded',
    );
  }

  if (inventory.eventId !== event._id) {
    throwOrderError(
      'INVALID_STATE',
      'Event inventory linkage is invalid',
    );
  }

  return {event, inventory};
}

export function assertInventoryCanCoverQuantity(args: {
  event: Pick<Doc<'events'>, 'totalTickets'>;
  inventory: Pick<Doc<'event_inventory'>, 'soldCount' | 'heldCount'>;
  quantity: number;
}): void {
  const remaining = getRemainingPrimaryInventory(args.event, args.inventory);
  if (remaining < args.quantity) {
    throwOrderError('SOLD_OUT', 'This event is sold out');
  }
}

export function assertCanSetEventTotalTickets(args: {
  totalTickets: number;
  inventory: Pick<Doc<'event_inventory'>, 'soldCount' | 'heldCount'>;
}): void {
  if (args.totalTickets < args.inventory.soldCount + args.inventory.heldCount) {
    throwOrderError(
      'INVALID_STATE',
      'Total tickets cannot be set below sold plus held inventory',
    );
  }
}

export async function assertEventTotalTicketsUpdateAllowed(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    totalTickets: number;
  },
): Promise<void> {
  const {inventory} = await requireEventWithInventory(
    {db: ctx.db},
    args.eventId,
  );
  assertCanSetEventTotalTickets({
    totalTickets: args.totalTickets,
    inventory,
  });
}
