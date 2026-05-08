import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import {convexTest} from '../setup.testing';
import {calculateEventInventory} from './inventory';

describe('calculateEventInventory', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('reads the canonical event_inventory row', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const eventId = await t.mutation(
      api.testing.events.seedEventWithInventory,
      {
        organizerId,
        title: 'Inventory Event',
        totalTickets: 10,
        soldCount: 3,
        heldCount: 2,
      },
    );

    await t.run(async (ctx) => {
      const result = await calculateEventInventory(ctx.db, eventId, 10);
      expect(result).toEqual({
        soldCount: 3,
        remaining: 5,
      });
    });
  });

  it('fails closed when inventoryId is missing', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const eventId = await t.mutation(
      api.testing.events.seedEventWithoutInventory,
      {
        organizerId,
        title: 'Broken Event',
        totalTickets: 10,
      },
    );

    await t.run(async (ctx) => {
      await expect(
        calculateEventInventory(ctx.db, eventId, 10),
      ).rejects.toThrow('missing inventoryId');
    });
  });

  it('fails closed when the linked inventory points at the wrong event', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const {eventId} = await t.mutation(
      api.testing.events.seedEventWithMismatchedInventory,
      {organizerId},
    );

    await t.run(async (ctx) => {
      await expect(
        calculateEventInventory(ctx.db, eventId, 10),
      ).rejects.toThrow('invalid inventory linkage');
    });
  });
});
