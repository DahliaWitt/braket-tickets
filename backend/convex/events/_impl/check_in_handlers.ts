import {internal} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {
  captureBackendEvent,
  hashForAnalytics,
  userDistinctId,
} from '../../lib/analytics';
import {requireUser} from '../../lib/auth_identity';
import {findMatchingInQuery} from '../../lib/query_scan';
import {buildTicketRosterProjection} from '../../lib/ticket_roster_projection';
import {canEditEvent, canScanEvent, isPlatformAdmin} from '../../lib/access';
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
type CheckInActorRole = 'community_admin' | 'root_admin' | 'scanner';
type CheckInErrorCode =
  | 'invalid_ticket_qr_code'
  | 'invalid_guest_qr_code'
  | 'missing_scan_target'
  | 'ticket_not_found'
  | 'guest_not_found'
  | 'scan_access_denied'
  | 'ticket_invalid_status'
  | 'ticket_locked_for_resale'
  | 'ticket_status_changed'
  | 'guest_already_checked_in'
  | 'event_not_found';

function getScanSource(isEditor: boolean): CheckInScanSource {
  return isEditor ? 'admin-ui' : 'door-scanner';
}

function getFallbackScanSource(actorRole: CheckInActorRole): CheckInScanSource {
  return actorRole === 'root_admin' ? 'admin-ui' : 'door-scanner';
}

async function resolveCheckInActorRole(
  ctx: MutationCtx,
  userId: Id<'users'>,
  event: Doc<'events'> | null,
  isEditor: boolean,
): Promise<CheckInActorRole> {
  if (await isPlatformAdmin(ctx, userId)) {
    return 'root_admin';
  }

  if (event && isEditor) {
    return 'community_admin';
  }

  return 'scanner';
}

async function emitCheckInSuccessEvent(args: {
  ctx: MutationCtx;
  userId: Id<'users'>;
  eventId: Id<'events'>;
  scanSource: CheckInScanSource;
  actorRole: CheckInActorRole;
  ticketId?: Id<'tickets'>;
  guestId?: Id<'guests'>;
}): Promise<void> {
  const ticketIdHash = args.ticketId
    ? await hashForAnalytics(String(args.ticketId))
    : undefined;
  const guestIdHash = args.guestId
    ? await hashForAnalytics(String(args.guestId))
    : undefined;

  await captureBackendEvent(args.ctx, {
    distinctId: userDistinctId(String(args.userId)),
    event: 'ticket_checked_in',
    properties: {
      actor_role: args.actorRole,
      auth_state: 'signed_in',
      event_id: args.eventId,
      scan_source: args.scanSource,
      ...(ticketIdHash ? {ticket_id_hash: ticketIdHash} : {}),
      ...(guestIdHash ? {guest_id_hash: guestIdHash} : {}),
    },
  });
}

async function emitCheckInFailureEvent(args: {
  ctx: MutationCtx;
  userId: Id<'users'>;
  errorCode: CheckInErrorCode;
  scanSource: CheckInScanSource;
  actorRole: CheckInActorRole;
  eventId?: Id<'events'>;
}): Promise<void> {
  await captureBackendEvent(args.ctx, {
    distinctId: userDistinctId(String(args.userId)),
    event: 'ticket_checkin_failed',
    properties: {
      actor_role: args.actorRole,
      auth_state: 'signed_in',
      ...(args.eventId ? {event_id: args.eventId} : {}),
      error_code: args.errorCode,
      scan_source: args.scanSource,
    },
  });
}

async function failCheckIn(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    errorCode: CheckInErrorCode;
    scanSource: CheckInScanSource;
    actorRole: CheckInActorRole;
    message: string;
    eventId?: Id<'events'>;
    ticket?: TicketResult;
    guest?: GuestResult;
  },
): Promise<CheckInResult> {
  await emitCheckInFailureEvent({
    ctx,
    userId: args.userId,
    errorCode: args.errorCode,
    scanSource: args.scanSource,
    actorRole: args.actorRole,
    ...(args.eventId ? {eventId: args.eventId} : {}),
  });
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
    notFoundErrorCode: CheckInErrorCode;
  },
): Promise<
  | {
      success: true;
      event: Doc<'events'>;
      isEditor: boolean;
      actorRole: CheckInActorRole;
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
    const actorRole = await resolveCheckInActorRole(
      ctx,
      args.userId,
      null,
      false,
    );
    const response =
      args.operation === 'check-in'
        ? await failCheckIn(ctx, {
            userId: args.userId,
            errorCode: args.notFoundErrorCode,
            scanSource: getFallbackScanSource(actorRole),
            actorRole,
            message: args.notFoundMessage,
          })
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
  const actorRole = await resolveCheckInActorRole(
    ctx,
    args.userId,
    event,
    isEditor,
  );
  const auditSource = getScanSource(isEditor);
  if (!canScan) {
    const response =
      args.operation === 'check-in'
        ? await failCheckIn(ctx, {
            userId: args.userId,
            errorCode: 'scan_access_denied',
            scanSource: auditSource,
            actorRole,
            eventId: event._id,
            message: args.notFoundMessage,
          })
        : {success: false as const, message: args.notFoundMessage};
    return {
      success: false,
      response,
    };
  }

  return {success: true, event, isEditor, actorRole, auditSource};
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
    const actorRole = await resolveCheckInActorRole(ctx, userId, null, false);
    return await failCheckIn(ctx, {
      userId,
      errorCode: 'invalid_ticket_qr_code',
      scanSource: getFallbackScanSource(actorRole),
      actorRole,
      message: 'Invalid Ticket QR Code',
    });
  }

  if (args.guestId && !guestId) {
    const actorRole = await resolveCheckInActorRole(ctx, userId, null, false);
    return await failCheckIn(ctx, {
      userId,
      errorCode: 'invalid_guest_qr_code',
      scanSource: getFallbackScanSource(actorRole),
      actorRole,
      message: 'Invalid Guest QR Code',
    });
  }

  if (ticketId) {
    const ticket = await ctx.db.get('tickets', ticketId);
    if (!ticket) {
      const actorRole = await resolveCheckInActorRole(ctx, userId, null, false);
      return await failCheckIn(ctx, {
        userId,
        errorCode: 'ticket_not_found',
        scanSource: getFallbackScanSource(actorRole),
        actorRole,
        message: 'Ticket not found',
      });
    }

    const authorization = await loadCheckInAuthorization(ctx, {
      userId,
      eventId: ticket.eventId,
      missingEventLogMessage: 'orphaned ticket references missing event',
      operation: 'check-in',
      notFoundMessage: 'Ticket not found',
      notFoundErrorCode: 'event_not_found',
    });
    if (!authorization.success) return authorization.response;

    const {event, actorRole, auditSource} = authorization;

    if (!isValidTicketStatus(ticket.status)) {
      return await failCheckIn(ctx, {
        userId,
        errorCode: 'ticket_invalid_status',
        scanSource: auditSource,
        actorRole,
        eventId: event._id,
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
        return await failCheckIn(ctx, {
          userId,
          errorCode: 'ticket_locked_for_resale',
          scanSource: auditSource,
          actorRole,
          eventId: event._id,
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
      return await failCheckIn(ctx, {
        userId,
        errorCode: freshTicket ? 'ticket_status_changed' : 'ticket_not_found',
        scanSource: auditSource,
        actorRole,
        eventId: event._id,
        message: freshTicket
          ? `Ticket status changed to ${freshTicket.status}`
          : 'Ticket not found',
      });
    }
    if (!freshEvent) {
      return await failCheckIn(ctx, {
        userId,
        errorCode: 'event_not_found',
        scanSource: auditSource,
        actorRole,
        eventId: event._id,
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

    await emitCheckInSuccessEvent({
      ctx,
      userId,
      eventId: freshTicket.eventId,
      scanSource: auditSource,
      actorRole,
      ticketId,
    });

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
      const actorRole = await resolveCheckInActorRole(ctx, userId, null, false);
      return await failCheckIn(ctx, {
        userId,
        errorCode: 'guest_not_found',
        scanSource: getFallbackScanSource(actorRole),
        actorRole,
        message: 'Guest ticket not found',
      });
    }

    const authorization = await loadCheckInAuthorization(ctx, {
      userId,
      eventId: guest.eventId,
      missingEventLogMessage: 'orphaned guest references missing event',
      operation: 'check-in',
      notFoundMessage: 'Guest ticket not found',
      notFoundErrorCode: 'event_not_found',
    });
    if (!authorization.success) return authorization.response;

    const {event, actorRole, auditSource} = authorization;

    if (guest.checkedInAt) {
      return await failCheckIn(ctx, {
        userId,
        errorCode: 'guest_already_checked_in',
        scanSource: auditSource,
        actorRole,
        eventId: event._id,
        message: `Guest already checked in at ${new Date(guest.checkedInAt).toLocaleTimeString()}`,
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

    await emitCheckInSuccessEvent({
      ctx,
      userId,
      eventId: guest.eventId,
      scanSource: auditSource,
      actorRole,
      guestId,
    });

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

  const actorRole = await resolveCheckInActorRole(ctx, userId, null, false);
  return await failCheckIn(ctx, {
    userId,
    errorCode: 'missing_scan_target',
    scanSource: getFallbackScanSource(actorRole),
    actorRole,
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
    notFoundErrorCode: 'event_not_found',
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
