import type {Doc, Id} from '../../_generated/dataModel';
import type {EventStatus} from '@shared/domain/event-status';
import {internal} from '../../_generated/api';
import type {MutationCtx} from '../../_generated/server';
import {captureBackendEvent, userDistinctId} from '../../lib/analytics';
import {isPublishedCommunity} from '../../lib/community_status';
import {
  assertMarketingAnnouncementScheduleWindow,
  replaceScheduledAnnouncement,
} from '../../lib/marketing_emails/announcements';
import type {AnnouncementInput} from '../../lib/events/writes';
import {throwInvalidState} from '../../lib/errors';
import {logger} from '../../lib/logger';

type EventLifecycleCtx = Pick<
  MutationCtx,
  'db' | 'scheduler' | 'runMutation' | 'runQuery'
>;
const QUEUE_NOW_BUFFER_MS = 61_000;

function getTicketTierCount(
  event: Pick<Doc<'events'>, 'slidingScaleEnabled' | 'supporterDefaultPrice'>,
): number {
  return (
    1 +
    (event.supporterDefaultPrice !== undefined ? 1 : 0) +
    (event.slidingScaleEnabled ? 1 : 0)
  );
}

export async function autoCancelScheduledMarketingEmail(args: {
  ctx: EventLifecycleCtx;
  adminId: Id<'users'>;
  eventId: Id<'events'>;
  nextStatus: EventStatus | undefined;
  previousStatus: EventStatus;
}): Promise<boolean> {
  if (args.nextStatus !== 'cancelled' || args.previousStatus === 'cancelled') {
    return false;
  }

  const scheduledEmail = await args.ctx.db
    .query('eventMarketingEmails')
    .withIndex('by_event_and_status', (q) =>
      q.eq('eventId', args.eventId).eq('status', 'scheduled'),
    )
    .first();

  if (!scheduledEmail) {
    return false;
  }

  if (scheduledEmail.schedulerJobId) {
    try {
      await args.ctx.scheduler.cancel(scheduledEmail.schedulerJobId);
    } catch (error: unknown) {
      logger.warn(
        'marketing',
        'Failed to cancel scheduled marketing email job; it may have already fired',
        {
          schedulerJobId: scheduledEmail.schedulerJobId,
          error,
        },
      );
    }
  }

  await args.ctx.db.patch('eventMarketingEmails', scheduledEmail._id, {
    status: 'cancelled',
  });
  await args.ctx.runMutation(
    internal.communities.management.audit.logAdminAccess,
    {
      adminId: args.adminId,
      action: 'event.marketing-email.auto-cancelled',
      eventId: args.eventId,
      source: 'system',
    },
  );

  return true;
}

function resolveAnnouncementScheduleTime(
  announcement: AnnouncementInput,
  now: number,
): number | null {
  if (announcement.mode === 'skip') {
    return null;
  }

  if (announcement.mode === 'now') {
    return now + QUEUE_NOW_BUFFER_MS;
  }

  return announcement.scheduledFor;
}

export async function maybeScheduleMarketingAnnouncementOnPublish(args: {
  ctx: EventLifecycleCtx;
  adminId: Id<'users'>;
  eventId: Id<'events'>;
  organizerId: Id<'organizers'>;
  announcement: AnnouncementInput | undefined;
  nextStatus: EventStatus;
  previousStatus: EventStatus;
}): Promise<boolean> {
  if (
    args.nextStatus !== 'published' ||
    args.previousStatus === 'published' ||
    !args.announcement
  ) {
    return false;
  }

  // Defense-in-depth: don't schedule emails for events under draft communities
  const organizer = await args.ctx.db.get('organizers', args.organizerId);
  if (organizer && !isPublishedCommunity(organizer)) {
    return false;
  }

  const now = Date.now();
  const scheduledFor = resolveAnnouncementScheduleTime(args.announcement, now);
  if (!scheduledFor) {
    return false;
  }

  assertMarketingAnnouncementScheduleWindow(scheduledFor, now);

  await replaceScheduledAnnouncement({
    adminId: args.adminId,
    ctx: {
      db: args.ctx.db,
      runMutation: args.ctx.runMutation,
      scheduler: args.ctx.scheduler,
    },
    eventId: args.eventId,
    scheduledFor,
  });

  return true;
}

export async function maybeEmitEventPublishedOnPublish(args: {
  ctx: EventLifecycleCtx;
  actorId: Id<'users'>;
  eventId: Id<'events'>;
  organizerId: Id<'organizers'>;
  nextStatus: EventStatus;
  previousStatus: EventStatus;
}): Promise<boolean> {
  if (args.nextStatus !== 'published' || args.previousStatus === 'published') {
    return false;
  }

  const event = await args.ctx.db.get('events', args.eventId);
  if (!event) {
    return false;
  }

  const isRootAdmin = await args.ctx.runQuery(
    internal.lib.access._isRootAdmin,
    {userId: args.actorId},
  );

  await captureBackendEvent(args.ctx, {
    distinctId: userDistinctId(String(args.actorId)),
    event: 'event_published',
    properties: {
      actor_role: isRootAdmin ? 'root_admin' : 'community_admin',
      auth_state: 'signed_in',
      event_id: args.eventId,
      organizer_id: args.organizerId,
      event_visibility: event.visibility,
      ticket_tier_count: getTicketTierCount(event),
    },
  });

  return true;
}

export async function throwIfEventHasTickets(
  db: Pick<MutationCtx['db'], 'query'>,
  eventId: Id<'events'>,
): Promise<void> {
  const tickets = await db
    .query('tickets')
    .withIndex('by_event_status', (q) => q.eq('eventId', eventId))
    .first();

  if (tickets) {
    throwInvalidState('Cannot delete event with existing tickets');
  }
}
