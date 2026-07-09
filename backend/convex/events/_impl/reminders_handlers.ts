import type {Id} from '../../_generated/dataModel';
import type {QueryCtx, MutationCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {guardEmailDedup, hasEmailDedup} from '../../lib/email_dedup';
import {rateLimiter} from '../../lib/rate_limits';
import {resolveEditableEventForCaller} from './editor';
import {
  countTicketReminderRecipients,
  loadTicketReminderRecipients,
  queueTicketPurchaseReminderEmails,
} from './reminders';
import {
  buildTicketReminderDedupKey,
  normalizeTicketReminderContent,
} from './reminder_content';
import {
  extractPlainText,
  renderValidatedRichBody,
} from '../../lib/email/rich_text_render';
import {
  validateRichBodyJson,
  type RichBodyDoc,
} from '../../lib/email/rich_text_validator';
import {
  areAllImagesConfirmed,
  buildImageUrlMap,
  collectImageStorageIds,
  recordPublishedEmailImages,
} from '../../lib/email/rich_text_images';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';
import {resolveSiteUrl} from '../../lib/site_url';
import {throwInvalidInput} from '../../lib/errors';
import {TICKET_REMINDER_SEGMENT} from '../../lib/events/validators';

export async function getTicketReminderAudience(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
) {
  await resolveEditableEventForCaller(ctx, ctx.db, args.eventId);

  const {approximateCount} = await countTicketReminderRecipients(
    ctx,
    args.eventId,
  );

  return {
    segment: TICKET_REMINDER_SEGMENT,
    recipientCount: approximateCount,
    missingOrganizer: false,
  };
}

/**
 * Ordering contract:
 *   auth → validate → committed-dedup read → audience load →
 *   soft-return (0 recipients) → dedup insert → rate-limit →
 *   unsub token gen + fan-out → history → audit
 *
 * The read-only committed-dedup check sits BEFORE audience load so a
 * retry of a committed send always returns early even if the current
 * audience later changes.
 *
 * The dedup insert sits AFTER audience load so zero-recipient sends
 * do not burn the 24h dedup slot — those paths `return` (committing
 * the transaction), and an inserted row before them would persist and
 * block legitimate retries.
 *
 * Rate-limit sits AFTER dedup insert so a retry of an already-committed
 * send sees the dedup early-return instead of consuming a rate-limit
 * token. If rate-limit throws, the whole transaction (including the
 * dedup row) rolls back.
 */
export async function sendTicketPurchaseReminder(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    subject: string;
    message: string;
    bodyJson?: string;
  },
) {
  // 1. Auth + authz
  const {userId, event} = await resolveEditableEventForCaller(
    ctx,
    ctx.db,
    args.eventId,
  );

  // 2. Validate BEFORE dedup — validation failures must not burn the dedup slot.
  //    Rich body (when present) is the source of truth for the plain text:
  //    validateRichBodyJson throws INVALID_INPUT on any allowlist/scheme/size
  //    violation, and the extracted plain text is length-validated below.
  let richDoc: RichBodyDoc | undefined;
  let messageSource = args.message;
  let imageStorageIds: string[] = [];
  if (args.bodyJson !== undefined) {
    richDoc = validateRichBodyJson(args.bodyJson);
    messageSource = extractPlainText(richDoc);
    imageStorageIds = collectImageStorageIds(richDoc);
  }
  const {subject, message} = normalizeTicketReminderContent({
    subject: args.subject,
    message: messageSource,
  });

  // Security gate: every inline image MUST reference a confirmed upload OWNED
  // BY THE SENDER. Blocks a forged bodyJson embedding an arbitrary remote host,
  // an unconfirmed/forged storage id, or another user's confirmed upload. Runs
  // before dedup so a rejected send never burns the dedup slot. Throws
  // INVALID_INPUT to match this handler's style.
  if (
    imageStorageIds.length > 0 &&
    !(await areAllImagesConfirmed(ctx, userId, imageStorageIds))
  ) {
    throwInvalidInput(
      'Message contains an image that is not a confirmed upload',
    );
  }

  // Render once, BEFORE the dedup read: the renderer enforces the rendered-size
  // amplification cap, and an over-cap (or unresolved-image) body must fail
  // validation without burning the dedup slot. Rendering is cheap under the
  // 32KB input/output caps and identical across recipients; each confirmed
  // image resolves to a durable server-owned URL on the api-site base.
  const bodyHtml = richDoc
    ? renderValidatedRichBody(
        richDoc,
        buildImageUrlMap(
          imageStorageIds,
          resolveEmailApiBaseUrl(resolveSiteUrl()),
        ),
      )
    : undefined;

  // 3. Dedup READ — cheap early exit for client retries of committed sends
  const dedupKey = buildTicketReminderDedupKey({
    userId,
    eventId: args.eventId,
    subject,
  });
  if (await hasEmailDedup(ctx, dedupKey)) {
    return {segment: TICKET_REMINDER_SEGMENT, recipientCount: 0};
  }

  // 4. Load audience (bounded reads — candidate-first with indexed pref lookups)
  const {recipients} = await loadTicketReminderRecipients(ctx, args.eventId);

  // 5. Soft-return: zero recipients → don't burn the dedup slot
  if (recipients.length === 0) {
    return {segment: TICKET_REMINDER_SEGMENT, recipientCount: 0};
  }

  // 6. Dedup INSERT — only burns the slot when we're committed to sending
  const alreadySent = await guardEmailDedup(ctx, dedupKey);
  if (alreadySent) {
    return {segment: TICKET_REMINDER_SEGMENT, recipientCount: 0};
  }

  // 7. Rate limit — after dedup so retries see "already sent" not "rate limited"
  await rateLimiter.limit(ctx, 'ticketPurchaseReminder', {
    key: `${userId}:${args.eventId}`,
    throws: true,
  });

  // 8. Resolve organizer name for email template
  const organizer = await ctx.db.get('organizers', event.organizerId);
  const organizerName = organizer?.name ?? 'your community';

  // 9. Queue emails (unsub tokens generated per-recipient inside; the shared
  //    rich HTML was rendered once, pre-dedup, in step 2).
  // Register the inline images as published-in-a-sent-email — the public
  // /api/images route serves ONLY registered images. Same transaction as the
  // queued sends, so recipients can never open an email whose images are not
  // yet servable.
  await recordPublishedEmailImages(ctx, imageStorageIds);

  const recipientCount = await queueTicketPurchaseReminderEmails(ctx, {
    event,
    recipients,
    subject,
    message,
    bodyHtml,
    organizerName,
  });

  // 10. Record send history
  await ctx.db.insert('ticketReminderSends', {
    eventId: args.eventId,
    adminId: userId,
    subject,
    message,
    // Persist the SANITIZED document, never the raw client string: the raw
    // bodyJson carries signed preview image URLs (capability URLs) and any
    // attributes the validator stripped, which must not outlive the request.
    bodyJson: richDoc ? JSON.stringify(richDoc) : undefined,
    recipientCount,
    sentAt: Date.now(),
  });

  // 11. Audit log
  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: userId,
      action: 'event.reminder-email.send.approved_no_ticket',
      eventId: args.eventId,
      organizerId: event.organizerId,
      source: 'admin-ui',
    },
  );

  return {
    segment: TICKET_REMINDER_SEGMENT,
    recipientCount,
  };
}
