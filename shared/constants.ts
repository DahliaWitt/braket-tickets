export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_TICKET_REMINDER_SUBJECT_LENGTH = 200;
export const MAX_TICKET_REMINDER_MESSAGE_LENGTH = 5000;

/**
 * Maximum UTF-8 byte length of a serialized ProseMirror-JSON rich email body
 * (`bodyJson`).
 *
 * Bounds parse/validation cost for broadcast and ticket-reminder rich bodies
 * and stays well under the Convex 1MB document limit while giving ~6x headroom
 * over the {@link MAX_TICKET_REMINDER_MESSAGE_LENGTH} plain-text cap (which is
 * enforced separately on the extracted plain text). This caps the raw JSON
 * string; the extracted plain text is still validated against the message cap.
 */
export const MAX_RICH_EMAIL_BODY_JSON_BYTES = 32768;

/**
 * Maximum UTF-8 byte length of the RENDERED rich-body HTML fragment.
 *
 * The JSON byte cap alone does not bound output size: every block node gains a
 * long inline `style` attribute when rendered, so a small document of mostly
 * empty nodes can amplify severalfold — and broadcast fan-out multiplies the
 * rendered payload by up to 500 recipients. Capping the fragment at the same
 * budget as the input JSON limits the amplification factor to 1 and keeps the
 * full email (fragment + branded shell) under Gmail's ~102KB clipping
 * threshold. Enforced inside the renderer, before any dedup/history/publication
 * writes, so an over-cap body is a plain validation failure.
 */
export const MAX_RICH_EMAIL_RENDERED_HTML_BYTES = 32768;

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
