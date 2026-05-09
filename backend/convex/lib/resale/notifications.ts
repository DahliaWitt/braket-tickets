import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {resaleAvailableTemplate} from '../../email/templates';
import {canPurchaseEventForUser} from '../../lib/access/purchase';
import {calculateEventInventory} from '../../lib/inventory';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {hasEventDatePassed} from '../../lib/timezone';
import {
  throwForbidden,
  throwInvalidState,
  throwNotFound,
} from '../../lib/errors';

type ResaleNotificationMutationCtx = MutationCtx;

/**
 * Per-subscription cooldown applied to "resale ticket available" alerts.
 * `resale_notifications` rows are scoped per (userId, eventId), so this
 * suppresses repeat notifications for the same subscriber/event pair within
 * the window without affecting other events the subscriber follows.
 */
const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000;

export async function notifySubscribersForListedTicketState(
  ctx: ResaleNotificationMutationCtx,
  args: {eventId: Id<'events'>; sellerId: Id<'users'>},
): Promise<number> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) return 0;

  const salesStatus = event.ticketSalesStatus ?? 'active';
  if (salesStatus !== 'active' || hasEventDatePassed(event.date)) return 0;

  const {remaining: remainingTickets} = await calculateEventInventory(
    ctx.db,
    args.eventId,
    event.totalTickets,
  );
  if (remainingTickets > 0) return 0;

  const hasListedTickets = await ctx.db
    .query('resale_listings')
    .withIndex('by_event_status', (q) =>
      q.eq('eventId', args.eventId).eq('status', 'listed'),
    )
    .first();
  if (!hasListedTickets) return 0;

  const subscribers = await ctx.db
    .query('resale_notifications')
    .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
    .take(500);
  if (subscribers.length === 0) return 0;

  const notifiedAt = Date.now();
  const eligibleSubscribers = subscribers.filter(
    (subscription) =>
      subscription.notifiedAt === undefined ||
      notifiedAt - subscription.notifiedAt >= NOTIFICATION_COOLDOWN_MS,
  );
  if (eligibleSubscribers.length === 0) return 0;

  const {subject, html} = resaleAvailableTemplate(
    {title: event.title, date: event.date, location: event.location},
    args.eventId,
  );

  const results = await Promise.all(
    eligibleSubscribers.map(async (subscription) => {
      if (subscription.userId === args.sellerId) return 0;
      const access = await canPurchaseEventForUser(
        ctx,
        subscription.userId,
        event,
      );
      if (!access.allowed) {
        await ctx.db.delete('resale_notifications', subscription._id);
        return 0;
      }

      const user = await ctx.db.get('users', subscription.userId);
      const canonicalEmail = user?.email?.trim();
      const deliveryEmail = canonicalEmail || subscription.email;

      await enqueueEmailDelivery(
        ctx,
        {to: deliveryEmail, subject, html},
        {
          source: 'resale_available',
          sourceId: args.eventId as string,
          recipient: deliveryEmail,
        },
      );

      await ctx.db.patch('resale_notifications', subscription._id, {
        notifiedAt,
        ...(canonicalEmail && canonicalEmail !== subscription.email
          ? {email: canonicalEmail}
          : {}),
      });
      return 1;
    }),
  );

  return results.reduce<number>((sum, count) => sum + count, 0);
}

export async function subscribeToResaleNotificationsState(
  ctx: ResaleNotificationMutationCtx,
  args: {eventId: Id<'events'>; userId: Id<'users'>},
): Promise<Id<'resale_notifications'>> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) throwNotFound('Event');

  const access = await canPurchaseEventForUser(ctx, args.userId, event);
  if (!access.allowed) {
    throwForbidden('Not authorized to subscribe to this event');
  }

  const user = await ctx.db.get('users', args.userId);
  if (!user?.email) throwInvalidState('Email required for notifications');

  const existing = await ctx.db
    .query('resale_notifications')
    .withIndex('by_user_event', (q) =>
      q.eq('userId', args.userId).eq('eventId', args.eventId),
    )
    .first();
  if (existing) return existing._id;

  return ctx.db.insert('resale_notifications', {
    userId: args.userId,
    eventId: args.eventId,
    email: user.email,
  });
}

export async function unsubscribeFromResaleNotificationsState(
  db: Pick<MutationCtx['db'], 'query' | 'delete'>,
  args: {eventId: Id<'events'>; userId: Id<'users'>},
): Promise<void> {
  const existing = await db
    .query('resale_notifications')
    .withIndex('by_user_event', (q) =>
      q.eq('userId', args.userId).eq('eventId', args.eventId),
    )
    .first();

  if (existing) {
    await db.delete('resale_notifications', existing._id);
  }
}

export async function removeBuyerResaleNotificationSubscription(
  db: Pick<MutationCtx['db'], 'query' | 'delete'>,
  args: {eventId: Id<'events'>; userId: Id<'users'> | undefined},
): Promise<void> {
  if (!args.userId) return;
  await unsubscribeFromResaleNotificationsState(db, {
    eventId: args.eventId,
    userId: args.userId,
  });
}
