import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {throwOrderError} from './access';
import {requireEventWithInventory} from './inventory';

type InventoryReconciliationReadCtx = {
  db: QueryCtx['db'] | MutationCtx['db'];
};

type InventoryReconciliationWriteCtx = {
  db: MutationCtx['db'];
};

export type InventoryHoldReconciliation = {
  eventId: Id<'events'>;
  inventoryId: Id<'event_inventory'>;
  title: string;
  storedHeldCount: number;
  openPrimaryHeldCount: number;
  drift: number;
};

async function calculateOpenPrimaryHeldCount(
  ctx: InventoryReconciliationReadCtx,
  eventId: Id<'events'>,
): Promise<number> {
  let cursor: string | null = null;
  let heldCount = 0;

  do {
    const page = await ctx.db
      .query('ticket_orders')
      .withIndex('by_event_and_state', (q) =>
        q.eq('eventId', eventId).eq('state', 'open'),
      )
      .paginate({numItems: 200, cursor});

    for (const order of page.page) {
      if (order.kind === 'primary') {
        heldCount += order.quantity;
      }
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);

  return heldCount;
}

export async function getPrimaryHeldInventoryReconciliation(
  ctx: InventoryReconciliationReadCtx,
  eventId: Id<'events'>,
): Promise<InventoryHoldReconciliation> {
  const {event, inventory} = await requireEventWithInventory(ctx, eventId);
  const openPrimaryHeldCount = await calculateOpenPrimaryHeldCount(
    ctx,
    eventId,
  );

  return {
    eventId: event._id,
    inventoryId: inventory._id,
    title: event.title,
    storedHeldCount: inventory.heldCount,
    openPrimaryHeldCount,
    drift: inventory.heldCount - openPrimaryHeldCount,
  };
}

export async function repairPrimaryHeldInventoryCount(
  ctx: InventoryReconciliationWriteCtx,
  args: {
    eventId: Id<'events'>;
    expectedStoredHeldCount?: number;
  },
): Promise<InventoryHoldReconciliation & {repaired: boolean}> {
  const reconciliation = await getPrimaryHeldInventoryReconciliation(
    ctx,
    args.eventId,
  );

  if (
    args.expectedStoredHeldCount !== undefined &&
    args.expectedStoredHeldCount !== reconciliation.storedHeldCount
  ) {
    throwOrderError(
      'INVALID_STATE',
      'Stored held count changed before inventory repair',
    );
  }

  if (reconciliation.drift === 0) {
    return {...reconciliation, repaired: false};
  }

  await ctx.db.patch('event_inventory', reconciliation.inventoryId, {
    heldCount: reconciliation.openPrimaryHeldCount,
  });

  return {
    ...reconciliation,
    storedHeldCount: reconciliation.openPrimaryHeldCount,
    drift: 0,
    repaired: true,
  };
}
