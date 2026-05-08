import type {Doc, Id} from '../_generated/dataModel';
import type {RosterStatus} from './validators/ticketing';

export type TicketRosterProjection = {
  rosterAttendeeName: string;
  rosterAttendeeNameLower: string;
  rosterEmail: string | null;
  rosterEmailLower: string | null;
  rosterCheckedInByName: string | null;
  rosterStatus: RosterStatus;
  rosterIsActive: boolean;
  rosterSortKey: string;
};

export function normalizeRosterText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Map a raw ticket status to its roster-facing projection. The roster
 * distinguishes `'valid'` (not yet redeemed) from `'checked_in'` (redeemed)
 * so analytics and CSV exports reflect attendance without callers having to
 * re-derive it from the underlying ticket status. Exhaustive switch so a
 * future `TicketStatus` member forces a compile error here.
 */
export function toRosterStatus(
  status: Doc<'tickets'>['status'],
): RosterStatus {
  switch (status) {
    case 'valid':
      return 'valid';
    case 'used':
      return 'checked_in';
    case 'refunded':
      return 'refunded';
    case 'expired':
      return 'cancelled';
  }
}

export function buildTicketRosterProjection(args: {
  ticketId: Id<'tickets'>;
  status: Doc<'tickets'>['status'];
  attendeeName?: string | null;
  email?: string | null;
  checkedInByName?: string | null;
}): TicketRosterProjection {
  const attendeeName = args.attendeeName?.trim() || args.email?.trim() || 'Unknown';
  const attendeeNameLower = normalizeRosterText(attendeeName);
  const email = args.email?.trim() || null;
  const emailLower = email ? normalizeRosterText(email) : null;
  const checkedInByName = args.checkedInByName?.trim() || null;
  const rosterStatus = toRosterStatus(args.status);
  // "Active" here means the ticket still counts toward the event's live
  // attendee roster — both unredeemed (`valid`) and redeemed (`checked_in`)
  // tickets qualify; `refunded` and `cancelled` drop out. Drives the
  // `by_event_and_roster_active_and_sort` hot index.
  const rosterIsActive =
    rosterStatus === 'valid' || rosterStatus === 'checked_in';

  return {
    rosterAttendeeName: attendeeName,
    rosterAttendeeNameLower: attendeeNameLower,
    rosterEmail: email,
    rosterEmailLower: emailLower,
    rosterCheckedInByName: checkedInByName,
    rosterStatus,
    rosterIsActive,
    rosterSortKey: `${attendeeNameLower}\u0000${args.ticketId}`,
  };
}
