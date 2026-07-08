import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {DatabaseWriter, MutationCtx} from '../../_generated/server';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import type {AudienceScope} from '../../lib/validators/marketing';
import {eventAnnouncementTemplate} from '../../email/templates';
import {guardEmailDedup, hasEmailDedup} from '../../lib/email_dedup';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';
import {resolveSiteUrl} from '../../lib/site_url';
import {ensureUserMarketingPreferenceForSend} from '../audience/eager_preference';
import {
  getAnnouncementRecipients,
  type MarketingAnnouncementRecipient,
} from './audience';
import {
  buildMarketingTrackingUrls,
  createEmptyMarketingDeliveryStats,
  createMarketingDelivery,
} from './tracking';
import {throwAppError} from '../errors';

type AnnouncementWriteDb = Pick<
  DatabaseWriter,
  'get' | 'insert' | 'patch' | 'query'
>;
type AnnouncementMutationCtx = Pick<
  MutationCtx,
  'db' | 'runMutation' | 'scheduler'
>;

const MIN_SCHEDULE_DELAY_MS = 60_000;
const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;
export const MARKETING_ANNOUNCEMENT_BATCH_SIZE = 100;
export const MARKETING_ANNOUNCEMENT_BATCH_DELAY_MS = 1_000;

export type AnnouncementBatchArgs = {
  eventMarketingEmailId: Id<'eventMarketingEmails'>;
  eventId: Id<'events'>;
  organizerId: Id<'organizers'>;
  recipients: MarketingAnnouncementRecipient[];
  sentAt: number;
  /** Position of this batch within the parent send. Part of the dedup key
   * so a retried scheduled job does not double-send the same batch. */
  batchIndex: number;
};

function chunkRecipients(
  recipients: MarketingAnnouncementRecipient[],
  chunkSize: number,
): MarketingAnnouncementRecipient[][] {
  const chunks: MarketingAnnouncementRecipient[][] = [];

  for (let index = 0; index < recipients.length; index += chunkSize) {
    chunks.push(recipients.slice(index, index + chunkSize));
  }

  return chunks;
}

export function assertMarketingAnnouncementScheduleWindow(
  scheduledFor: number,
  now: number,
): void {
  if (scheduledFor < now + MIN_SCHEDULE_DELAY_MS) {
    throwAppError('SCHEDULED_TOO_SOON', 'scheduled_too_soon');
  }
  if (scheduledFor > now + MAX_SCHEDULE_AHEAD_MS) {
    throwAppError('SCHEDULED_TOO_FAR', 'scheduled_too_far');
  }
}

export async function replaceScheduledAnnouncement(args: {
  adminId: Id<'users'>;
  ctx: {
    db: AnnouncementWriteDb;
    runMutation: AnnouncementMutationCtx['runMutation'];
    scheduler: AnnouncementMutationCtx['scheduler'];
  };
  eventId: Id<'events'>;
  scheduledFor: number;
  audienceScope?: AudienceScope;
}): Promise<Id<'eventMarketingEmails'>> {
  const existingRecords = await collectAllQueryUnsafe(
    args.ctx.db
      .query('eventMarketingEmails')
      .withIndex('by_event_and_status', (query) =>
        query.eq('eventId', args.eventId).eq('status', 'scheduled'),
      ),
  );

  await Promise.all(
    existingRecords.map(async (record) => {
      if (record.schedulerJobId) {
        try {
          await args.ctx.scheduler.cancel(record.schedulerJobId);
        } catch {
          // Job may already be running or completed.
        }
      }
      await args.ctx.db.patch('eventMarketingEmails', record._id, {
        status: 'cancelled',
      });
    }),
  );

  const recordId = await args.ctx.db.insert('eventMarketingEmails', {
    eventId: args.eventId,
    adminId: args.adminId,
    scheduledFor: args.scheduledFor,
    status: 'scheduled',
    ...createEmptyMarketingDeliveryStats(),
    ...(args.audienceScope !== undefined
      ? {audienceScope: args.audienceScope}
      : {}),
  });

  const delay = args.scheduledFor - Date.now();
  const schedulerJobId = await args.ctx.scheduler.runAfter(
    Math.max(delay, 0),
    internal.marketing.emails.sendAnnouncement,
    {eventMarketingEmailId: recordId},
  );

  await args.ctx.db.patch('eventMarketingEmails', recordId, {schedulerJobId});
  await args.ctx.runMutation(
    internal.communities.management.audit.logAdminAccess,
    {
      adminId: args.adminId,
      action: 'marketing_email.scheduled',
      eventId: args.eventId,
      source: 'community-admin',
    },
  );

  return recordId;
}

export async function cancelScheduledAnnouncement(args: {
  adminId: Id<'users'>;
  ctx: {
    db: Pick<DatabaseWriter, 'get' | 'patch'>;
    runMutation: AnnouncementMutationCtx['runMutation'];
    scheduler: AnnouncementMutationCtx['scheduler'];
  };
  record: Doc<'eventMarketingEmails'>;
}): Promise<void> {
  if (args.record.schedulerJobId) {
    try {
      await args.ctx.scheduler.cancel(args.record.schedulerJobId);
    } catch {
      const freshRecord = await args.ctx.db.get(
        'eventMarketingEmails',
        args.record._id,
      );
      if (freshRecord?.status === 'sent') {
        throwAppError('ALREADY_SENT', 'already_sent');
      }
      return;
    }
  }

  await args.ctx.db.patch('eventMarketingEmails', args.record._id, {
    status: 'cancelled',
  });

  await args.ctx.runMutation(
    internal.communities.management.audit.logAdminAccess,
    {
      adminId: args.adminId,
      action: 'marketing_email.cancelled',
      eventId: args.record.eventId,
      source: 'community-admin',
    },
  );
}

export async function sendScheduledAnnouncement(
  ctx: MutationCtx,
  eventMarketingEmailId: Id<'eventMarketingEmails'>,
): Promise<void> {
  const record = await ctx.db.get(
    'eventMarketingEmails',
    eventMarketingEmailId,
  );
  if (!record || record.status !== 'scheduled') return;

  const event = await ctx.db.get('events', record.eventId);
  if (!event) {
    await ctx.db.patch('eventMarketingEmails', record._id, {
      status: 'cancelled',
    });
    return;
  }

  const audienceScope = record.audienceScope ?? 'community';
  const recipients = await getAnnouncementRecipients(
    ctx,
    event.organizerId,
    audienceScope,
  );
  const recipientBatches = chunkRecipients(
    recipients,
    MARKETING_ANNOUNCEMENT_BATCH_SIZE,
  );
  const sentAt = Date.now();

  await Promise.all(
    recipientBatches.map((recipientBatch, batchIndex) =>
      ctx.scheduler.runAfter(
        batchIndex * MARKETING_ANNOUNCEMENT_BATCH_DELAY_MS,
        internal.marketing.emails.sendAnnouncementBatch,
        {
          eventMarketingEmailId: record._id,
          eventId: event._id,
          organizerId: event.organizerId,
          recipients: recipientBatch,
          sentAt,
          batchIndex,
        },
      ),
    ),
  );

  await ctx.db.patch('eventMarketingEmails', record._id, {
    status: 'sent',
    recipientCount: recipients.length,
    sentAt,
    ...createEmptyMarketingDeliveryStats(),
  });

  await ctx.runMutation(internal.communities.management.audit.logAdminAccess, {
    adminId: record.adminId,
    action: ADMIN_AUDIT_ACTIONS.MARKETING_EMAIL_SENT,
    eventId: record.eventId,
    source: `scheduler recipients:${recipients.length}`,
  });
}

export async function sendScheduledAnnouncementBatch(
  ctx: MutationCtx,
  args: AnnouncementBatchArgs,
): Promise<void> {
  // Per-batch idempotency: a scheduler retry on a completed batch must not
  // re-fan-out the same emails. Key scopes the guard to the parent send +
  // batch position so distinct batches of one announcement all run.
  const dedupKey = `announcement:${args.eventMarketingEmailId}:${args.batchIndex}`;

  // Dedup READ — cheap early exit for scheduler retries of committed sends.
  if (await hasEmailDedup(ctx, dedupKey)) return;

  const record = await ctx.db.get(
    'eventMarketingEmails',
    args.eventMarketingEmailId,
  );
  if (!record || record.status === 'cancelled') {
    return;
  }

  if (record.eventId !== args.eventId) {
    return;
  }

  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    return;
  }

  // Dedup INSERT — only burns the slot when committed to sending.
  const alreadySent = await guardEmailDedup(ctx, dedupKey);
  if (alreadySent) return;

  const organizer = await ctx.db.get('organizers', args.organizerId);
  const organizerName = organizer?.name ?? 'your organizer';
  const siteUrl = resolveSiteUrl();
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);
  const targetUrl = `${siteUrl}/events/${event._id}`;

  // Pre-fetch names for all trusted organizer IDs referenced by any recipient.
  const uniqueOrgIds = new Set(
    args.recipients.flatMap((r) => r.vettedViaOrganizerIds ?? []),
  );
  const orgNameMap = new Map<Id<'organizers'>, string>();
  await Promise.all(
    [...uniqueOrgIds].map(async (orgId) => {
      const org = await ctx.db.get('organizers', orgId);
      if (org) orgNameMap.set(orgId, org.name);
    }),
  );

  await Promise.all(
    args.recipients.map(async (recipient) => {
      // Mint a digest-only unsubscribe token for this email send. This keeps
      // already-sent links valid without requiring preference rows to retain
      // a recoverable raw token for future sends.
      const unsubToken = await ensureUserMarketingPreferenceForSend(ctx.db, {
        userId: recipient.userId,
        organizerId: args.organizerId,
        userGlobalOptOut: recipient.globalMarketingOptOut === true,
        existingPreference: recipient.marketingPreference,
      });

      const {clickToken, openToken} = await createMarketingDelivery(ctx.db, {
        eventMarketingEmailId: args.eventMarketingEmailId,
        eventId: args.eventId,
        organizerId: args.organizerId,
        recipient: recipient.email,
        sentAt: args.sentAt,
        targetUrl,
        userId: recipient.userId,
        vettedViaOrganizerIds: recipient.vettedViaOrganizerIds,
      });
      const delivery = buildMarketingTrackingUrls({
        clickToken,
        openToken,
        apiBaseUrl: apiSiteUrl,
      });
      const vettedViaCommunityNames = (recipient.vettedViaOrganizerIds ?? [])
        .map((id) => orgNameMap.get(id))
        .filter((name): name is string => !!name);

      const {subject, html, text, headers} = eventAnnouncementTemplate({
        delivery,
        event: {
          _id: event._id,
          title: event.title,
          date: event.date,
          endDate: event.endDate,
          location: event.location,
          description: event.description,
        },
        organizer: {id: event.organizerId, name: organizerName},
        unsubToken,
        siteUrl,
        apiSiteUrl,
        vettedViaCommunityNames:
          vettedViaCommunityNames.length > 0
            ? vettedViaCommunityNames
            : undefined,
      });

      return enqueueEmailDelivery(
        ctx,
        {to: recipient.email, subject, html, text, headers},
        {
          source: 'announcement',
          sourceId: args.eventMarketingEmailId as string,
          recipient: recipient.email,
        },
      );
    }),
  );
}
