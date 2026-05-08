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
- `backend/convex/communities/management/audit.ts`
- `frontend/src/app/features/admin/pages/check-in/check-in.component.ts`

Jump to:

- [Diagnose a failed check-in](#diagnose-a-failed-check-in)
- [Explain a count mismatch](#explain-a-count-mismatch)
- [Fix a roster mismatch](#fix-a-roster-mismatch)
- [Check missing audit logs](#check-missing-audit-logs)
- [Fix a roster export issue](#fix-a-roster-export-issue)
- [Handle oversized management data](#handle-oversized-management-data)

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
