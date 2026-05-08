import type {Doc, Id} from '../../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../../_generated/server';
import {vettingReminderTemplate} from '../../../email/templates';
import {logger} from '../../../lib/logger';
import {buildVettingReminderRecipients} from '../../../lib/reminder_audience';
import {enqueueEmailDelivery} from '../../../lib/email_delivery_wrapper';
import {evaluateConsent} from '../../../lib/audience/policy';
import {
  ensureMarketingPreferenceExists,
  getMarketingPreferencesByOrganizer,
} from '../../../lib/marketing_emails/preferences';
import {issueUserMarketingUnsubscribeToken} from '../../../lib/marketing_emails/tokens';
import {throwAppError, throwInvalidInput} from '../../../lib/errors';
import {requireUser} from '../../../lib/auth_identity';
import {requirePlatformAdmin} from '../../../lib/access';
import {resolveEmailApiBaseUrl} from '../../../lib/public_site_urls';
import {resolveSiteUrl} from '../../../lib/site_url';
import {
  validateStringLength,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
} from '../../../lib/validation';
import {guardEmailDedup} from '../../../lib/email_dedup';
import {insertAdminAuditLog} from '../../../lib/admin_audit_log';
import {authzUserId} from '../../../lib/authz';

const VETTING_REMINDER_SEGMENT = 'no_application' as const;
const PLATFORM_MARKETING_ORGANIZER_NAME = 'Braket Tickets';
const PLATFORM_MARKETING_ORGANIZER_SLUG = 'braket-platform-marketing';
const MAX_EMAILS_PER_BATCH = 500;
const MAX_SCAN_LIMIT = 5_000;

export {buildVettingReminderRecipients};

async function scanVettingReminderInputs(ctx: QueryCtx | MutationCtx): Promise<{
  allUsers: Doc<'users'>[];
  appliedUserIds: Set<Id<'users'>>;
}> {
  const appliedUserIds = new Set<Id<'users'>>();
  let applicationScanCount = 0;
  for await (const app of ctx.db.query('applications')) {
    appliedUserIds.add(app.userId);
    applicationScanCount += 1;
    if (applicationScanCount >= MAX_SCAN_LIMIT) {
      throwAppError(
        'QUERY_LIMIT_EXCEEDED',
        `Application scan exceeded safety limit of ${MAX_SCAN_LIMIT} documents`,
        {scope: 'applications', limit: MAX_SCAN_LIMIT},
      );
    }
  }

  const allUsers = await ctx.db.query('users').take(MAX_SCAN_LIMIT);
  if (allUsers.length >= MAX_SCAN_LIMIT) {
    throwAppError(
      'QUERY_LIMIT_EXCEEDED',
      `User scan exceeded safety limit of ${MAX_SCAN_LIMIT} documents`,
      {scope: 'users', limit: MAX_SCAN_LIMIT},
    );
  }

  return {allUsers, appliedUserIds};
}

async function findPlatformMarketingOrganizer(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
): Promise<Doc<'organizers'> | null> {
  return await ctx.db
    .query('organizers')
    .withIndex('by_isPlatformOrganizer', (query) =>
      query.eq('isPlatformOrganizer', true),
    )
    .first();
}

async function ensurePlatformMarketingOrganizer(
  ctx: MutationCtx,
): Promise<Id<'organizers'>> {
  const existing = await findPlatformMarketingOrganizer(ctx);
  if (existing) {
    return existing._id;
  }

  return await ctx.db.insert('organizers', {
    name: PLATFORM_MARKETING_ORGANIZER_NAME,
    slug: PLATFORM_MARKETING_ORGANIZER_SLUG,
    isPlatformOrganizer: true,
    isPublicDirectory: false,
    status: 'draft',
  });
}

function buildEligibleVettingRecipients(args: {
  allUsers: Doc<'users'>[];
  appliedUserIds: ReadonlySet<Id<'users'>>;
  preferencesByUserId: Map<Id<'users'>, Doc<'marketingEmailPreferences'>>;
}) {
  const eligibleUsers = args.allUsers.filter((user) =>
    evaluateConsent(
      {kind: 'marketing-opt-out'},
      {
        globalOptOut: user.globalMarketingOptOut === true,
        userPreference: args.preferencesByUserId.get(user._id),
      },
    ),
  );

  return buildVettingReminderRecipients(args.appliedUserIds, eligibleUsers);
}

async function getOrCreateReminderUnsubToken(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
  },
): Promise<string> {
  const preference = await ensureMarketingPreferenceExists(ctx.db, {
    userId: args.userId,
    organizerId: args.organizerId,
    optedIn: true,
  });
  return await issueUserMarketingUnsubscribeToken(ctx.db, {
    preferenceId: preference._id,
    userId: preference.userId,
    organizerId: preference.organizerId,
  });
}

export async function getVettingReminderAudience(
  ctx: QueryCtx,
): Promise<{segment: typeof VETTING_REMINDER_SEGMENT; recipientCount: number}> {
  const {_id: userId} = await requireUser(ctx);

  await requirePlatformAdmin(ctx, userId);
  const {allUsers, appliedUserIds} = await scanVettingReminderInputs(ctx);
  const platformOrganizer = await findPlatformMarketingOrganizer(ctx);
  const preferencesByUserId = platformOrganizer
    ? await getMarketingPreferencesByOrganizer(ctx.db, platformOrganizer._id)
    : new Map<Id<'users'>, Doc<'marketingEmailPreferences'>>();
  const recipients = buildEligibleVettingRecipients({
    allUsers,
    appliedUserIds,
    preferencesByUserId,
  });

  return {
    segment: VETTING_REMINDER_SEGMENT,
    recipientCount: recipients.length,
  };
}

export async function sendVettingReminder(
  ctx: MutationCtx,
  args: {
    subject: string;
    message: string;
  },
): Promise<{segment: typeof VETTING_REMINDER_SEGMENT; recipientCount: number}> {
  const {_id: userId} = await requireUser(ctx);

  await requirePlatformAdmin(ctx, userId);

  const subject = args.subject.trim();
  const message = args.message.trim();
  if (!subject) throwInvalidInput('Subject is required', {field: 'subject'});
  if (!message) throwInvalidInput('Message is required', {field: 'message'});

  validateStringLength(subject, 'Subject', MAX_TICKET_REMINDER_SUBJECT_LENGTH);
  validateStringLength(message, 'Message', MAX_TICKET_REMINDER_MESSAGE_LENGTH);

  const dedupKey = `vetting:${VETTING_REMINDER_SEGMENT}:${userId}`;
  const alreadySent = await guardEmailDedup(ctx, dedupKey);
  if (alreadySent) {
    return {segment: VETTING_REMINDER_SEGMENT, recipientCount: 0};
  }
  const {allUsers, appliedUserIds} = await scanVettingReminderInputs(ctx);
  const platformOrganizerId = await ensurePlatformMarketingOrganizer(ctx);
  const preferencesByUserId = await getMarketingPreferencesByOrganizer(
    ctx.db,
    platformOrganizerId,
  );
  const recipients = buildEligibleVettingRecipients({
    allUsers,
    appliedUserIds,
    preferencesByUserId,
  });
  const siteUrl = resolveSiteUrl();
  const apiSiteUrl = resolveEmailApiBaseUrl(siteUrl);
  const preferenceCenterUrl = `${siteUrl}/account#email-preferences`;

  const cappedRecipients = recipients.slice(0, MAX_EMAILS_PER_BATCH);
  const truncated = recipients.length > MAX_EMAILS_PER_BATCH;

  if (truncated) {
    logger.warn('reminders', 'sendVettingReminder: recipient list truncated', {
      eligibleRecipients: recipients.length,
      sendingRecipients: cappedRecipients.length,
      cap: MAX_EMAILS_PER_BATCH,
    });
  }

  const reminderSourceId = `vetting:${authzUserId(userId)}:${Date.now()}`;
  await Promise.all(
    cappedRecipients.map(async (recipient) => {
      const unsubToken = await getOrCreateReminderUnsubToken(ctx, {
        userId: recipient.userId,
        organizerId: platformOrganizerId,
      });
      const {html, text, headers} = vettingReminderTemplate({
        message,
        siteUrl,
        apiSiteUrl,
        unsubToken,
        preferenceCenterUrl,
      });
      return enqueueEmailDelivery(
        ctx,
        {to: recipient.email, subject, html, text, headers},
        {
          source: 'reminder',
          sourceId: reminderSourceId,
          recipient: recipient.email,
        },
      );
    }),
  );

  await insertAdminAuditLog(ctx, {
    adminId: userId,
    action: 'vetting.reminder-email.send.no_application',
    source: 'admin-ui',
  });

  return {
    segment: VETTING_REMINDER_SEGMENT,
    recipientCount: cappedRecipients.length,
  };
}
