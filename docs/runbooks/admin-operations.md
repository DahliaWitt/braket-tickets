---
title: Admin Operations
category: Runbooks
order: 1
description: Incident response runbook — admin operations
access: public
---

# Admin Operations Incidents

This runbook is for community admins, root admins, and engineers who support door operations. It assumes access to Convex Dashboard and the admin or community-admin UI. Use it when check-in, roster, or audit-log behavior looks wrong. It does not cover payment, auth, magic-link, or shared-vetting incidents. Use [Community Access Ops](./community-access-ops.md) for invite-link or trust-link issues.

Source of truth:

- `backend/convex/events/check_in.ts`
- `backend/convex/events/analytics.ts`
- `backend/convex/events/analytics_export.ts`
- `backend/convex/events/management.ts`
- `backend/convex/events/_impl/management.ts`
- `backend/convex/events/imported_tickets.ts`
- `backend/convex/events/_impl/imported_tickets.ts`
- `backend/convex/lib/imports/bulk.ts`
- `backend/convex/communities/management/audit.ts`
- `frontend/src/app/features/admin/pages/check-in/check-in.component.ts`

Jump to:

- [Diagnose a failed check-in](#diagnose-a-failed-check-in)
- [Explain a count mismatch](#explain-a-count-mismatch)
- [Fix a roster mismatch](#fix-a-roster-mismatch)
- [Check missing audit logs](#check-missing-audit-logs)
- [Fix a roster export issue](#fix-a-roster-export-issue)
- [Handle oversized management data](#handle-oversized-management-data)
- [Manage imported (external) ticket holders](#manage-imported-external-ticket-holders)

## Diagnose a failed check-in

The door and admin flows both use `events/check_in.checkIn`. The mutation accepts either `ticketId` or `guestId`.

These are the current check-in failure messages:

- `Invalid Ticket QR Code`
- `Invalid Guest QR Code`
- `Ticket not found`
- `Guest ticket not found`
- `Ticket is <status>. Cannot check in.`
- `Guest already checked in at <time>`
- `RESALE IN PROGRESS — This ticket is currently being purchased by another user. The ticket holder has listed this ticket for resale. Do NOT allow entry.`

`Ticket not found` and `Guest ticket not found` are returned uniformly when
either the record truly does not exist, the caller lacks scan authority for
the event, or the referenced event row is missing (data-corruption case).
The uniform response prevents cross-organizer ticket enumeration. When
debugging, inspect the `adminAuditLogs` table and server logs for
`[ticket_check_in] orphaned ticket` or `[ticket_check_in] orphaned guest`
entries (emitted via `logger.error` on the data-corruption path) to
disambiguate orphans from ordinary auth denials.

For a ticket incident, inspect these tables in order:

1. `tickets`
2. `events`
3. `resale_listings`

For a guest incident, inspect these tables:

1. `guests`
2. `events`

Keep these verified behaviors in mind:

- root admins, event admins, and scanners for that specific event can check in
- a `listed` resale listing is auto-cancelled so the seller can check in
- a `pending` resale listing blocks entry
- a successful ticket check-in sets the ticket status to `used`
- a successful guest check-in sets `checkedInAt` and `checkedInBy`

## Explain a count mismatch

The live summary in `events/analytics.getEventCheckInSummary` reads two denormalized event fields:

- `events.checkedInCount`
- `events.lastCheckInAt`

`events/check_in.checkIn` and `events/check_in.revertCheckIn` maintain those fields.

The current behavior is:

- check-in increments `checkedInCount`
- check-in updates `lastCheckInAt`
- revert decrements `checkedInCount`
- revert does not roll back `lastCheckInAt`

`lastCheckInAt` is a most-recent-activity marker, not a fully derived aggregate. If someone expects `lastCheckInAt` to move backward after a revert, that expectation is wrong.

The repo does not include a dedicated checked-in counter rebuild task. If `events.checkedInCount` drifts from the number of used tickets, treat that state as a backend repair task.

## Fix a roster mismatch

The current roster and analytics entrypoints are:

- `events/analytics.getEventCheckInSummary`
- `events/analytics.getEventCheckInPostMortem`
- `events/analytics.getEventAttendeeRosterPage`
- `events/analytics.searchEventAttendeesPage`
- `events/analytics_export.exportEventRosterCsv`

The backend enforces the current roster/export access boundary:

- community scanners (door staff) can access live roster data needed for event operations, including attendee contact information shown by the roster and ticket/guest list views
- CSV export remains stricter than live roster viewing and is limited to admin/event-manager/root-admin access

If the roster UI appears to be missing emails for a scanner, treat that as a product regression or stale client assumption rather than expected behavior.

CSV export has stricter access than live roster viewing:

- export requires admin, event-manager, or root-admin access
- door staff are rejected
- exports are rate-limited to 10 per user per event per hour

## Check missing audit logs

The current audit entrypoints are:

- `communities/management/audit.recordCheckIn`
- `communities/management/audit.logAdminAccess`
- `communities/management/audit.listAuditLogs`
- `communities/management/audit.cleanupOldAuditLogs`

Check-in writes the ticket or guest update first. The code schedules the audit insert afterward with `ctx.scheduler.runAfter`. That means a check-in can succeed before the audit row appears.

### Request metadata on audit rows (`ipAddress` / `userAgent`)

Audit rows capture the platform-provided client IP and User-Agent from
`ctx.meta.getRequestMetadata()` (see `backend/convex/lib/admin_audit_log.ts` and
`backend/convex/lib/request_metadata.ts`). These come from the Convex platform,
not from spoofable `x-forwarded-for`/`x-real-ip` headers. Expectations when
reading rows:

- Rows written directly by a user-triggered mutation carry the caller's
  IP/User-Agent automatically.
- Scheduler-deferred writes (check-in audit rows) carry the values captured by
  the scheduling mutation and passed through args — request metadata does not
  survive `ctx.scheduler`.
- Rows written by crons, system flows (`source: "system"`), or runtimes without
  metadata support have both fields absent. Absent fields on those rows are
  expected, not a regression.

Community scanners are intentionally limited to scanner-originated check-in audit writes:

- `ticket.check-in`
- `guest.check-in`

If you see a non-check-in audit action attributed to scanner workflows, treat that as a regression in the write path or an unexpected caller identity.

These audit categories are available today:

- `event`
- `application`
- `check-in`
- `payment`
- `trust-link`
- `role`
- `magic-link`
- `account`
- `email`

If an audit log appears missing:

1. Confirm that the primary check-in write succeeded.
2. Allow for scheduler lag.
3. Query `adminAuditLogs` with the `check-in` category.
4. Check whether the daily cleanup path removed older rows.

If the missing audit entry is for `trust-link` or `magic-link`, switch to [Community Access Ops](./community-access-ops.md). Those incidents use different write paths and different expected actions.

## Fix a roster export issue

`events/analytics_export.exportEventRosterCsv` currently:

- generates the CSV on the server
- records an audit log for each export
- prefixes spreadsheet-formula characters to prevent CSV injection

If an export succeeds but the file contents look wrong, inspect the export action and the roster row shape together. Those files are coupled by `LINT.IfChange` and `LINT.ThenChange`.

## Handle oversized management data

The admin event management page loads three per-surface Convex actions, each delegating to `backend/convex/events/_impl/management.ts`. Every action writes an `event.management.view` audit log before returning data:

- `events/management.getManagementSummary` (action) — summary, revenue, tier counts, sales-by-day, check-in stats
- `events/management.getManagementPurchases` (action) — completed orders with financial + ticket summaries
- `events/management.getManagementResale` (action) — resale listings, resale metrics, notification subscribers

Guests are served separately by `guests.listByEvent` (reactive query).

Each surface fails closed when its own dataset would otherwise be truncated and produce incorrect totals. The current hard caps are:

- tickets: 10,000 rows (summary)
- guests: 5,000 rows (`guests.listByEvent`)
- orders: 10,000 rows (purchases)
- order financial events: 20,000 rows (summary + purchases)
- resale listings: 5,000 rows (resale)
- resale notifications: 1,000 rows (resale)

When a cap is hit, the affected query throws `MANAGEMENT_DATA_TOO_LARGE` and includes the dataset name plus the limit in the error payload. Treat that as intentional protection against partial analytics, not as a transient outage.

If a management surface fails with that error:

1. Confirm which table crossed the cap in Convex Dashboard — the error payload names the dataset.
2. Other surfaces on the page continue to load independently, because the split queries isolate per-surface failures.
3. Do not raise the in-code `.take()` limit as a quick fix.
4. Treat the incident as a reporting follow-up for chunked loading or summary-backed large-event admin views.

## Manage imported (external) ticket holders

External ticket holders (Resident Advisor and other platform exports) are
imported from CSV/paste into the `importedTicketHolders` table. They are inert
admission records — never linked to Braket user accounts, never part of any
revenue, payout, refund, or NOTAFLOF calculation. They appear in the buyers /
attendee views and the door roster, are scannable by their external barcode,
and are searchable by that barcode for the manual door fallback.

Registered functions in `events/imported_tickets.ts`:

- `events/imported_tickets.importBatch` (mutation) — commits one import batch
  (one file = one batch key = one transaction). Enforces event-edit access,
  re-validates every row, caps batch size, and is idempotent under retry by
  batch key.
- `events/imported_tickets.listByEvent` (query) — reactive roster of imported
  entries for an event (powers the buyers view and the door check-in list).
- `events/imported_tickets.checkIn` (mutation) — idempotent id-based check-in;
  an already-checked-in entry returns its existing state (feeds the
  duplicate-scan warning) instead of erroring.
- `events/imported_tickets.removeEntry` (mutation) — removes a single entry by
  `id`.
- `events/imported_tickets.removeBatch` (mutation) — removes an entire batch by
  `{eventId, batchKey}`; returns `{removedCount, checkedInCount}`.
- `events/imported_tickets.redactByEmail` (internalMutation) — operator privacy
  redaction, cross-referenced below.

The door scanner path is `events/check_in.checkIn`. When native ticket/guest
resolution fails and the caller passed the scanned `eventId`, the payload is
normalized (trim + lowercase) and matched against
`importedTicketHolders.externalRefKey` for THAT event only.
The result carries the `imported` object (name, ticket type label, source
label) so door staff can see it is an external ticket.

### Import caps and error codes

Defined in `backend/convex/lib/imports/bulk.ts`:

- `MAX_IMPORT_BATCH_SIZE` = 500 rows per file. Files over the cap are rejected at
  preview — the client never silently chunks a file. Error code
  `BATCH_TOO_LARGE`; remedy is to split the file and import each part.
- `MAX_IMPORTED_ENTRIES_PER_EVENT` = 5000 cumulative imported entries per event.
  Error code `IMPORT_CAP_EXCEEDED`.
- Empty / header-only input: error code `IMPORT_EMPTY`.

### Remove a batch (including stale re-imports)

Batch removal requires event-edit access and is audit-logged (one entry per
removal, not one per row). Removing a batch that contains checked-in entries is
allowed; the operator is warned with the checked-in count, and the audit entry
records that count. Derived door totals drop accordingly (the imported check-in
counts are derived from the table, not from the ticket-scoped denormalized
counter, so removal is reflected immediately in the roster and the per-source
breakdown).

To remove a batch, use `events/imported_tickets.removeBatch` with the event's
`_id` and the batch's `batchKey` (visible on the imported-tickets section of the
buyers view, grouped per batch). To remove a single entry, use
`events/imported_tickets.removeEntry` with the entry `_id`.

### No liveness / revocation check (the refund caveat)

External barcodes are validated ONLY against the CSV that was imported — there
is no live check against the external platform. A ticket that was refunded or
revoked on RA after export **still scans** if it was present in the imported
CSV. This is intentional (out of scope: no API/OAuth integration with external
platforms). The remedy when this matters at the door:

1. Re-export a fresh attendee list from the external platform as close to doors
   as possible.
2. Re-import it. In the default "skip duplicates" mode, barcodes already present
   are skipped, so only genuinely new tickets are added.
3. Remove the stale batch(es) via `events/imported_tickets.removeBatch` so
   revoked barcodes no longer resolve. Removing a batch with checked-in entries
   is allowed with the checked-in-count warning.

Note that acceptance is limited to exact-match within the scanned event's
imported set, so a forged or copied barcode is contained by the same
duplicate-scan protection as native tickets, and external references never check
in across events.

### Privacy requests for imported entries

Imported names and emails are personal data. There is no account linkage to
resolve, so email is the only identifier. Use the operator redaction mutation
`internal.events.imported_tickets.redactByEmail` (args
`{email, operatorUserId}`; `cursor` is internal to the sweep — omit it) to redact
imported entries whose email matches a verified address across all events; it
clears the name/email to a tombstone while leaving the inert admission record and
its audit trail intact. The sweep is paginated and self-reschedules across
transactions (there is no email index), so the first call returns
`{redactedCount, isDone}` for the first page and later pages complete in the
background — confirm completion via the `imported_tickets.redact` audit entries
rather than the first return value. Full procedure and the identifier table
(including `importedTicketHolders.email`) live in
[Privacy Requests](./privacy-requests.md) → "Locate Braket Data".

### Import and imported-check-in audit actions

Batch-level, in the `check-in`/import audit categories (values in
`backend/convex/lib/admin_audit_actions.ts`):

- `guest.import` — guest bulk add batch.
- `imported_tickets.import` — external ticket import batch.
- `imported_tickets.remove` — single imported entry removal.
- `imported_tickets.batch_remove` — batch removal (records the checked-in count).
- `imported_tickets.check-in` — external ticket-holder check-in at the door.
- `imported_tickets.redact` — operator privacy redaction.

Audit entries and error messages carry counts, batch keys, and row indexes
only — never raw names or emails.
