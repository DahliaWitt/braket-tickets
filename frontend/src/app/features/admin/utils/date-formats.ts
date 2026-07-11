/**
 * Shared date formats for admin table/card UI timestamps
 * (Angular `DatePipe` / `formatDate` syntax).
 *
 * Admin surfaces previously mixed divergent formats ('medium', 'shortDate',
 * 'mediumDate', 'MMM d', …) so the same field rendered differently between the
 * desktop table and the mobile card of one component. These two constants keep
 * every reachable admin table/card timestamp on one pair of formats:
 *
 * - {@link ADMIN_DATE} — calendar dates where the time of day is noise
 *   (e.g. member joined, magic-link created/used/expires/deleted, purchase date
 *   in the attendee roster).
 * - {@link ADMIN_DATETIME} — timestamps where the time matters
 *   (e.g. application submitted, purchase created, resale listing created,
 *   audit log entry, marketing announcement scheduled/sent).
 *
 * Sites routing through these constants:
 * - `applications-table` (ADMIN_DATETIME)
 * - `audit-log-table` (ADMIN_DATETIME)
 * - `members-table` (ADMIN_DATE)
 * - `attendee-roster-table` (ADMIN_DATE)
 * - `marketing-announcement-card` (ADMIN_DATETIME)
 * - `community-admin` magic-link tables, desktop + mobile (ADMIN_DATE)
 * - `event-management-purchases-panel` (ADMIN_DATETIME)
 * - `event-management-resale-tab` (ADMIN_DATETIME)
 *
 * Deliberate exclusions (do NOT migrate these to the constants):
 * - `broadcast-email-tab` (`| date: 'short'`) — owned by a separate in-flight
 *   PR; leave its formatting alone.
 * - `events-table` (`| eventDate: 'mediumDate'`) — a different pipe for EVENT
 *   dates, not admin-table timestamps, with its own timezone handling.
 * - CSV/export generation (`attendee-export.service.ts`,
 *   `export-formatting.ts`) — file output, not on-screen UI; a separate concern
 *   with its own formatting requirements.
 */
export const ADMIN_DATE = 'MMM d, y';

export const ADMIN_DATETIME = 'MMM d, y, h:mm a';
