import type {ActionCtx} from '../../_generated/server';
import type {Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import {throwAppError} from '../../lib/errors';

const CSV_INJECTION_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function escapeCsvField(raw: string | null | undefined): string {
  const value = raw ?? '';
  let safe = value;
  if (safe.length > 0 && CSV_INJECTION_CHARS.has(safe[0])) {
    safe = "'" + safe;
  }
  return '"' + safe.replace(/"/g, '""') + '"';
}

function slugifyTitle(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'event'
  );
}

function formatDateYYYYMMDD(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}

export async function exportEventRosterCsvImpl(
  ctx: ActionCtx,
  args: {
    eventId: Id<'events'>;
    includeRefunded: boolean;
  },
): Promise<{
  csv: string;
  filename: string;
}> {
  const actorUserId: Id<'users'> | null = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!actorUserId) {
    throwAppError('UNAUTHENTICATED', 'Unauthenticated');
  }

  const isEventAdmin = await ctx.runQuery(internal.lib.access._isEventAdmin, {
    userId: actorUserId,
    eventId: args.eventId,
  });
  if (!isEventAdmin) {
    throwAppError(
      'FORBIDDEN',
      'Roster export requires admin or event manager role',
    );
  }

  await ctx.runMutation(internal.lib.rate_limits.applyRateLimit, {
    name: 'exportEventRoster',
    key: `${actorUserId}:${args.eventId}`,
  });

  const event = await ctx.runQuery(internal.events.management.getInternal, {
    id: args.eventId,
  });
  if (!event) {
    throwAppError('NOT_FOUND', 'Event not found');
  }

  const rows = await ctx.runQuery(
    internal.events.analytics._getEventAttendeeRosterInternal,
    {eventId: args.eventId, includeRefunded: args.includeRefunded},
  );

  const headers = [
    'Name',
    'Email',
    'Tier',
    'Purchase Date',
    'Status',
    'Checked In At',
    'Checked In By',
  ];
  const csvRows = [headers.map(escapeCsvField).join(',')];

  for (const row of rows) {
    const purchaseDate = new Date(row.purchaseDate).toISOString();
    const checkedInAt = row.checkedInAt
      ? new Date(row.checkedInAt).toISOString()
      : '';
    csvRows.push(
      [
        escapeCsvField(row.attendeeName),
        escapeCsvField(row.email),
        escapeCsvField(row.tierName),
        escapeCsvField(purchaseDate),
        escapeCsvField(row.status),
        escapeCsvField(checkedInAt),
        escapeCsvField(row.checkedInByName),
      ].join(','),
    );
  }

  const csv = csvRows.join('\r\n');
  const slugifiedTitle = slugifyTitle(event.title);
  const dateStr = formatDateYYYYMMDD(Date.now());
  const filename = `event-${slugifiedTitle}-roster-${dateStr}.csv`;

  await ctx.runMutation(internal.events.analytics.recordRosterExport, {
    adminId: actorUserId,
    eventId: args.eventId,
    organizerId: event.organizerId,
    rowCount: rows.length,
    includeRefunded: args.includeRefunded,
  });

  return {csv, filename};
}
