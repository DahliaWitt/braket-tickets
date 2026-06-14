import {internal} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {requireUser} from '../../lib/auth_identity';
import {findMatchingInQuery} from '../../lib/query_scan';
import {buildTicketRosterProjection} from '../../lib/ticket_roster_projection';
import {canEditEvent, canScanEvent} from '../../lib/access';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {logger} from '../../lib/logger';
import {
  assertValidListingTransition,
  buildCancellationPatch,
  doesResaleListingLockTicket,
  isPendingResaleListingStatus,
} from '../../lib/resale_listing_transitions';
import {
  isValidTicketStatus,
  isUsedTicketStatus,
} from '../../lib/validators/ticketing';
import {EVENT_DATE_TIME_ZONE} from '../../lib/timezone';

const platformTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_DATE_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

function formatPlatformTime(timestamp: number): string {
  return platformTimeFormatter.format(new Date(timestamp));
}

type TicketResult = {
  _id: Id<'tickets'>;
  _creationTime: number;
  userId?: Id<'users'>;
  eventId: Id<'events'>;
  guestSessionId?: Id<'guest_sessions'>;
  status: Doc<'tickets'>['status'];
  tier: 'regular' | 'notaflof' | 'supporter';
  checkedInAt?: number;
  checkedInBy?: Id<'users'>;
  event?: {
    title: string;
    date: string;
    location?: string;
  };
  user?: {
    name?: string;
    email?: string;
  };
};

type GuestResult = {
  _id: Id<'guests'>;
  _creationTime: number;
  eventId: Id<'events'>;
  name: string;
  email?: string;
  type: Doc<'guests'>['type'];
  notes?: string;
  checkedInAt?: number;
  checkedInBy?: Id<'users'>;
  event?: {
    title: string;
    date: string;
    location?: string;
  };
};

type CheckInResult =
  | {success: true; message: string; ticket?: TicketResult; guest?: GuestResult}
  | {
      success: false;
      message: string;
      ticket?: TicketResult;
      guest?: GuestResult;
    };

type CheckInScanSource = 'admin-ui' | 'door-scanner';

function getScanSource(isEditor: boolean): CheckInScanSource {
  return isEditor ? 'admin-ui' : 'door-scanner';
}

function failCheckIn(args: {
  message: string;
  ticket?: TicketResult;
  guest?: GuestResult;
}): CheckInResult {
  return {
    success: false,
    message: args.message,
    ...(args.ticket ? {ticket: args.ticket} : {}),
    ...(args.guest ? {guest: args.guest} : {}),
  };
}

async function loadCheckInAuthorization(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    eventId: Id<'events'>;
    missingEventLogMessage: string;
    operation: 'check-in' | 'revert';
    notFoundMessage: string;
  },
): Promise<
  | {
      success: true;
      event: Doc<'events'>;
      isEditor: boolean;
      auditSource: CheckInScanSource;
    }
  | {success: false; response: CheckInResult}
> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    logger.error('ticket_check_in', args.missingEventLogMessage, {
      userId: args.userId,
      operation: args.operation,
    });
    const response =
      args.operation === 'check-in'
        ? failCheckIn({message: args.notFoundMessage})
        : {success: false as const, message: args.notFoundMessage};
    return {
      success: false,
      response,
    };
  }

  const [canScan, isEditor] = await Promise.all([
    canScanEvent(ctx, args.userId, event),
    canEditEvent(ctx, args.userId, event),
  ]);
  const auditSource = getScanSource(isEditor);
  if (!canScan) {
    const response =
      args.operation === 'check-in'
        ? failCheckIn({message: args.notFoundMessage})
        : {success: false as const, message: args.notFoundMessage};
    return {
      success: false,
      response,
    };
  }

  return {success: true, event, isEditor, auditSource};
}

export async function checkIn(
  ctx: MutationCtx,
  args: {
    ticketId?: string;
    guestId?: string;
  },
): Promise<CheckInResult> {
  const user = await requireUser(ctx);
  const userId = user._id;

  const ticketId = args.ticketId
    ? ctx.db.normalizeId('tickets', args.ticketId)
    : null;
  const guestId = args.guestId
    ? ctx.db.normalizeId('guests', args.guestId)
    : null;

  if (args.ticketId && !ticketId) {
    return failCheckIn({
      message: 'Invalid Ticket QR Code',
    });
  }

  if (args.guestId && !guestId) {
    return failCheckIn({
      message: 'Invalid Guest QR Code',
    });
  }

  if (ticketId) {
    const ticket = await ctx.db.get('tickets', ticketId);
    if (!ticket) {
      return failCheckIn({
        message: 'Ticket not found',
      });
    }

    const authorization = await loadCheckInAuthorization(ctx, {
      userId,
      eventId: ticket.eventId,
      missingEventLogMessage: 'orphaned ticket references missing event',
      operation: 'check-in',
      notFoundMessage: 'Ticket not found',
    });
    if (!authorization.success) return authorization.response;

    const {event, auditSource} = authorization;

    if (!isValidTicketStatus(ticket.status)) {
      return failCheckIn({
        message: `Ticket is ${ticket.status}. Cannot check in.`,
        ticket: {
          _id: ticket._id,
          _creationTime: ticket._creationTime,
          userId: ticket.userId,
          eventId: ticket.eventId,
          status: ticket.status,
          tier: ticket.tier,
          checkedInAt: ticket.checkedInAt,
          checkedInBy: ticket.checkedInBy,
          event: {
            title: event.title,
            date: event.date,
            location: event.location,
          },
        },
      });
    }

    const activeResaleListing = await findMatchingInQuery(
      ctx.db
        .query('resale_listings')
        .withIndex('by_ticket', (q) => q.eq('ticketId', ticketId)),
      (listing) => doesResaleListingLockTicket(listing.status),
    );

    if (activeResaleListing) {
      if (isPendingResaleListingStatus(activeResaleListing.status)) {
        return failCheckIn({
          message:
            'RESALE IN PROGRESS — This ticket is currently being purchased by another user. ' +
            'The ticket holder has listed this ticket for resale. Do NOT allow entry.',
        });
      }

      assertValidListingTransition(activeResaleListing.status, 'cancelled');
      await ctx.db.patch(
        'resale_listings',
        activeResaleListing._id,
        buildCancellationPatch({now: Date.now()}),
      );
    }

    const checkedInAt = Date.now();
    const [freshTicket, freshEvent] = await Promise.all([
      ctx.db.get('tickets', ticketId),
      ctx.db.get('events', ticket.eventId),
    ]);
    if (!freshTicket || !isValidTicketStatus(freshTicket.status)) {
      return failCheckIn({
        message: freshTicket
          ? `Ticket status changed to ${freshTicket.status}`
          : 'Ticket not found',
      });
    }
    if (!freshEvent) {
      return failCheckIn({
        message: 'Event not found',
      });
    }

    const [, , ticketUser] = await Promise.all([
      ctx.db.patch('tickets', ticketId, {
        status: 'used',
        checkedInBy: userId,
        checkedInAt,
        ...buildTicketRosterProjection({
          ticketId,
          status: 'used',
          attendeeName: freshTicket.rosterAttendeeName ?? null,
          email: freshTicket.rosterEmail ?? null,
          checkedInByName: user?.name ?? null,
        }),
      }),
      ctx.db.patch('events', freshTicket.eventId, {
        checkedInCount: (freshEvent.checkedInCount ?? 0) + 1,
        lastCheckInAt: checkedInAt,
      }),
      freshTicket.userId
        ? ctx.db.get('users', freshTicket.userId)
        : Promise.resolve(null),
    ]);

    await ctx.scheduler.runAfter(
      0,
      internal.communities.management.audit.recordCheckIn,
      {
        adminId: userId,
        action: 'ticket.check-in',
        eventId: freshTicket.eventId,
        organizerId: freshEvent.organizerId,
        source: auditSource,
      },
    );

    return {
      success: true,
      message: `Successfully checked in: ${event.title}`,
      ticket: {
        _id: ticket._id,
        _creationTime: ticket._creationTime,
        userId: ticket.userId,
        eventId: ticket.eventId,
        status: 'used' as const,
        tier: ticket.tier,
        checkedInAt,
        checkedInBy: userId,
        event: {
          title: event.title,
          date: event.date,
          location: event.location,
        },
        user: ticketUser
          ? {
              name: ticketUser.name,
              email: ticketUser.email,
            }
          : undefined,
      },
    };
  }

  if (guestId) {
    const guest = await ctx.db.get('guests', guestId);
    if (!guest) {
      return failCheckIn({
        message: 'Guest ticket not found',
      });
    }

    const authorization = await loadCheckInAuthorization(ctx, {
      userId,
      eventId: guest.eventId,
      missingEventLogMessage: 'orphaned guest references missing event',
      operation: 'check-in',
      notFoundMessage: 'Guest ticket not found',
    });
    if (!authorization.success) return authorization.response;

    const {event, auditSource} = authorization;

    if (guest.checkedInAt) {
      return failCheckIn({
        message: `Guest already checked in at ${formatPlatformTime(guest.checkedInAt)}`,
        guest: {
          _id: guest._id,
          _creationTime: guest._creationTime,
          eventId: guest.eventId,
          name: guest.name,
          email: guest.email,
          type: guest.type,
          notes: guest.notes,
          checkedInAt: guest.checkedInAt,
          checkedInBy: guest.checkedInBy,
          event: {
            title: event.title,
            date: event.date,
            location: event.location,
          },
        },
      });
    }

    const checkedInAt = Date.now();

    await ctx.db.patch('guests', guestId, {
      checkedInBy: userId,
      checkedInAt,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.communities.management.audit.recordCheckIn,
      {
        adminId: userId,
        action: 'guest.check-in',
        eventId: guest.eventId,
        organizerId: event.organizerId,
        source: auditSource,
      },
    );

    return {
      success: true,
      message: `Guest Checked In: ${guest.name}`,
      guest: {
        _id: guest._id,
        _creationTime: guest._creationTime,
        eventId: guest.eventId,
        name: guest.name,
        email: guest.email,
        type: guest.type,
        notes: guest.notes,
        checkedInAt,
        checkedInBy: userId,
        event: {
          title: event.title,
          date: event.date,
          location: event.location,
        },
      },
    };
  }

  return failCheckIn({
    message: 'No ticket or guest ID provided',
  });
}

export async function revertCheckIn(
  ctx: MutationCtx,
  args: {
    ticketId: Id<'tickets'>;
  },
): Promise<{success: boolean; message: string}> {
  const {_id: userId} = await requireUser(ctx);

  const ticket = await ctx.db.get('tickets', args.ticketId);
  if (!ticket) {
    return {success: false, message: 'Ticket not found'};
  }

  const authorization = await loadCheckInAuthorization(ctx, {
    userId,
    eventId: ticket.eventId,
    missingEventLogMessage: 'orphaned ticket references missing event',
    operation: 'revert',
    notFoundMessage: 'Ticket not found',
  });
  if (!authorization.success) return authorization.response;

  const {isEditor} = authorization;

  if (!isUsedTicketStatus(ticket.status)) {
    return {
      success: false,
      message: `Cannot revert check-in: ticket is ${ticket.status}`,
    };
  }

  const auditSource = isEditor ? 'admin-ui' : 'door-scanner';

  const [freshTicket, freshEvent] = await Promise.all([
    ctx.db.get('tickets', args.ticketId),
    ctx.db.get('events', ticket.eventId),
  ]);

  if (!freshTicket || !isUsedTicketStatus(freshTicket.status)) {
    return {
      success: false,
      message: freshTicket
        ? `Ticket status changed to ${freshTicket.status}`
        : 'Ticket not found',
    };
  }

  if (!freshEvent) {
    return {success: false, message: 'Event not found'};
  }

  await ctx.db.patch('tickets', args.ticketId, {
    status: 'valid',
    checkedInBy: undefined,
    checkedInAt: undefined,
    ...buildTicketRosterProjection({
      ticketId: args.ticketId,
      status: 'valid',
      attendeeName: freshTicket.rosterAttendeeName ?? null,
      email: freshTicket.rosterEmail ?? null,
      checkedInByName: null,
    }),
  });

  await ctx.db.patch('events', freshTicket.eventId, {
    checkedInCount: Math.max(0, (freshEvent.checkedInCount ?? 0) - 1),
  });

  await ctx.scheduler.runAfter(
    0,
    internal.communities.management.audit.logAdminAccess,
    {
      adminId: userId,
      action: ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN_REVERT,
      eventId: freshTicket.eventId,
      organizerId: freshEvent.organizerId,
      source: auditSource,
    },
  );

  return {success: true, message: 'Check-in reverted successfully'};
}
