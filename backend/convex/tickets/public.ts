import {v} from 'convex/values';
import {internalQuery, query} from '../_generated/server';
import type {Doc} from '../_generated/dataModel';
import {getAuthUserId, requireUser} from '../lib/auth_identity';
import {canonicalEventDocValidator} from '../lib/events/validators';
import {toEventDocShape} from '../lib/events/read_models';
import {batchGetDocuments, batchGetUsers} from '../lib/batch_utils';
import {
  isVisibleInMyTicketsStatus,
  rosterStatusValidator,
  ticketStatusValidator,
  tierValidator,
} from '../lib/validators/ticketing';
import {canViewEventRoster, requireEventForRoster} from '../lib/access';
import {calculateResaleSellerSettlement} from '../lib/resale/helpers';

// Raw ticket document shape — matches the DB schema, no enriched fields.
// Used as the return validator for internal queries that return raw docs.
const ticketDocFields = {
  _id: v.id('tickets'),
  _creationTime: v.number(),
  userId: v.optional(v.id('users')),
  eventId: v.id('events'),
  orderId: v.optional(v.id('ticket_orders')),
  guestSessionId: v.optional(v.id('guest_sessions')),
  guestEmailLower: v.optional(v.string()),
  status: ticketStatusValidator,
  tier: tierValidator,
  qrCode: v.optional(v.string()),
  checkedInAt: v.optional(v.number()),
  checkedInBy: v.optional(v.id('users')),
  rosterAttendeeName: v.optional(v.string()),
  rosterAttendeeNameLower: v.optional(v.string()),
  rosterEmail: v.optional(v.union(v.string(), v.null())),
  rosterEmailLower: v.optional(v.union(v.string(), v.null())),
  rosterCheckedInByName: v.optional(v.union(v.string(), v.null())),
  rosterStatus: rosterStatusValidator,
  rosterIsActive: v.optional(v.boolean()),
  rosterSortKey: v.optional(v.string()),
};

// Enriched ticket shape — includes fields joined at read time (guestEmail from guest_sessions).
// Only used for public listByEvent which performs the join.
const ticketFields = {
  ...ticketDocFields,
  guestEmail: v.optional(v.string()),
};

const resaleSellerSettlementValidator = v.object({
  sellerPaidAmount: v.number(),
  resaleFeeCents: v.number(),
  sellerRefundAmount: v.number(),
  lostProcessingFeeCents: v.number(),
});

function toTicketUserShape(user: Doc<'users'>) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    image: user.image,
  };
}

/**
 * Retrieves all tickets belonging to the authenticated user.
 * Joins event data to each ticket for display purposes.
 *
 * @returns Array of tickets with an embedded `event` object.
 */
export const getMyTickets = query({
  args: {},
  returns: v.array(
    v.object({
      ...ticketFields,
      event: v.union(canonicalEventDocValidator, v.null()),
      resaleSellerSettlement: v.optional(resaleSellerSettlementValidator),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const allTickets = await ctx.db
      .query('tickets')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(500);

    const tickets = allTickets.filter((ticket) =>
      isVisibleInMyTicketsStatus(ticket.status),
    );

    const eventIds = tickets.map((ticket) => ticket.eventId);
    const orderIds = tickets
      .map((ticket) => ticket.orderId)
      .filter((orderId): orderId is NonNullable<typeof orderId> =>
        Boolean(orderId),
      );
    const [eventMap, orderMap] = await Promise.all([
      batchGetDocuments(ctx, 'events', eventIds),
      batchGetDocuments(ctx, 'ticket_orders', orderIds),
    ]);

    return tickets.map((ticket) => {
      const event = eventMap.get(ticket.eventId);
      const order = ticket.orderId ? orderMap.get(ticket.orderId) : undefined;
      return {
        ...ticket,
        event: event ? toEventDocShape(event) : null,
        ...(event && order
          ? {
              resaleSellerSettlement: calculateResaleSellerSettlement(
                order,
                undefined,
                event.resaleFeePct,
              ),
            }
          : {}),
      };
    });
  },
});

/**
 * Lists all tickets for a specific event.
 * Accessible by admins and door staff assigned to the event.
 * Joins user data to each ticket to display attendee names.
 *
 * @param eventId - The ID of the event to list tickets for.
 * @throws Error if the user is not an admin or assigned door staff.
 */
export const listByEvent = query({
  args: {eventId: v.id('events')},
  returns: v.array(
    v.object({
      ...ticketFields,
      user: v.union(
        v.object({
          _id: v.id('users'),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          image: v.optional(v.string()),
        }),
        v.null(),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireEventForRoster(ctx, args.eventId);

    const tickets = await ctx.db
      .query('tickets')
      .withIndex('by_event_status', (q) => q.eq('eventId', args.eventId))
      .take(10000);

    const userIds = tickets
      .map((ticket) => ticket.userId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined);
    const userMap = await batchGetUsers(ctx, userIds);

    const guestSessionIds = tickets
      .map((ticket) => ticket.guestSessionId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined);
    const guestSessionMap = await batchGetDocuments(
      ctx,
      'guest_sessions',
      guestSessionIds,
    );

    return tickets.map((ticket) => {
      const user = ticket.userId ? userMap.get(ticket.userId) : undefined;
      const guestSession = ticket.guestSessionId
        ? guestSessionMap.get(ticket.guestSessionId)
        : undefined;

      return {
        ...ticket,
        user: user ? toTicketUserShape(user) : null,
        guestEmail: guestSession?.email,
      };
    });
  },
});

/**
 * Retrieves a single ticket by its ID, including related Event and User data.
 * Used primarily for the ticket check-in page or detailed view.
 *
 * @param id - The ID of the ticket.
 * @returns Ticket object with `event` and `user` fields, or null if not found.
 */
export const get = query({
  args: {id: v.id('tickets')},
  returns: v.union(
    v.object({
      ...ticketFields,
      event: v.union(canonicalEventDocValidator, v.null()),
      user: v.union(
        v.object({
          _id: v.id('users'),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          image: v.optional(v.string()),
        }),
        v.null(),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    const ticket = await ctx.db.get('tickets', args.id);
    if (!ticket) return null;

    const [event, user] = await Promise.all([
      ctx.db.get('events', ticket.eventId),
      ticket.userId
        ? ctx.db.get('users', ticket.userId)
        : Promise.resolve(null),
    ]);

    if (ticket.userId === userId) {
      return {
        ...ticket,
        event: event ? toEventDocShape(event) : null,
        user: user ? toTicketUserShape(user) : null,
      };
    }

    if (!event || !(await canViewEventRoster(ctx, userId, event))) {
      return null;
    }

    return {
      ...ticket,
      event: event ? toEventDocShape(event) : null,
      user: user ? toTicketUserShape(user) : null,
    };
  },
});

/**
 * Internal helper to fetch a ticket by its ID.
 * Used by buyer-facing PDF download action.
 */
export const getByIdInternal = internalQuery({
  args: {id: v.id('tickets')},
  returns: v.union(v.object(ticketDocFields), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get('tickets', args.id);
  },
});

/**
 * Internal helper to find the first ticket associated with an order.
 *
 * @param orderId - The order to find a ticket for.
 * @returns The matching ticket document or null.
 */
export const getTicketByOrderInternal = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: v.union(v.object(ticketDocFields), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tickets')
      .withIndex('by_order', (q) => q.eq('orderId', args.orderId))
      .first();
  },
});

/**
 * Internal helper to get all tickets for a specific order.
 * Useful for multi-ticket purchases where one order maps to multiple ticket records.
 */
export const getTicketsByOrderInternal = internalQuery({
  args: {orderId: v.id('ticket_orders')},
  returns: v.array(v.object(ticketDocFields)),
  handler: async (ctx, args) => {
    // Bounded to one order's tickets (product design: 1–10 per order).
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    return await ctx.db
      .query('tickets')
      .withIndex('by_order', (q) => q.eq('orderId', args.orderId))
      .collect();
  },
});
