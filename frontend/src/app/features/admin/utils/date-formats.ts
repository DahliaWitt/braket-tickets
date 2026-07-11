/**
 * Shared admin-surface date formats (Angular `DatePipe` / `formatDate` syntax).
 *
 * Admin tables previously mixed six divergent formats ('medium', 'short',
 * 'shortDate', 'mediumDate', hand-rolled `toLocaleDateString`, …) so the same
 * field rendered differently between the desktop table and the mobile card of
 * one component. Every admin component formats through these two constants:
 *
 * - {@link ADMIN_DATE} — calendar dates where the time of day is noise
 *   (e.g. member joined).
 * - {@link ADMIN_DATETIME} — timestamps where the time matters
 *   (e.g. application submitted, purchase created, listing created, audit log).
 */
export const ADMIN_DATE = 'MMM d, y';

export const ADMIN_DATETIME = 'MMM d, y, h:mm a';
