import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {rateLimiter} from '../../lib/rate_limits';
import {guardEmailDedup, hasEmailDedup} from '../../lib/email_dedup';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {hasConfiguredEmailDeliveryCredentials} from '../../lib/email_delivery_mode';
import {logger} from '../../lib/logger';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';
import {resolveSiteUrl} from '../../lib/site_url';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
  normalizeEmailOrNull,
  validateStringLength,
} from '../../lib/validation';
import {eventBroadcastTemplate} from '../../email/templates';
import {
  ensureAddressMarketingPreferenceForSend,
  ensureUserMarketingPreferenceForSend,
} from '../../lib/audience/eager_preference';
import {canEditEvent, requireEventForEdit} from '../../lib/access';
import {requireUser} from '../../lib/auth_identity';
import {isTestEnvironment, isUnitTestRuntime} from '../../lib/environment';
import {getAppErrorMessage, throwUnauthorized} from '../../lib/errors';
import {
  loadBroadcastAudienceUpToLimit,
  loadExactBroadcastAudience,
} from './broadcasts';

export const MAX_BROADCAST_RECIPIENTS = 500;

export async function getBroadcastAudience(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; includeExternalTicketHolders?: boolean},
) {
  await requireEventForEdit(ctx, args.eventId);

  // Default ON, matching the send toggle: the previewed recipient count
  // reflects the same audience a send with the default toggle would target.
  const includeExternal = args.includeExternalTicketHolders ?? true;
  const audience = await loadExactBroadcastAudience(ctx.db, args.eventId, {
    includeRecipients: false,
    includeExternalTicketHolders: includeExternal,
  });
  return {
    recipientCount: audience.recipientCount,
    exceedsCap: audience.recipientCount > MAX_BROADCAST_RECIPIENTS,
    // Reachability split so the compose UI can render "includes N external
    // ticket holders" (and how many carry no email and thus cannot be reached).
    importedReachableCount: audience.importedReachableCount,
    importedUnreachableCount: audience.importedUnreachableCount,
  };
}

export async function listBroadcastHistory(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
) {
  await requireEventForEdit(ctx, args.eventId);

  const broadcasts = await ctx.db
    .query('eventBroadcasts')
    .withIndex('by_event_and_sentAt', (q) => q.eq('eventId', args.eventId))
    .order('desc')
    .take(100);

  return Promise.all(
    broadcasts.map(async (broadcast) => {
      const admin = await ctx.db.get('users', broadcast.adminId);
      return {
        _id: broadcast._id,
        subject: broadcast.subject,
        recipientCount: broadcast.recipientCount,
        sentAt: broadcast.sentAt,
        adminName: admin?.name ?? 'Unknown',
      };
    }),
  );
}

interface BroadcastEmailRecipient {
  /** Normalized email (trim + lowercase). */
  email: string;
  userId?: Id<'users'>;
  userGlobalOptOut?: boolean;
}

/**
 * Renders and enqueues one broadcast email for one recipient, resolving the
 * recipient-kind unsubscribe token and preference-center URL. Shared by the
 * send-time fan-out and the late-buyer catch-up path so template args and
 * delivery metadata cannot drift between them.
 */
async function sendBroadcastEmailToRecipient(
  ctx: MutationCtx,
  args: {
    broadcastId: Id<'eventBroadcasts'>;
    event: Pick<
      Doc<'events'>,
      '_id' | 'title' | 'date' | 'location' | 'organizerId'
    >;
    organizerName: string;
    subject: string;
    message: string;
    siteUrl: string;
    apiSiteUrl: string;
    recipient: BroadcastEmailRecipient;
  },
): Promise<void> {
  const {event, recipient} = args;

  let unsubToken: string;
  let preferenceCenterUrl = `${args.siteUrl}/account#email-preferences`;

  if (recipient.userId) {
    unsubToken = await ensureUserMarketingPreferenceForSend(ctx.db, {
      userId: recipient.userId,
      organizerId: event.organizerId,
      userGlobalOptOut: recipient.userGlobalOptOut === true,
    });
  } else {
    unsubToken = await ensureAddressMarketingPreferenceForSend(ctx.db, {
      email: recipient.email,
      organizerId: event.organizerId,
    });
    preferenceCenterUrl = `${args.siteUrl}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  }

  const {html, text, headers} = eventBroadcastTemplate({
    event: {
      _id: event._id,
      title: event.title,
      date: event.date,
      location: event.location,
    },
    organizer: {
      id: event.organizerId,
      name: args.organizerName,
    },
    message: args.message,
    siteUrl: args.siteUrl,
    apiSiteUrl: args.apiSiteUrl,
    unsubToken,
    preferenceCenterUrl,
  });

  await enqueueEmailDelivery(
    ctx,
    {to: recipient.email, subject: args.subject, html, text, headers},
    {
      source: 'broadcast',
      sourceId: args.broadcastId as string,
      recipient: recipient.email,
    },
  );
}

export async function sendBroadcast(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    subject: string;
    message: string;
    includeExternalTicketHolders?: boolean;
  },
) {
  const {_id: userId} = await requireUser(ctx);

  // Ordering contract:
  //   auth → existence → authz → validation → committed-dedup read →
  //   audience load → dedup insert → rate-limit → insert+fan-out
  //
  // The read-only committed-dedup check sits BEFORE audience load so a
  // retry of a committed send always returns `already_sent` even if the
  // current audience later shrinks to zero or grows past the cap.
  //
  // The dedup insert sits AFTER audience load so the soft-return paths
  // (`no_recipients`, `too_many_recipients`) do not burn the 24h dedup
  // slot — those paths `return` (commit the transaction), so an inserted
  // row before them would persist and block legitimate retries.
  //
  // Dedup sits BEFORE rate-limit so a user clicking "send" twice on the
  // same subject sees `already_sent` instead of a `RateLimited` error;
  // the retry is already known-duplicate so it should not consume a
  // rate-limit token. If rate-limit throws here, the whole transaction
  // (including the dedup row) rolls back, so a transient rate-limit
  // failure does NOT permanently block the send.

  // Intentionally NOT using `requireEventForEdit` here: this function
  // returns a soft `{success: false, error: 'event_not_found'}` result
  // for a missing event rather than throwing NOT_FOUND, which preserves
  // the caller's ability to handle the missing-event case gracefully
  // without a try/catch. The composed helper would change the API
  // contract by throwing instead.
  const eventExists = await ctx.db.get('events', args.eventId);
  if (!eventExists) {
    return {success: false as const, error: 'event_not_found' as const};
  }
  if (!(await canEditEvent(ctx, userId, eventExists))) {
    throwUnauthorized();
  }
  const event = eventExists;

  const subject = args.subject.trim();
  const message = args.message.trim();

  if (!subject) {
    return {
      success: false as const,
      error: 'validation_error' as const,
      message: 'Subject is required',
    };
  }
  if (!message) {
    return {
      success: false as const,
      error: 'validation_error' as const,
      message: 'Message is required',
    };
  }

  try {
    validateStringLength(
      subject,
      'Subject',
      MAX_TICKET_REMINDER_SUBJECT_LENGTH,
    );
    validateStringLength(
      message,
      'Message',
      MAX_TICKET_REMINDER_MESSAGE_LENGTH,
    );
  } catch (error) {
    return {
      success: false as const,
      error: 'validation_error' as const,
      message: getAppErrorMessage(error) ?? 'Validation failed',
    };
  }

  // Per-segment dedup. The base audience (native ticket holders + guests) is
  // independent of the external-inclusion toggle; the external segment is the
  // imported ticket holders whose email is NOT already a base recipient. Each
  // segment is deduped under its own key so a same-subject retry that BROADENS
  // the audience (external off -> on) reaches the newly included external
  // holders without re-emailing native recipients — and the reverse (narrowing,
  // or re-sending) still short-circuits as already_sent.
  //
  // Subject is included in full (not truncated) so two subjects that share a
  // prefix but differ past any slice boundary do not collide. Validation caps
  // subject at MAX_TICKET_REMINDER_SUBJECT_LENGTH.
  const wantExternal = args.includeExternalTicketHolders ?? true;
  const baseDedupKey = `broadcast:${userId}:${args.eventId}:${subject}`;
  const externalDedupKey = `broadcast:ext:${userId}:${args.eventId}:${subject}`;

  // Base audience is toggle-independent; the full audience adds external
  // holders when the toggle is on. Both are bounded by the send cap probe.
  const baseAudience = await loadBroadcastAudienceUpToLimit(
    ctx.db,
    args.eventId,
    MAX_BROADCAST_RECIPIENTS + 1,
    {includeExternalTicketHolders: false},
  );
  const fullAudience = wantExternal
    ? await loadBroadcastAudienceUpToLimit(
        ctx.db,
        args.eventId,
        MAX_BROADCAST_RECIPIENTS + 1,
        {includeExternalTicketHolders: true},
      )
    : baseAudience;

  if (fullAudience.recipientCount === 0) {
    return {success: false as const, error: 'no_recipients' as const};
  }

  // External-only recipients are full-audience emails not covered by the base
  // (native/guest) audience — an imported email that collides with a native
  // purchaser is a base recipient, never double-counted here.
  const baseEmailKeys = new Set(
    (baseAudience.recipients ?? []).map(
      (r) => normalizeEmailOrNull(r.email) ?? r.email,
    ),
  );
  const externalOnlyRecipients = (fullAudience.recipients ?? []).filter(
    (r) => !baseEmailKeys.has(normalizeEmailOrNull(r.email) ?? r.email),
  );

  const baseRecipients = baseAudience.recipients ?? [];

  // A segment is "fresh" when it has recipients and its dedup key is not yet
  // committed. Determine freshness before any cap rejection.
  const baseFresh =
    baseRecipients.length > 0 && !(await hasEmailDedup(ctx, baseDedupKey));
  const externalFresh =
    wantExternal &&
    externalOnlyRecipients.length > 0 &&
    !(await hasEmailDedup(ctx, externalDedupKey));

  // Nothing new to send → already_sent. This precedes the cap check so a
  // legitimately-committed broadcast keeps returning already_sent on retry even
  // if its audience later grows past the cap.
  if (!baseFresh && !externalFresh) {
    return {success: false as const, error: 'already_sent' as const};
  }

  // Cap applies only to the segment(s) being freshly sent.
  if (baseFresh && !baseAudience.isComplete) {
    return {
      success: false as const,
      error: 'too_many_recipients' as const,
      count: baseAudience.recipientCount,
    };
  }
  if (externalFresh && !fullAudience.isComplete) {
    return {
      success: false as const,
      error: 'too_many_recipients' as const,
      count: fullAudience.recipientCount,
    };
  }

  let siteUrl: string;
  try {
    siteUrl = resolveSiteUrl();
  } catch (error) {
    return {
      success: false as const,
      error: 'validation_error' as const,
      message:
        getAppErrorMessage(error) ??
        'SITE_URL is not set. Set it in the Convex environment for this deployment.',
    };
  }

  if (!hasConfiguredEmailDeliveryCredentials()) {
    const allowMissingEmailConfig = isUnitTestRuntime() || isTestEnvironment();
    if (!allowMissingEmailConfig) {
      return {
        success: false as const,
        error: 'validation_error' as const,
        message:
          'Email delivery is not configured (missing Resend or preview SMTP credentials).',
      };
    }
  }

  // Authoritative guard for each fresh segment. guardEmailDedup inserts the key
  // and returns true if a concurrent send already claimed it (OCC race) — in
  // that case the segment is dropped. A guard on an empty segment never fires,
  // so an empty base send does not block a later native-only broadcast.
  const sendBase = baseFresh && !(await guardEmailDedup(ctx, baseDedupKey));
  const sendExternal =
    externalFresh && !(await guardEmailDedup(ctx, externalDedupKey));

  const recipients = [
    ...(sendBase ? baseRecipients : []),
    ...(sendExternal ? externalOnlyRecipients : []),
  ];
  if (recipients.length === 0) {
    return {success: false as const, error: 'already_sent' as const};
  }

  // Rate-limit AFTER dedup so a retry of an already-committed send
  // surfaces as `already_sent` rather than consuming a rate-limit token
  // and returning `RateLimited`. A rate-limit failure here rolls back
  // the dedup rows (transactional), so transient rate-limit errors do
  // not permanently block a legitimate retry.
  await rateLimiter.limit(ctx, 'broadcastEmail', {
    key: `${userId}:${args.eventId}`,
    throws: true,
  });
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);
  const organizer = await ctx.db.get('organizers', event.organizerId);
  const organizerName = organizer?.name ?? 'your community';

  const sentAt = Date.now();
  const broadcastId = await ctx.db.insert('eventBroadcasts', {
    eventId: args.eventId,
    adminId: userId,
    subject,
    message,
    recipientCount: recipients.length,
    sentAt,
  });

  await Promise.all(
    recipients.map(async (recipient) => {
      // Same transaction as the broadcast insert and the enqueue: a
      // rolled-back send leaves no delivery row behind.
      await ctx.db.insert('eventBroadcastDeliveries', {
        broadcastId,
        eventId: args.eventId,
        email: recipient.email,
        sentAt,
        origin: 'send',
      });
      await sendBroadcastEmailToRecipient(ctx, {
        broadcastId,
        event,
        organizerName,
        subject,
        message,
        siteUrl,
        apiSiteUrl,
        recipient,
      });
    }),
  );

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: userId,
      action: 'event.broadcast-email.send.all_holders',
      eventId: args.eventId,
      organizerId: event.organizerId,
      source: 'admin-ui',
    },
  );

  return {success: true as const, recipientCount: recipients.length};
}

/**
 * Catch-up path for recipients who join an event's broadcast audience after
 * a send (late primary purchase, resale purchase, late guest add). Sends
 * every broadcast the email has no `eventBroadcastDeliveries` row for,
 * oldest-first, recording a `catchup` row per send in the same transaction.
 *
 * Scheduled via `internal.events.broadcasts.deliverMissed`; there is no
 * user to surface errors to, so skip paths log and return instead of
 * throwing. Environment-guard skips intentionally do NOT record delivery
 * rows, so a later qualifying purchase retriggers catch-up.
 */
export async function deliverMissedBroadcasts(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    email: string;
    userId?: Id<'users'>;
  },
): Promise<null> {
  const email = normalizeEmailOrNull(args.email);
  if (!email) return null;

  // Same bound as listBroadcastHistory; admin sends are rate-limited so
  // 100 broadcasts is far above any real event.
  const broadcasts = await ctx.db
    .query('eventBroadcasts')
    .withIndex('by_event_and_sentAt', (q) => q.eq('eventId', args.eventId))
    .order('desc')
    .take(100);
  if (broadcasts.length === 0) return null;

  // Check each loaded broadcast individually via `by_broadcast_and_email` so
  // `missed` is derived from the exact broadcasts loaded above. A capped
  // `by_event_and_email` scan could return a different 100-row window than the
  // broadcasts query (deliveries oldest-first, broadcasts newest-first), which
  // on an event with >100 broadcasts could resend already-delivered ones.
  const deliveryRows = await Promise.all(
    broadcasts.map((broadcast) =>
      ctx.db
        .query('eventBroadcastDeliveries')
        .withIndex('by_broadcast_and_email', (q) =>
          q.eq('broadcastId', broadcast._id).eq('email', email),
        )
        .first(),
    ),
  );
  const missed = broadcasts.filter((_, index) => deliveryRows[index] === null);
  if (missed.length === 0) return null;

  let siteUrl: string;
  try {
    siteUrl = resolveSiteUrl();
  } catch {
    logger.warn(
      'broadcasts',
      'deliverMissed: SITE_URL is not set; skipping catch-up',
      {eventId: args.eventId},
    );
    return null;
  }

  if (!hasConfiguredEmailDeliveryCredentials()) {
    const allowMissingEmailConfig = isUnitTestRuntime() || isTestEnvironment();
    if (!allowMissingEmailConfig) {
      logger.warn(
        'broadcasts',
        'deliverMissed: email delivery is not configured; skipping catch-up',
        {eventId: args.eventId},
      );
      return null;
    }
  }

  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    logger.warn('broadcasts', 'deliverMissed: event no longer exists', {
      eventId: args.eventId,
    });
    return null;
  }
  const organizer = await ctx.db.get('organizers', event.organizerId);
  const organizerName = organizer?.name ?? 'your community';
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);

  let recipient: BroadcastEmailRecipient = {email};
  if (args.userId) {
    const user = await ctx.db.get('users', args.userId);
    recipient = {
      email,
      userId: args.userId,
      userGlobalOptOut: user?.globalMarketingOptOut === true,
    };
  }

  // Oldest-first so inbox order matches send order. Sends run sequentially:
  // a mid-loop throw rolls back the whole transaction, so there is no
  // partial state to guard against. Concurrent duplicates are prevented by
  // OCC: each per-broadcast `by_broadcast_and_email` read above conflicts with
  // a concurrent insert of that same delivery row, so one transaction retries
  // and re-reads the committed rows.
  for (const broadcast of [...missed].reverse()) {
    await ctx.db.insert('eventBroadcastDeliveries', {
      broadcastId: broadcast._id,
      eventId: args.eventId,
      email,
      sentAt: Date.now(),
      origin: 'catchup',
    });
    await sendBroadcastEmailToRecipient(ctx, {
      broadcastId: broadcast._id,
      event,
      organizerName,
      subject: broadcast.subject,
      message: broadcast.message,
      siteUrl,
      apiSiteUrl,
      recipient,
    });
  }

  return null;
}
