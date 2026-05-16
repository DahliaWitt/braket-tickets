import {describe, expect, it} from 'vitest';
import {api} from '../../_generated/api';
import {convexTest} from '../../setup.testing';
import {reservePrimaryInventoryHold} from './inventory';

async function seedEvent(t: ReturnType<typeof convexTest>) {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Order Inventory Test Org',
    isPlatformOrganizer: true,
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Order Inventory Test Event',
    price: 2500,
    totalTickets: 10,
    date: '2030-12-15',
    visibility: 'public',
    ticketSalesStatus: 'active',
    organizerId,
  });
  return await t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId);
    if (!event || !event.inventoryId) {
      throw new Error('Seeded event missing inventory');
    }
    return {event, inventoryId: event.inventoryId};
  });
}

describe('reservePrimaryInventoryHold', () => {
  it.each([0, -1, 1.5])(
    'rejects invalid quantity %s before changing held inventory',
    async (quantity) => {
      const t = convexTest();
      const {event, inventoryId} = await seedEvent(t);

      await t.run(async (ctx) => {
        await expect(
          reservePrimaryInventoryHold(
            {db: ctx.db},
            {
              event,
              quantity,
            },
          ),
        ).rejects.toThrow('Quantity must be a positive integer');
      });

      const inventory = await t.run(async (ctx) =>
        ctx.db.get('event_inventory', inventoryId),
      );
      expect(inventory?.heldCount).toBe(0);
    },
  );
});
