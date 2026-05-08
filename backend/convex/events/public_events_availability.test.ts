import {describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

async function createEventWithInventory(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    visibility: 'public' | 'public_viewable' | 'private';
    soldCount: number;
    heldCount: number;
    totalTickets: number;
  }> = {},
) {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Availability Event',
    price: 1000,
    totalTickets: overrides.totalTickets ?? 10,
    date: '2030-12-15T00:00:00.000Z',
    status: 'published',
    visibility: overrides.visibility ?? 'public',
    organizerId,
  });
  const inventoryId = await t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId as Id<'events'>);
    return event!.inventoryId!;
  });
  // Override soldCount/heldCount on the inventory if requested
  if (overrides.soldCount !== undefined || overrides.heldCount !== undefined) {
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- overriding inventory soldCount/heldCount to test availability math boundary conditions; seedEvent does not expose per-inventory counts
      await ctx.db.patch(inventoryId, {
        soldCount: overrides.soldCount ?? 0,
        heldCount: overrides.heldCount ?? 0,
      });
    });
  }
  return {eventId, inventoryId};
}

describe('events.getAvailability', () => {
  it('uses canonical inventory for public unauthenticated availability', async () => {
    const t = convexTest();
    const {eventId} = await createEventWithInventory(t, {
      soldCount: 6,
      heldCount: 2,
      totalTickets: 10,
    });

    const result = await t.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.isSoldOut).toBe(false);
    expect(result?.ticketSalesStatus).toBe('active');
    expect(result?.userTicketCount).toBe(0);
    expect('soldCount' in (result ?? {})).toBe(false);
  });

  it('marks the event sold out when sold + held consumes all capacity', async () => {
    const t = convexTest();
    const {eventId} = await createEventWithInventory(t, {
      soldCount: 7,
      heldCount: 3,
      totalTickets: 10,
    });

    const result = await t.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(result?.isSoldOut).toBe(true);
  });

  it('returns null for unauthenticated users on private events', async () => {
    const t = convexTest();
    const {eventId} = await createEventWithInventory(t, {
      visibility: 'private',
    });

    const result = await t.query(api.events.public.getAvailability, {
      eventId,
      now: Date.now(),
    });

    expect(result).toBeNull();
  });
});
