import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {rateLimiter} from '../../lib/rate_limits';
import {guardEmailDedup, hasEmailDedup} from '../../lib/email_dedup';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {hasConfiguredEmailDeliveryCredentials} from '../../lib/email_delivery_mode';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';
import {resolveSiteUrl} from '../../lib/site_url';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
  validateStringLength,
} from '../../lib/validation';
import {eventBroadcastTemplate} from '../../email/templates';
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
  args: {eventId: Id<'events'>},
) {
  await requireEventForEdit(ctx, args.eventId);

  const audience = await loadExactBroadcastAudience(ctx.db, args.eventId, {
    includeRecipients: false,
  });
  return {
    recipientCount: audience.recipientCount,
    exceedsCap: audience.recipientCount > MAX_BROADCAST_RECIPIENTS,
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

export async function sendBroadcast(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    subject: string;
    message: string;
    bodyJson?: string;
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

  // Rich body is the source of truth for the plain text when present: validate
  // + render it, then derive the canonical plain text (used for the stored
  // message column, length validation, and the plain-text email part). A
  // validation failure returns the soft validation_error contract, matching the
  // rest of this handler, rather than throwing.
  let richDoc: RichBodyDoc | null = null;
  let imageStorageIds: string[] = [];
  if (args.bodyJson !== undefined) {
    try {
      richDoc = validateRichBodyJson(args.bodyJson);
    } catch (error) {
      return {
        success: false as const,
        error: 'validation_error' as const,
        message: getAppErrorMessage(error) ?? 'Invalid message content',
      };
    }
    imageStorageIds = collectImageStorageIds(richDoc);
  }
  const message = (richDoc ? extractPlainText(richDoc) : args.message).trim();

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

  // Security gate: every inline image MUST reference a confirmed upload OWNED
  // BY THE SENDER. This blocks a forged bodyJson embedding an arbitrary remote
  // host (tracking pixel / third-party image), a storage id we never confirmed,
  // or another user's confirmed upload. Runs before the dedup insert so a
  // rejected send never burns the dedup slot.
  if (imageStorageIds.length > 0) {
    if (!(await areAllImagesConfirmed(ctx, userId, imageStorageIds))) {
      return {
        success: false as const,
        error: 'validation_error' as const,
        message: 'Message contains an image that is not a confirmed upload',
      };
    }
  }

  // Render once, BEFORE the dedup read: the renderer enforces the rendered-size
  // amplification cap, and an over-cap (or unresolved-image) body must be a
  // plain validation failure that never burns the dedup slot. Rendering is
  // cheap under the 32KB input/output caps and identical across recipients;
  // each confirmed image resolves to a durable server-owned URL.
  let bodyHtml: string | undefined;
  if (richDoc) {
    try {
      bodyHtml = renderValidatedRichBody(
        richDoc,
        buildImageUrlMap(
          imageStorageIds,
          resolveEmailApiBaseUrl(resolveSiteUrl()),
        ),
      );
    } catch (error) {
      return {
        success: false as const,
        error: 'validation_error' as const,
        message: getAppErrorMessage(error) ?? 'Invalid message content',
      };
    }
  }

  const dedupKey = `broadcast:${userId}:${args.eventId}:${subject}`;
  if (await hasEmailDedup(ctx, dedupKey)) {
    return {success: false as const, error: 'already_sent' as const};
  }

  const audience = await loadBroadcastAudienceUpToLimit(
    ctx.db,
    args.eventId,
    MAX_BROADCAST_RECIPIENTS + 1,
  );

  if (audience.recipientCount === 0) {
    return {success: false as const, error: 'no_recipients' as const};
  }

  if (!audience.isComplete) {
    return {
      success: false as const,
      error: 'too_many_recipients' as const,
      count: audience.recipientCount,
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

  // Dedup guard: server-generated key prevents client-side bypass.
  // Subject is included in full (not truncated) so two subjects that
  // share a prefix but differ past any slice boundary do not collide.
  // Validation caps subject at MAX_TICKET_REMINDER_SUBJECT_LENGTH.
  const alreadySent = await guardEmailDedup(ctx, dedupKey);
  if (alreadySent) {
    return {success: false as const, error: 'already_sent' as const};
  }

  // Rate-limit AFTER dedup so a retry of an already-committed send
  // surfaces as `already_sent` rather than consuming a rate-limit token
  // and returning `RateLimited`. A rate-limit failure here rolls back
  // the dedup row (transactional), so transient rate-limit errors do
  // not permanently block a legitimate retry.
  await rateLimiter.limit(ctx, 'broadcastEmail', {
    key: `${userId}:${args.eventId}`,
    throws: true,
  });

  const recipients = audience.recipients ?? [];
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);
  const accountPreferenceUrl = `${siteUrl}/account#email-preferences`;
  const organizer = await ctx.db.get('organizers', event.organizerId);
  const organizerName = organizer?.name ?? 'your community';

  const broadcastId = await ctx.db.insert('eventBroadcasts', {
    eventId: args.eventId,
    adminId: userId,
    subject,
    message,
    // Persist the SANITIZED document, never the raw client string: the raw
    // bodyJson carries signed preview image URLs (capability URLs) and any
    // attributes the validator stripped, which must not outlive the request.
    bodyJson: richDoc ? JSON.stringify(richDoc) : undefined,
    recipientCount: recipients.length,
    sentAt: Date.now(),
  });

  // Register the inline images as published-in-a-sent-email — the public
  // /api/images route serves ONLY registered images. Same transaction as the
  // send, so recipients can never open an email whose images are not yet
  // servable, and abandoned composer uploads are never publicly exposed.
  await recordPublishedEmailImages(ctx, imageStorageIds);

  await Promise.all(
    recipients.map(async (recipient) => {
      let unsubToken: string;
      let preferenceCenterUrl = accountPreferenceUrl;

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
        preferenceCenterUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      }

      const {html, text, headers} = eventBroadcastTemplate({
        event: {
          _id: args.eventId,
          title: event.title,
          date: event.date,
          location: event.location,
        },
        organizer: {
          id: event.organizerId,
          name: organizerName,
        },
        message,
        bodyHtml,
        siteUrl,
        apiSiteUrl,
        unsubToken,
        preferenceCenterUrl,
      });

      return enqueueEmailDelivery(
        ctx,
        {to: recipient.email, subject, html, text, headers},
        {
          source: 'broadcast',
          sourceId: broadcastId as string,
          recipient: recipient.email,
        },
      );
    }),
  );

  await insertAdminAuditLog(
    {db: ctx.db},
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
