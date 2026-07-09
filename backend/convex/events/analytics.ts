/**
 * Event Check-in Analytics & Roster
 *
 * Provides live check-in monitoring (door-rush mode) and post-event roster
 * export. All public queries use handler-level authorization.
 * Auth is enforced per-event (community admin / event manager / door staff
 * for THIS event; no global bypass).
 *
 * Performance notes:
 * - getEventCheckInSummary is O(1) reads per invalidation (denormalized counters).
 * - getEventCheckInPostMortem is one-shot, called only in post-event mode.
 * - getEventAttendeeRosterPage is paginated (50 rows); only the visible page
 *   is reactive on each check-in.
 * - searchEventAttendeesPage scans the roster sort indexes in pages and only
 *   resolves the matches returned for the current search page.
 *
 * PII boundary:
 * - Door staff (community scanners without admin role) receive email: null.
 * - Community admins / root admins receive real emails.
 * - The frontend hides the Email column entirely when all values are null.
 *
 * @see convex/events/check_in.ts — counter cascade writers (LINT.IfChange)
 */

import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {query, internalQuery, internalMutation} from '../_generated/server';
import type {Id} from '../_generated/dataModel';
import {
  rosterStatusValueValidator,
  type RosterStatus,
} from '../lib/validators/ticketing';
import {
  _getEventAttendeeRosterInternal as _getEventAttendeeRosterInternalImpl,
  getEventAttendeeRosterPage as getEventAttendeeRosterPageImpl,
  getEventCheckInPostMortem as getEventCheckInPostMortemImpl,
  getEventCheckInSummary as getEventCheckInSummaryImpl,
  getRecentCheckIns as getRecentCheckInsImpl,
  recordRosterExport as recordRosterExportImpl,
  searchEventAttendeesPage as searchEventAttendeesPageImpl,
} from './_impl/analytics';

// LINT.IfChange
// This row shape must match the CSV columns in analytics_export.ts
export const rosterRowValidator = v.object({
  ticketId: v.id('tickets'),
  attendeeName: v.string(),
  email: v.union(v.string(), v.null()),
  tierName: v.string(),
  purchaseDate: v.number(),
  status: rosterStatusValueValidator,
  checkedInAt: v.union(v.number(), v.null()),
  checkedInByName: v.union(v.string(), v.null()),
});
// LINT.ThenChange("./analytics_export.ts")

export type RosterRow = {
  ticketId: Id<'tickets'>;
  attendeeName: string;
  email: string | null;
  tierName: string;
  purchaseDate: number;
  status: RosterStatus;
  checkedInAt: number | null;
  checkedInByName: string | null;
};

// ---------------------------------------------------------------------------
// LINT.IfChange
// getEventCheckInSummary — live O(1) summary.
// The summary depends on events.checkedInCount/events.lastCheckInAt and
// event_inventory.soldCount being maintained by ticket/order writers.
//
// SCOPE: this counter is TICKET-scoped. Guest check-ins and imported
// external-ticket check-ins (events/_impl/imported_tickets.applyImportedCheckIn)
// deliberately do NOT increment events.checkedInCount — they patch their own
// rows. So this summary reflects Braket-native ticket check-ins only; imported
// door counts are derived separately from importedTicketHolders and surfaced via
// the management summary's per-source breakdown. Keep new check-in writers off
// this counter unless they represent native tickets.
// LINT.ThenChange("./check_in.ts")
// ---------------------------------------------------------------------------

/**
 * Live check-in summary for this event.
 * O(1) reads per invalidation (denormalized counters on the events document).
 *
 * RLS: community admin / event manager / door staff for this event.
 */
export const getEventCheckInSummary = query({
  args: {eventId: v.id('events')},
  returns: v.object({
    totalActive: v.number(),
    checkedIn: v.number(),
    rate: v.number(),
    lastCheckInAt: v.union(v.number(), v.null()),
  }),
  handler: getEventCheckInSummaryImpl,
});

/**
 * Post-event peak hour analysis.
 * Called once per page load in post-event mode — NOT subscribed.
 * Scans all checked-in tickets for this event via the by_event_checkedInAt index.
 *
 * RLS: community admin / event manager / door staff for this event.
 */
export const getEventCheckInPostMortem = query({
  args: {eventId: v.id('events')},
  returns: v.object({
    peakHourStartsAt: v.union(v.number(), v.null()),
    peakHourCount: v.number(),
    totalCheckedIn: v.number(),
  }),
  handler: getEventCheckInPostMortemImpl,
});

/**
 * Paginated attendee roster. Page size governed by paginationOpts.numItems.
 * Server-side sort: attendeeName asc, ticketId as stability tiebreaker.
 *
 * PII boundary: door staff receive email: null for every row.
 *
 * RLS: community admin / event manager / door staff for this event.
 */
export const getEventAttendeeRosterPage = query({
  args: {
    eventId: v.id('events'),
    includeRefunded: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(rosterRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal('SplitRecommended'),
        v.literal('SplitRequired'),
        v.null(),
      ),
    ),
  }),
  handler: getEventAttendeeRosterPageImpl,
});

/**
 * Paginated exact-substring search over the attendee roster projection.
 * Case-insensitive match on attendeeName (all callers) and email (admins only).
 * Empty query is rejected with INVALID_ARG.
 *
 * RLS: community admin / event manager / door staff for this event.
 */
export const searchEventAttendeesPage = query({
  args: {
    eventId: v.id('events'),
    query: v.string(),
    includeRefunded: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(rosterRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: searchEventAttendeesPageImpl,
});

/**
 * Most recent check-ins for the activity feed (door-rush mode hero).
 * Uses the by_event_checkedInAt index descending. Default 20, max 100.
 *
 * RLS: community admin / event manager / door staff for this event.
 */
export const getRecentCheckIns = query({
  args: {
    eventId: v.id('events'),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      ticketId: v.id('tickets'),
      attendeeName: v.string(),
      tierName: v.string(),
      checkedInAt: v.number(),
      checkedInByName: v.union(v.string(), v.null()),
    }),
  ),
  handler: getRecentCheckInsImpl,
});

// _getEventAttendeeRosterInternal — no-RLS, used by export action
// Hard cap: 5,000 rows → throws EXPORT_TOO_LARGE

/** Hard cap for full-roster export. Protects the transaction read limit. */
export const ROSTER_EXPORT_SIZE_CAP = 5000;

/**
 * Internal roster query with no RLS.
 * Auth is enforced at the action boundary (exportEventRosterCsv).
 * Always includes emails (PII not restricted — action is admin-only).
 * Hard cap: 5,000 rows. Throws EXPORT_TOO_LARGE if exceeded.
 */
export const _getEventAttendeeRosterInternal = internalQuery({
  args: {
    eventId: v.id('events'),
    includeRefunded: v.boolean(),
  },
  returns: v.array(rosterRowValidator),
  handler: _getEventAttendeeRosterInternalImpl,
});

// recordRosterExport — internal audit log mutation (called from export action)
// Must live here (not in analytics_export.ts) because mutations cannot
// be defined in "use node" files — only actions can.

export const recordRosterExport = internalMutation({
  args: {
    adminId: v.id('users'),
    eventId: v.id('events'),
    organizerId: v.id('organizers'),
    rowCount: v.number(),
    includeRefunded: v.boolean(),
  },
  returns: v.null(),
  handler: recordRosterExportImpl,
});

/**
 * Internal export consumes the same ticket projection as the paginated roster
 * so admin CSV output stays consistent with the roster UI.
 */
