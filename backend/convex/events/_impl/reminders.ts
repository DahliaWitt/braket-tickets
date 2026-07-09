import {loadEventOrThrow} from '../../lib/access';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {batchGetUsers} from '../../lib/batch_utils';
import {ticketPurchaseReminderTemplate} from '../../email/templates';
import {normalizeEmailOrNull} from '../../lib/validation';
import {applicationsByOrganizerStatusQuery} from '../../lib/applications/loaders';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {evaluateConsent} from '../../lib/audience/policy';
import {findMarketingPreferenceByUserAndOrganizer} from '../../lib/marketing_emails/preferences';
import {findAddressMarketingPreferenceByEmailAndOrganizer} from '../../lib/marketing_emails/address_preferences';
import {ensureUserMarketingPreferenceForSend} from '../../lib/audience/eager_preference';
import {resolveSiteUrl} from '../../lib/site_url';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';
import {logger} from '../../lib/logger';

export const MAX_EMAILS_PER_BATCH = 500;
const CANDIDATE_MULTIPLIER = 2;
const MAX_EXCLUSION_SET_SIZE = 10_000;

export interface TicketReminderRecipient {
  userId: Id<'users'>;
  email: string;
  name: string;
  userGlobalOptOut: boolean;
}

async function buildCandidateUserIds(
  ctx: QueryCtx,
  event: Doc<'events'>,
  limit: number,
): Promise<Id<'users'>[]> {
  const completedOrderUserIds = new Set<Id<'users'>>();
  let orderRowsScanned = 0;
  const orders = ctx.db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', event._id).eq('state', 'completed'),
    );
  for await (const order of orders) {
    orderRowsScanned++;
    if (order.userId) completedOrderUserIds.add(order.userId);
    if (
      completedOrderUserIds.size >= MAX_EXCLUSION_SET_SIZE ||
      orderRowsScanned >= MAX_EXCLUSION_SET_SIZE
    )
      break;
  }

  const candidateUserIds: Id<'users'>[] = [];
  const seenUserIds = new Set<Id<'users'>>();
  const apps = applicationsByOrganizerStatusQuery(
    ctx.db,
    event.organizerId,
    'approved',
  );
  for await (const app of apps) {
    if (completedOrderUserIds.has(app.userId)) continue;
    if (seenUserIds.has(app.userId)) continue;
    seenUserIds.add(app.userId);
    candidateUserIds.push(app.userId);
    if (candidateUserIds.length >= limit) break;
  }

  return candidateUserIds;
}

/**
 * Lightweight audience count for the admin UI preview.
 * Skips preference lookups — returns an approximate count of
 * approved-without-ticket members. Actual consent filtering
 * happens at send time.
 */
export async function countTicketReminderRecipients(
  ctx: QueryCtx,
  eventId: Id<'events'>,
): Promise<{
  event: Doc<'events'>;
  approximateCount: number;
}> {
  const event = await loadEventOrThrow(ctx, eventId);
  const candidates = await buildCandidateUserIds(
    ctx,
    event,
    MAX_EMAILS_PER_BATCH,
  );
  return {event, approximateCount: candidates.length};
}

/**
 * Full recipient loading for the actual send path.
 *
 * Uses a candidate-first approach: streams approved applications,
 * excludes users with completed orders, caps candidates at 2× batch
 * size, then does individual indexed preference lookups for consent
 * filtering. This avoids unbounded full-table preference scans.
 */
export async function loadTicketReminderRecipients(
  ctx: QueryCtx,
  eventId: Id<'events'>,
): Promise<{
  event: Doc<'events'>;
  recipients: TicketReminderRecipient[];
}> {
  const event = await loadEventOrThrow(ctx, eventId);
  const candidateLimit = MAX_EMAILS_PER_BATCH * CANDIDATE_MULTIPLIER;
  const candidateUserIds = await buildCandidateUserIds(
    ctx,
    event,
    candidateLimit,
  );

  // Batch-load candidate users
  const usersById = await batchGetUsers(ctx, candidateUserIds);

  // Per-candidate preference lookups (indexed point queries, not
  // full-organizer scans).
  const [userPrefs, addrPrefs] = await Promise.all([
    Promise.all(
      candidateUserIds.map((uid) =>
        findMarketingPreferenceByUserAndOrganizer(ctx.db, {
          userId: uid,
          organizerId: event.organizerId,
        }),
      ),
    ),
    Promise.all(
      candidateUserIds.map((uid) => {
        const user = usersById.get(uid);
        const email = user?.email ? normalizeEmailOrNull(user.email) : null;
        return email
          ? findAddressMarketingPreferenceByEmailAndOrganizer(ctx.db, {
              email,
              organizerId: event.organizerId,
            })
          : Promise.resolve(null);
      }),
    ),
  ]);

  // Build recipients with consent filtering, capped at batch size
  const recipients: TicketReminderRecipient[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < candidateUserIds.length; i++) {
    if (recipients.length >= MAX_EMAILS_PER_BATCH) break;

    const userId = candidateUserIds[i];
    const user = usersById.get(userId);
    if (!user?.email) continue;

    const email = normalizeEmailOrNull(user.email);
    if (!email || seenEmails.has(email)) continue;

    const passes = evaluateConsent(
      {kind: 'marketing-opt-out'},
      {
        globalOptOut: user.globalMarketingOptOut === true,
        userPreference: userPrefs[i],
        addressPreference: addrPrefs[i],
      },
    );
    if (!passes) continue;

    seenEmails.add(email);
    recipients.push({
      userId,
      email,
      name: user.name || 'friend',
      userGlobalOptOut: user.globalMarketingOptOut === true,
    });
  }

  return {event, recipients};
}

export async function queueTicketPurchaseReminderEmails(
  ctx: MutationCtx,
  args: {
    event: Pick<
      Doc<'events'>,
      '_id' | 'title' | 'date' | 'location' | 'organizerId'
    >;
    recipients: TicketReminderRecipient[];
    subject: string;
    message: string;
    /** Optional pre-rendered rich HTML fragment (shared across recipients). */
    bodyHtml?: string;
    organizerName: string;
  },
): Promise<number> {
  const siteUrl = resolveSiteUrl();
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);
  const accountPreferenceUrl = `${siteUrl}/account#email-preferences`;

  if (args.recipients.length > MAX_EMAILS_PER_BATCH) {
    logger.warn(
      'events',
      'sendTicketPurchaseReminder: recipient list truncated',
      {
        eligibleRecipients: args.recipients.length,
        sendingRecipients: MAX_EMAILS_PER_BATCH,
        cap: MAX_EMAILS_PER_BATCH,
      },
    );
  }
  const cappedRecipients = args.recipients.slice(0, MAX_EMAILS_PER_BATCH);

  await Promise.all(
    cappedRecipients.map(async (recipient) => {
      const unsubToken = await ensureUserMarketingPreferenceForSend(ctx.db, {
        userId: recipient.userId,
        organizerId: args.event.organizerId,
        userGlobalOptOut: recipient.userGlobalOptOut,
      });

      const {html, text, headers} = ticketPurchaseReminderTemplate({
        event: {
          _id: args.event._id as string,
          title: args.event.title,
          date: args.event.date,
          location: args.event.location,
        },
        organizer: {
          id: args.event.organizerId as string,
          name: args.organizerName,
        },
        message: args.message,
        bodyHtml: args.bodyHtml,
        siteUrl,
        apiSiteUrl,
        unsubToken,
        preferenceCenterUrl: accountPreferenceUrl,
      });

      return enqueueEmailDelivery(
        ctx,
        {to: recipient.email, subject: args.subject, html, text, headers},
        {
          source: 'event',
          sourceId: args.event._id as string,
          recipient: recipient.email,
        },
      );
    }),
  );

  return cappedRecipients.length;
}
