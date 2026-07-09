export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_TICKET_REMINDER_SUBJECT_LENGTH = 200;
export const MAX_TICKET_REMINDER_MESSAGE_LENGTH = 5000;

/**
 * Maximum span between an event's start (`date`) and its optional `endDate`.
 *
 * Two jobs: a data-integrity guard (rejects typo'd end dates, e.g. a wrong
 * year), and the completeness invariant for "upcoming" discovery. A running
 * multi-day event's start can be at most this far in the past, so the listing
 * loaders look back exactly this window on the `date` index to include every
 * event that has started but not yet ended (see hasEventEnded) without a scan
 * that another event could crowd out. The window couples cap to read cost, so
 * this is set generously for real events (a multi-day festival fits) but not
 * so wide that the lookback scan grows unbounded.
 */
export const MAX_EVENT_DURATION_DAYS = 30;
export const MAX_EVENT_DURATION_MS =
  MAX_EVENT_DURATION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Number of days after an event before revenue is automatically paid out
 * to the organizer's Stripe Connect account.
 *
 * Set to 3 days -- fast end of industry standard (RA ~3-5d, Eventbrite 3d,
 * DICE 5d, Secret Party 7d). Balances organizer cash flow with chargeback
 * risk mitigation window.
 */
export const PAYOUT_DELAY_DAYS = 3;
export const PAYOUT_DELAY_MS = PAYOUT_DELAY_DAYS * 24 * 60 * 60 * 1000;

/**
 * User-facing copy when a password is rejected by the HaveIBeenPwned breach
 * check (Better Auth haveIBeenPwned plugin). Shared so the server-side
 * plugin message and the frontend error mapping cannot drift.
 * Lowercase per brand voice.
 */
export const COMPROMISED_PASSWORD_MESSAGE =
  'this password has appeared in a known data breach, so it cannot keep your account safe. please choose a different password.';

/**
 * Legal document versions stamped on guest ToS assent evidence (BRA-455).
 *
 * These must be bumped whenever the corresponding "last updated" / "effective
 * date" line in the legal page changes, so a new version is recorded on every
 * order created after the document changes. The LINT.IfChange/LINT.ThenChange
 * pairs below couple each constant to its legal HTML page bidirectionally, so a
 * change to either side flags the other.
 *
 * - LEGAL_TERMS_VERSION mirrors "Last Updated: May 11, 2026" in
 *   frontend/src/app/features/legal/pages/terms-of-service/terms-of-service.html
 * - LEGAL_PRIVACY_VERSION mirrors "Effective Date: May 15, 2026" in
 *   frontend/src/app/features/legal/pages/privacy-policy/privacy-policy.html
 */
// LINT.IfChange
export const LEGAL_TERMS_VERSION = '2026-05-11';
// LINT.ThenChange('../frontend/src/app/features/legal/pages/terms-of-service/terms-of-service.html')
// LINT.IfChange
export const LEGAL_PRIVACY_VERSION = '2026-05-15';
// LINT.ThenChange('../frontend/src/app/features/legal/pages/privacy-policy/privacy-policy.html')
