import {v} from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import {internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import {requireUser} from '../lib/auth_identity';
import {canReceiveTicketTransferForUser} from '../lib/access';
import {
  throwForbidden,
  throwInvalidInput,
  throwInvalidState,
  throwNotFound,
} from '../lib/errors';
import {rateLimiter} from '../lib/rate_limits';
import {isValidTicketStatus, tierValidator} from '../lib/validators/ticketing';
import {buildTicketRosterProjection} from '../lib/ticket_roster_projection';
import {generateTicketScanCode} from '../lib/ticket_scan_codes';

const RECIPIENT_NOT_ELIGIBLE_MESSAGE =
  'No vetted member was found for that email.';
const ACTIVE_RESALE_LISTING_STATUSES = ['listed', 'pending'] as const;

const transferRecipientValidator = v.object({
  userId: v.id('users'),
  email: v.string(),
  name: v.optional(v.string()),
});

const ticketTransferEmailContextValidator = v.object({
  ticket: v.object({
    _id: v.id('tickets'),
    eventId: v.id('events'),
    tier: tierValidator,
    qrCode: v.optional(v.string()),
  }),
  event: v.object({
    _id: v.id('events'),
    title: v.string(),
    date: v.string(),
    location: v.optional(v.string()),
  }),
  organizer: v.union(
    v.object({
      name: v.string(),
      slug: v.optional(v.string()),
      codeOfConduct: v.optional(v.string()),
    }),
    v.null(),
  ),
  recipient: v.object({
    _id: v.id('users'),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
  sender: v.object({
    _id: v.id('users'),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findUserByEmail(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  email: string,
): Promise<Doc<'users'> | null> {
  return await ctx.db
    .query('users')
    .withIndex('email', (q) => q.eq('email', normalizeEmail(email)))
    .unique();
}

async function requireNoActiveResaleListing(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  ticketId: Id<'tickets'>,
): Promise<void> {
  const activeListings = await Promise.all(
    ACTIVE_RESALE_LISTING_STATUSES.map((status) =>
      ctx.db
        .query('resale_listings')
        .withIndex('by_ticket_and_status', (q) =>
          q.eq('ticketId', ticketId).eq('status', status),
        )
        .first(),
    ),
  );
  if (activeListings.some((listing) => listing !== null)) {
    throwInvalidState(
      'Cancel the resale listing before transferring this ticket.',
    );
  }
}

async function validateTransferTicket(
  ctx: QueryCtx | MutationCtx,
  args: {ticketId: Id<'tickets'>; senderId: Id<'users'>},
): Promise<{ticket: Doc<'tickets'>; event: Doc<'events'>}> {
  const ticket = await ctx.db.get('tickets', args.ticketId);
  if (!ticket) throwNotFound('Ticket');
  if (ticket.userId !== args.senderId) {
    throwForbidden('You can only transfer your own tickets.');
  }
  if (!isValidTicketStatus(ticket.status)) {
    throwInvalidState('Only valid tickets can be transferred.');
  }
  if (ticket.transferEmailPendingRecipientId) {
    throwInvalidState(
      'Ticket transfer is still finishing. Try again in a moment.',
    );
  }
  await requireNoActiveResaleListing(ctx, ticket._id);

  const event = await ctx.db.get('events', ticket.eventId);
  if (!event) throwNotFound('Event');

  return {ticket, event};
}

async function validateRecipientForTicket(
  ctx: QueryCtx | MutationCtx,
  args: {
    email: string;
    event: Doc<'events'>;
    senderId: Id<'users'>;
  },
): Promise<Doc<'users'>> {
  const recipient = await findUserByEmail(ctx, args.email);
  if (!recipient || !recipient.email) {
    throwInvalidInput(RECIPIENT_NOT_ELIGIBLE_MESSAGE);
  }
  if (recipient._id === args.senderId) {
    throwInvalidInput('You already hold this ticket.');
  }

  const access = await canReceiveTicketTransferForUser(
    ctx,
    recipient._id,
    args.event.organizerId,
  );
  if (!access.allowed) {
    throwInvalidInput(RECIPIENT_NOT_ELIGIBLE_MESSAGE);
  }

  return recipient;
}

export const validateRecipient = mutation({
  args: {ticketId: v.id('tickets'), recipientEmail: v.string()},
  returns: transferRecipientValidator,
  handler: async (ctx, args) => {
    const sender = await requireUser(ctx);
    await rateLimiter.limit(ctx, 'ticketTransferRecipientLookup', {
      key: sender._id,
      throws: true,
    });

    const {event} = await validateTransferTicket(ctx, {
      ticketId: args.ticketId,
      senderId: sender._id,
    });
    const recipient = await validateRecipientForTicket(ctx, {
      email: args.recipientEmail,
      event,
      senderId: sender._id,
    });

    return {
      userId: recipient._id,
      email: recipient.email ?? normalizeEmail(args.recipientEmail),
      ...(recipient.name ? {name: recipient.name} : {}),
    };
  },
});

export const transfer = mutation({
  args: {ticketId: v.id('tickets'), recipientEmail: v.string()},
  returns: transferRecipientValidator,
  handler: async (ctx, args) => {
    const sender = await requireUser(ctx);
    await rateLimiter.limit(ctx, 'ticketTransfer', {
      key: sender._id,
      throws: true,
    });

    const {ticket, event} = await validateTransferTicket(ctx, {
      ticketId: args.ticketId,
      senderId: sender._id,
    });
    const recipient = await validateRecipientForTicket(ctx, {
      email: args.recipientEmail,
      event,
      senderId: sender._id,
    });

    await ctx.db.patch('tickets', ticket._id, {
      userId: recipient._id,
      guestSessionId: undefined,
      orderId: undefined,
      qrCode: generateTicketScanCode(),
      transferEmailPendingRecipientId: recipient._id,
      ...buildTicketRosterProjection({
        ticketId: ticket._id,
        status: ticket.status,
        attendeeName: recipient.name ?? null,
        email: recipient.email ?? null,
        checkedInByName: ticket.rosterCheckedInByName ?? null,
      }),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.tickets.actions.sendTransferredTicketAction,
      {
        ticketId: ticket._id,
        recipientId: recipient._id,
        senderId: sender._id,
      },
    );

    return {
      userId: recipient._id,
      email: recipient.email ?? normalizeEmail(args.recipientEmail),
      ...(recipient.name ? {name: recipient.name} : {}),
    };
  },
});

export const getTransferEmailContext = internalQuery({
  args: {
    ticketId: v.id('tickets'),
    recipientId: v.id('users'),
    senderId: v.id('users'),
  },
  returns: v.union(ticketTransferEmailContextValidator, v.null()),
  handler: async (ctx, args) => {
    const [ticket, recipient, sender] = await Promise.all([
      ctx.db.get('tickets', args.ticketId),
      ctx.db.get('users', args.recipientId),
      ctx.db.get('users', args.senderId),
    ]);
    if (
      !ticket ||
      !recipient ||
      !sender ||
      ticket.userId !== recipient._id ||
      ticket.transferEmailPendingRecipientId !== recipient._id
    ) {
      return null;
    }

    const event = await ctx.db.get('events', ticket.eventId);
    if (!event) return null;
    const organizer = await ctx.db.get('organizers', event.organizerId);

    return {
      ticket: {
        _id: ticket._id,
        eventId: ticket.eventId,
        tier: ticket.tier,
        ...(ticket.qrCode ? {qrCode: ticket.qrCode} : {}),
      },
      event: {
        _id: event._id,
        title: event.title,
        date: event.date,
        ...(event.location ? {location: event.location} : {}),
      },
      organizer: organizer
        ? {
            name: organizer.name,
            ...(organizer.slug ? {slug: organizer.slug} : {}),
            ...(organizer.codeOfConduct
              ? {codeOfConduct: organizer.codeOfConduct}
              : {}),
          }
        : null,
      recipient: {
        _id: recipient._id,
        ...(recipient.email ? {email: recipient.email} : {}),
        ...(recipient.name ? {name: recipient.name} : {}),
      },
      sender: {
        _id: sender._id,
        ...(sender.email ? {email: sender.email} : {}),
        ...(sender.name ? {name: sender.name} : {}),
      },
    };
  },
});

export const clearTransferEmailPending = internalMutation({
  args: {
    ticketId: v.id('tickets'),
    recipientId: v.id('users'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get('tickets', args.ticketId);
    if (ticket?.transferEmailPendingRecipientId === args.recipientId) {
      await ctx.db.patch('tickets', args.ticketId, {
        transferEmailPendingRecipientId: undefined,
      });
    }
    return null;
  },
});
