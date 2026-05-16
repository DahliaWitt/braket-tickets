import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import type {PaginationOptions, PaginationResult} from 'convex/server';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {getAuthUserId} from '../../lib/auth_identity';
import {calculateEventInventory} from '../../lib/inventory';
import {
  resolveEventAnalyticsAccess,
  type EventAnalyticsAccess,
} from '../../lib/access';
import {
  normalizeRosterText,
  toRosterStatus,
} from '../../lib/ticket_roster_projection';
import {type RosterStatus} from '../../lib/validators/ticketing';
import {throwAppError} from '../../lib/errors';
import {logTransactionMetrics} from '../../lib/runtime_metadata';
import {TICKET_STATUSES, type TicketStatus} from '@shared/domain/ticket-status';

const ROSTER_EXPORT_SIZE_CAP = 5000;
const ROSTER_PAGINATION_MAXIMUM_ROWS_READ = 2000;
const ROSTER_SEARCH_MAXIMUM_ROWS_READ = 5000;
const HOUR_MS = 60 * 60 * 1000;
const ACTIVE_ROSTER_EXPORT_STATUSES = [
  'valid',
  'used',
] as const satisfies readonly TicketStatus[];

type RosterRow = {
  ticketId: Id<'tickets'>;
  attendeeName: string;
  email: string | null;
  tierName: string;
  purchaseDate: number;
  status: RosterStatus;
  checkedInAt: number | null;
  checkedInByName: string | null;
};

async function requireAnalyticsAccess(
  ctx: QueryCtx,
  eventId: Id<'events'>,
): Promise<EventAnalyticsAccess> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throwAppError(
      'FORBIDDEN',
      'Not authorized to view analytics for this event',
    );
  }

  const event = await ctx.db.get('events', eventId);
  const access = await resolveEventAnalyticsAccess(ctx, userId, event);
  if (!access.authorized) {
    throwAppError(
      'FORBIDDEN',
      'Not authorized to view analytics for this event',
    );
  }

  return access;
}

async function getCanonicalSoldCount(
  db: QueryCtx['db'],
  event: Doc<'events'>,
): Promise<number> {
  const inventory = await calculateEventInventory(
    db,
    event._id,
    event.totalTickets,
  );
  return inventory.soldCount;
}

function sortRosterRows(rows: RosterRow[]): void {
  rows.sort((a, b) => {
    const nameCmp = a.attendeeName.localeCompare(b.attendeeName);
    if (nameCmp !== 0) return nameCmp;
    return a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0;
  });
}

function tierDisplayName(tier: 'regular' | 'notaflof' | 'supporter'): string {
  switch (tier) {
    case 'regular':
      return 'Regular';
    case 'notaflof':
      return 'NOTAFLOF';
    case 'supporter':
      return 'Supporter';
  }
}

function rosterRowFromProjectedTicket(
  ticket: Doc<'tickets'>,
  isDoorStaff: boolean,
): RosterRow {
  return {
    ticketId: ticket._id,
    attendeeName: ticket.rosterAttendeeName ?? 'Unknown',
    email: isDoorStaff ? null : (ticket.rosterEmail ?? null),
    tierName: tierDisplayName(ticket.tier),
    purchaseDate: ticket._creationTime,
    status: ticket.rosterStatus ?? toRosterStatus(ticket.status),
    checkedInAt: ticket.checkedInAt ?? null,
    checkedInByName: ticket.rosterCheckedInByName ?? null,
  };
}

function ticketMatchesRosterSubstringSearch(
  ticket: Doc<'tickets'>,
  query: string,
  isDoorStaff: boolean,
): boolean {
  if ((ticket.rosterAttendeeNameLower ?? '').includes(query)) return true;
  if (!isDoorStaff && (ticket.rosterEmailLower ?? '').includes(query))
    return true;
  return false;
}

async function paginateRosterTickets(
  ctx: QueryCtx,
  args: {
    eventId: Id<'events'>;
    includeRefunded: boolean;
    paginationOpts: PaginationOptions;
  },
): Promise<PaginationResult<Doc<'tickets'>>> {
  const ticketQuery = args.includeRefunded
    ? ctx.db
        .query('tickets')
        .withIndex('by_event_and_roster_sort', (q) =>
          q.eq('eventId', args.eventId),
        )
    : ctx.db
        .query('tickets')
        .withIndex('by_event_and_roster_active_and_sort', (q) =>
          q.eq('eventId', args.eventId).eq('rosterIsActive', true),
        );

  return await ticketQuery.paginate({
    ...args.paginationOpts,
    maximumRowsRead:
      args.paginationOpts.maximumRowsRead ??
      ROSTER_PAGINATION_MAXIMUM_ROWS_READ,
  });
}

export async function getEventCheckInSummary(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
): Promise<{
  totalActive: number;
  checkedIn: number;
  rate: number;
  lastCheckInAt: number | null;
}> {
  await requireAnalyticsAccess(ctx, args.eventId);

  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    throwAppError('NOT_FOUND', 'Event not found');
  }

  const totalActive = await getCanonicalSoldCount(ctx.db, event);
  const checkedIn = event.checkedInCount ?? 0;
  const rate = totalActive > 0 ? checkedIn / totalActive : 0;
  const lastCheckInAt = event.lastCheckInAt ?? null;

  return {totalActive, checkedIn, rate, lastCheckInAt};
}

export async function getEventCheckInPostMortem(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
): Promise<{
  peakHourStartsAt: number | null;
  peakHourCount: number;
  totalCheckedIn: number;
}> {
  await requireAnalyticsAccess(ctx, args.eventId);

  // Full scan — one-shot only in post-event mode; never subscribed.
  // eslint-disable-next-line -- full scan required for peak bucketing; bounded by event ticket count
  const allTickets = await ctx.db
    .query('tickets')
    .withIndex('by_event_checkedInAt', (q) => q.eq('eventId', args.eventId))
    .collect();

  const checkedIn = allTickets.filter(
    (ticket) => ticket.checkedInAt !== undefined,
  );
  const totalCheckedIn = checkedIn.length;

  if (totalCheckedIn === 0) {
    return {peakHourStartsAt: null, peakHourCount: 0, totalCheckedIn: 0};
  }

  const buckets = new Map<number, number>();
  for (const ticket of checkedIn) {
    const ts = ticket.checkedInAt as number;
    const windowStart = Math.floor(ts / HOUR_MS) * HOUR_MS;
    buckets.set(windowStart, (buckets.get(windowStart) ?? 0) + 1);
  }

  let peakHourStartsAt: number | null = null;
  let peakHourCount = 0;
  for (const [windowStart, count] of buckets) {
    if (count > peakHourCount) {
      peakHourCount = count;
      peakHourStartsAt = windowStart;
    }
  }

  return {peakHourStartsAt, peakHourCount, totalCheckedIn};
}

export async function getEventAttendeeRosterPage(
  ctx: QueryCtx,
  args: {
    eventId: Id<'events'>;
    includeRefunded: boolean;
    paginationOpts: PaginationOptions;
  },
): Promise<{
  page: RosterRow[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
}> {
  const {isDoorStaff} = await requireAnalyticsAccess(ctx, args.eventId);

  const result = await paginateRosterTickets(ctx, args);
  await logTransactionMetrics(ctx, 'events.analytics.rosterPage');
  return {
    ...result,
    page: result.page.map((ticket) =>
      rosterRowFromProjectedTicket(ticket, isDoorStaff),
    ),
  };
}

export async function searchEventAttendeesPage(
  ctx: QueryCtx,
  args: {
    eventId: Id<'events'>;
    query: string;
    includeRefunded: boolean;
    paginationOpts: PaginationOptions;
  },
): Promise<{
  page: RosterRow[];
  isDone: boolean;
  continueCursor: string;
}> {
  if (args.query.trim() === '') {
    throwAppError('INVALID_ARG', 'Search query must not be empty');
  }

  const {isDoorStaff} = await requireAnalyticsAccess(ctx, args.eventId);

  const normalizedQuery = normalizeRosterText(args.query);
  const matches: Array<Doc<'tickets'>> = [];
  let cursor = args.paginationOpts.cursor;
  let isDone = false;

  while (matches.length < args.paginationOpts.numItems && !isDone) {
    const remainingItems = args.paginationOpts.numItems - matches.length;
    const result = await paginateRosterTickets(ctx, {
      eventId: args.eventId,
      includeRefunded: args.includeRefunded,
      paginationOpts: {
        ...args.paginationOpts,
        numItems: remainingItems,
        maximumRowsRead:
          args.paginationOpts.maximumRowsRead ??
          ROSTER_SEARCH_MAXIMUM_ROWS_READ,
        cursor,
      },
    });

    for (const ticket of result.page) {
      if (
        ticketMatchesRosterSubstringSearch(ticket, normalizedQuery, isDoorStaff)
      ) {
        matches.push(ticket);
      }
    }

    cursor = result.continueCursor;
    isDone = result.isDone;
  }

  await logTransactionMetrics(ctx, 'events.analytics.searchAttendeesPage');
  return {
    page: matches.map((ticket) =>
      rosterRowFromProjectedTicket(ticket, isDoorStaff),
    ),
    isDone,
    continueCursor: cursor ?? '',
  };
}

export async function getRecentCheckIns(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; limit?: number},
): Promise<
  Array<{
    ticketId: Id<'tickets'>;
    attendeeName: string;
    tierName: string;
    checkedInAt: number;
    checkedInByName: string | null;
  }>
> {
  await requireAnalyticsAccess(ctx, args.eventId);

  const limit = Math.min(args.limit ?? 20, 100);

  const tickets = await ctx.db
    .query('tickets')
    .withIndex('by_event_checkedInAt', (q) => q.eq('eventId', args.eventId))
    .order('desc')
    .take(limit);

  const checkedIn = tickets.filter(
    (ticket) => ticket.checkedInAt !== undefined,
  );

  return Promise.all(
    checkedIn.map(async (ticket) => {
      const [attendeeUser, checkedInByUser, guestSession] = await Promise.all([
        ticket.userId
          ? ctx.db.get('users', ticket.userId)
          : Promise.resolve(null),
        ticket.checkedInBy
          ? ctx.db.get('users', ticket.checkedInBy)
          : Promise.resolve(null),
        ticket.guestSessionId
          ? ctx.db.get('guest_sessions', ticket.guestSessionId)
          : Promise.resolve(null),
      ]);

      let attendeeName = 'Unknown';
      if (attendeeUser) {
        attendeeName = attendeeUser.name ?? attendeeUser.email ?? 'Unknown';
      } else if (guestSession) {
        attendeeName = guestSession.email;
      }

      return {
        ticketId: ticket._id,
        attendeeName,
        tierName: tierDisplayName(ticket.tier),
        checkedInAt: ticket.checkedInAt as number,
        checkedInByName: checkedInByUser?.name ?? null,
      };
    }),
  );
}

export async function _getEventAttendeeRosterInternal(
  ctx: QueryCtx,
  args: {
    eventId: Id<'events'>;
    includeRefunded: boolean;
  },
): Promise<RosterRow[]> {
  const statuses = args.includeRefunded
    ? TICKET_STATUSES
    : ACTIVE_ROSTER_EXPORT_STATUSES;
  const tickets: Array<Doc<'tickets'>> = [];
  for (const status of statuses) {
    const remaining = ROSTER_EXPORT_SIZE_CAP + 1 - tickets.length;
    if (remaining <= 0) break;
    const rows = await ctx.db
      .query('tickets')
      .withIndex('by_event_status', (q) =>
        q.eq('eventId', args.eventId).eq('status', status),
      )
      .take(remaining);
    tickets.push(...rows);
  }

  if (tickets.length > ROSTER_EXPORT_SIZE_CAP) {
    throwAppError(
      'EXPORT_TOO_LARGE',
      'Roster exceeds export size limit. Contact support for a chunked export.',
    );
  }

  const rows = tickets.map((ticket) =>
    rosterRowFromProjectedTicket(ticket, false),
  );
  sortRosterRows(rows);
  await logTransactionMetrics(ctx, 'events.analytics.rosterExport');

  return rows;
}

export async function recordRosterExport(
  ctx: MutationCtx,
  args: {
    adminId: Id<'users'>;
    eventId: Id<'events'>;
    organizerId: Id<'organizers'>;
    rowCount: number;
    includeRefunded: boolean;
  },
): Promise<null> {
  await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: ADMIN_AUDIT_ACTIONS.EVENT_ROSTER_EXPORTED,
    eventId: args.eventId,
    organizerId: args.organizerId,
    source: JSON.stringify({
      rowCount: args.rowCount,
      includeRefunded: args.includeRefunded,
    }),
  });
  return null;
}
