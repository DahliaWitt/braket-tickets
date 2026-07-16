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
);

const _emailDeliverySourceValidatorMatchesType: AssertEqual<
  Infer<typeof emailDeliverySourceValidator>,
  EmailDeliverySource
> = true;

export const emailAttachmentValidator = v.object({
  filename: v.string(),
  content: v.string(),
  encoding: v.optional(v.string()),
  contentType: v.optional(v.string()),
  cid: v.optional(v.string()),
});

/**
 * Renderable email payload accepted by every provider action
 * (smtp.sendPreview, smtp.sendFallback, resend_actions.send).
 */
export const emailPayloadArgs = {
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
