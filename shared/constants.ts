export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_TICKET_REMINDER_SUBJECT_LENGTH = 200;
export const MAX_TICKET_REMINDER_MESSAGE_LENGTH = 5000;

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
