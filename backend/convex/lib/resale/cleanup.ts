import type {MutationCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {reopenResaleListing} from './helpers';

export async function cleanupStaleResaleListingsState(
  ctx: MutationCtx,
): Promise<null> {
  const pendingListings = await ctx.db
    .query('resale_listings')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))
    .take(200);

  await Promise.all(
    pendingListings.map(async (listing) => {
      if (!listing.pendingOrderId) {
        await reopenResaleListing(ctx.db, listing._id);
        return;
      }

      const order = await ctx.db.get('ticket_orders', listing.pendingOrderId);
      if (!order || order.state === 'released') {
        await reopenResaleListing(ctx.db, listing._id);
      }
    }),
  );

  if (pendingListings.length === 200) {
    await ctx.scheduler.runAfter(0, internal.resale.listings.cleanupStaleResaleListings, {});
  }

  return null;
}
