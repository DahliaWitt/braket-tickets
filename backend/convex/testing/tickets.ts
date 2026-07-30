import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {buildTicketRosterProjection} from '../lib/ticket_roster_projection';
import {
  callerTrustSourceValidator,
  ticketStatusValidator,
  tierValidator,
} from '../lib/validators/ticketing';
import type {TicketTier} from '@shared/domain/ticket-tier';
import type {TicketStatus} from '@shared/domain/ticket-status';
import {testingMutation} from './wrappers';
import {insertSeedOrder} from './orders';

interface InsertSeedTicketArgs {
  userId?: Id<'users'>;
  eventId: Id<'events'>;
  orderId: Id<'ticket_orders'>;
  status: TicketStatus;
  tier: TicketTier;
  guestSessionId?: Id<'guest_sessions'>;
  checkedInAt?: number;
  checkedInBy?: Id<'users'>;
}

/* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test seed helper:
 * creates ticket fixtures and derived inventory/roster projections in one place. */
export async function insertSeedTicket(
  ctx: MutationCtx,
  args: InsertSeedTicketArgs,
): Promise<Id<'tickets'>> {
  const ticketId = await ctx.db.insert('tickets', {
    userId: args.userId,
    eventId: args.eventId,
    orderId: args.orderId,
    status: args.status,
    tier: args.tier,
    guestSessionId: args.guestSessionId,
    qrCode: `demo-qr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    checkedInAt: args.checkedInAt,
    checkedInBy: args.checkedInBy,
  });

  if (args.status === 'valid' || args.status === 'used') {
    const event = await ctx.db.get('events', args.eventId);
    if (event) {
      const patch: {
        checkedInCount?: number;
        lastCheckInAt?: number;
      } = {};
      if (args.checkedInAt !== undefined) {
        patch.checkedInCount = (event.checkedInCount ?? 0) + 1;
        if (!event.lastCheckInAt || args.checkedInAt > event.lastCheckInAt) {
          patch.lastCheckInAt = args.checkedInAt;
        }
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch('events', args.eventId, patch);
      }
      if (event.inventoryId) {
        const inventory = await ctx.db.get(
          'event_inventory',
          event.inventoryId,
        );
        if (inventory && inventory.eventId === args.eventId) {
          await ctx.db.patch('event_inventory', inventory._id, {
            soldCount: inventory.soldCount + 1,
          });
        }
      }
    }
  }

  const ticket = await ctx.db.get('tickets', ticketId);
  if (ticket) {
    const [user, guestSession, checkedInByUser] = await Promise.all([
      ticket.userId
        ? ctx.db.get('users', ticket.userId)
        : Promise.resolve(null),
      ticket.guestSessionId
        ? ctx.db.get('guest_sessions', ticket.guestSessionId)
        : Promise.resolve(null),
      ticket.checkedInBy
        ? ctx.db.get('users', ticket.checkedInBy)
        : Promise.resolve(null),
    ]);

    await ctx.db.patch(
      'tickets',
      ticketId,
      buildTicketRosterProjection({
        ticketId,
        status: ticket.status,
        attendeeName: user?.name ?? guestSession?.email ?? null,
        email: user?.email ?? guestSession?.email ?? null,
        checkedInByName: checkedInByUser?.name ?? null,
      }),
    );
  }

  return ticketId;
}
/* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

/**
 * Seeds a ticket for a user and event.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedTicket = testingMutation({
  args: {
    userId: v.id('users'),
    eventId: v.id('events'),
    orderId: v.optional(v.id('ticket_orders')),
    status: ticketStatusValidator,
    tier: tierValidator,
    guestSessionId: v.optional(v.id('guest_sessions')),
    trustSource: v.optional(callerTrustSourceValidator),
    trustViaOrganizerId: v.optional(v.id('organizers')),
    checkedInAt: v.optional(v.number()),
  },
  returns: v.id('tickets'),
  handler: async (ctx, args) => {
    let orderId = args.orderId;

    // Auto-create an order when none is provided so callers that only care
    // about the ticket itself do not have to create one manually.
    if (!orderId) {
      if (!args.trustSource) {
        throw new Error(
          'Test seed error: seedTicket auto-create requires explicit trustSource',
        );
      }

      const result = await insertSeedOrder(ctx, {
        userId: args.userId,
        eventId: args.eventId,
        amount: 0,
        quantity: 1,
        status: 'completed',
        tier: args.tier,
        guestSessionId: args.guestSessionId,
        trustSource: args.trustSource,
        trustViaOrganizerId: args.trustViaOrganizerId,
      });
      orderId = result.orderId;
    }

    return insertSeedTicket(ctx, {
      userId: args.userId,
      eventId: args.eventId,
      orderId,
      status: args.status,
      tier: args.tier,
      guestSessionId: args.guestSessionId,
      checkedInAt: args.checkedInAt,
    });
  },
});
