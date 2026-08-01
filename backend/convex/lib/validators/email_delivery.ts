import {v, type Infer} from 'convex/values';
import type {AssertEqual} from '../type_utils';

export const EMAIL_DELIVERY_SOURCES = [
  'announcement',
  'broadcast',
  'digest',
  // 'reminder' has no current producer — kept so historical emailDeliveries /
  // emailDeliveryFailures rows from the deleted vetting-reminder feature
  // continue to read-validate. Live ticket-purchase reminders use 'event'.
  'reminder',
  'application',
  'admin_invite',
  'event',
  'ticket',
  'payout',
  'resale_available',
  'auth',
  'guest_list_invite',
] as const;
export type EmailDeliverySource = (typeof EMAIL_DELIVERY_SOURCES)[number];

export const emailDeliverySourceValidator = v.union(
  v.literal(EMAIL_DELIVERY_SOURCES[0]),
  v.literal(EMAIL_DELIVERY_SOURCES[1]),
  v.literal(EMAIL_DELIVERY_SOURCES[2]),
  v.literal(EMAIL_DELIVERY_SOURCES[3]),
  v.literal(EMAIL_DELIVERY_SOURCES[4]),
  v.literal(EMAIL_DELIVERY_SOURCES[5]),
  v.literal(EMAIL_DELIVERY_SOURCES[6]),
  v.literal(EMAIL_DELIVERY_SOURCES[7]),
  v.literal(EMAIL_DELIVERY_SOURCES[8]),
  v.literal(EMAIL_DELIVERY_SOURCES[9]),
  v.literal(EMAIL_DELIVERY_SOURCES[10]),
  v.literal(EMAIL_DELIVERY_SOURCES[11]),
);

const _emailDeliverySourceValidatorMatchesType: AssertEqual<
  Infer<typeof emailDeliverySourceValidator>,
  EmailDeliverySource
> = true;

/**
 * Sentinel written to `emailDeliveries.recipientKey` when the recorded
 * recipient cannot be normalized (empty or whitespace-only address).
 *
 * Leaving the field unset would keep such rows in the "legacy, not yet
 * backfilled" bucket forever: `hasDelivery`'s bounded fallback scans rows whose
 * `recipientKey` is `undefined`, so permanently unkeyed rows accumulate against
 * the 100-row cap and can eventually fail every recipient-scoped send for that
 * source, even after the backfill has verifiably completed.
 *
 * The value contains uppercase characters, which `normalizeEmail` (trim +
 * lowercase) can never produce, so it can never collide with a real lookup key.
 */
export const UNNORMALIZABLE_RECIPIENT_KEY = '!UNNORMALIZABLE';

/**
 * Stable error code for the fail-closed branch in `email_delivery.hasDelivery`.
 * Thrown as a structured `ConvexError` so the code survives production error
 * redaction, which replaces every plain `Error` message with "Server Error".
 */
export const EMAIL_DELIVERY_LEGACY_RECIPIENT_SCAN_EXCEEDED =
  'EMAIL_DELIVERY_LEGACY_RECIPIENT_SCAN_EXCEEDED';

export const emailAttachmentValidator = v.object({
  filename: v.string(),
  content: v.string(),
  encoding: v.optional(v.string()),
  contentType: v.optional(v.string()),
  cid: v.optional(v.string()),
});

/**
 * Renderable email payload fields shared by the provider delivery contract.
 */
const emailPayloadArgs = {
  to: v.string(),
  subject: v.string(),
  html: v.string(),
  text: v.optional(v.string()),
  headers: v.optional(v.record(v.string(), v.string())),
  attachments: v.optional(v.array(emailAttachmentValidator)),
} as const;

/**
 * The single delivery contract for provider dispatch actions
 * (smtp.sendPreview, resend_actions.send): the renderable payload plus
 * delivery-tracking metadata. Internal-only dispatch flags such as
 * `requireDelivery` are NOT part of this contract — the wrapper in
 * lib/email_delivery_wrapper.ts folds them into `critical` before dispatch,
 * and provider validators reject extra fields. (Sole exception: for one
 * release, resend_actions.send tolerates and ignores `requireDelivery` so
 * jobs scheduled by the pre-contract wrapper survive the deploy window.)
 */
export const providerEmailDeliveryArgs = {
  ...emailPayloadArgs,
  source: emailDeliverySourceValidator,
  sourceId: v.string(),
  recipient: v.string(),
  critical: v.optional(v.boolean()),
} as const;
