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
  },
) {
  // 1. Auth + authz
  const {userId, event} = await resolveEditableEventForCaller(
    ctx,
    ctx.db,
    args.eventId,
  );

  // 2. Validate BEFORE dedup — validation failures must not burn the dedup slot
  const {subject, message} = normalizeTicketReminderContent(args);

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

  // 9. Queue emails (unsub tokens generated per-recipient inside)
  const recipientCount = await queueTicketPurchaseReminderEmails(ctx, {
    event,
    recipients,
    subject,
    message,
    organizerName,
  });

  // 10. Record send history
  await ctx.db.insert('ticketReminderSends', {
    eventId: args.eventId,
    adminId: userId,
    subject,
    message,
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
