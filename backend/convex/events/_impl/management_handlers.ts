import type {Doc, Id} from '../../_generated/dataModel';
import type {ActionCtx, MutationCtx, QueryCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import type {
  AdminEventListItem,
  EventEditDetail,
  ManagementPurchases,
  ManagementResaleData,
  ManagementSummary,
} from './types';
import {requireUser} from '../../lib/auth_identity';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {pruneNoopEventPatch, resolveEditableEventForCaller} from './editor';
import {loadCanonicalListAvailability} from './listing';
import {
  autoCancelScheduledMarketingEmail,
  maybeScheduleMarketingAnnouncementOnPublish,
  throwIfEventHasTickets,
} from './lifecycle';
import {loadAdminVisibleEvents} from './queries';
import {
  getPosterUrl,
  mapEventsWithPosterUrls,
  toEditableEventDetail,
} from '../../lib/events/read_models';
import {
  requireCreateEvent,
  requireReassignEventOrganizer,
} from '../../lib/access';
import {
  throwInvalidState,
  throwUnauthenticated,
  throwUnauthorized,
} from '../../lib/errors';
import {
  type CreateEventInput,
  type UpdateEventInput,
  prepareEventCreateFields,
  prepareEventUpdateFields,
} from '../../lib/events/writes';
import {asStorageId, cleanupReplacedUpload} from '../../lib/upload_validation';
import {assertCommunityNotDraft} from '../../lib/events/community_guards';
import {assertEventTotalTicketsUpdateAllowed} from '../../lib/orders/inventory';
import {releaseOrderState} from '../../lib/orders/release';
import {
  buildManagementPurchases,
  buildManagementResale,
  buildManagementSummary,
} from './management';

type EventCleanupDb = MutationCtx['db'];
const EVENT_CLEANUP_BATCH_SIZE = 200;

async function releaseOpenOrdersForEvent(
  db: EventCleanupDb,
  eventId: Id<'events'>,
  reason: 'cancelled',
): Promise<boolean> {
  const openOrders = await db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', eventId).eq('state', 'open'),
    )
    .take(EVENT_CLEANUP_BATCH_SIZE);

  for (const order of openOrders) {
    await releaseOrderState(db, {
      orderId: order._id,
      reason,
    });
  }

  return openOrders.length === EVENT_CLEANUP_BATCH_SIZE;
}

async function loadAdminDeleteBlockers(
  db: QueryCtx['db'],
  events: ReadonlyArray<Doc<'events'>>,
): Promise<
  Map<
    Id<'events'>,
    {
      hasAnyTickets: boolean;
      hasCompletedOrders: boolean;
    }
  >
> {
  const results = await Promise.all(
    events.map(async (event) => {
      const [ticket, completedOrder] = await Promise.all([
        db
          .query('tickets')
          .withIndex('by_event_status', (q) => q.eq('eventId', event._id))
          .first(),
        db
          .query('ticket_orders')
          .withIndex('by_event_and_state', (q) =>
            q.eq('eventId', event._id).eq('state', 'completed'),
          )
          .first(),
      ]);

      return [
        event._id,
        {
          hasAnyTickets: ticket !== null,
          hasCompletedOrders: completedOrder !== null,
        },
      ] as const;
    }),
  );

  return new Map(results);
}

async function deleteReleasedOrdersForEvent(
  db: EventCleanupDb,
  eventId: Id<'events'>,
): Promise<boolean> {
  const releasedOrders = await db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', eventId).eq('state', 'released'),
    )
    .take(EVENT_CLEANUP_BATCH_SIZE);
  let hasMoreWork = releasedOrders.length === EVENT_CLEANUP_BATCH_SIZE;

  for (const order of releasedOrders) {
    const financialEvents = await db
      .query('order_financial_events')
      .withIndex('by_order', (q) => q.eq('orderId', order._id))
      .take(EVENT_CLEANUP_BATCH_SIZE);
    for (const financialEvent of financialEvents) {
      await db.delete('order_financial_events', financialEvent._id);
    }

    if (financialEvents.length === EVENT_CLEANUP_BATCH_SIZE) {
      hasMoreWork = true;
      continue;
    }

    await db.delete('ticket_orders', order._id);
  }

  return hasMoreWork;
}

/**
 * Deletes a batch of imported ticket holders and their import-batch records for
 * an event. Imported PII must not outlive the event. Runs inside the existing
 * batched cleanup loop so a large imported set (up to the per-event cap) drains
 * across transactions instead of blowing the write budget.
 */
async function deleteImportedEntriesForEvent(
  db: EventCleanupDb,
  eventId: Id<'events'>,
): Promise<boolean> {
  const entries = await db
    .query('importedTicketHolders')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .take(EVENT_CLEANUP_BATCH_SIZE);
  for (const entry of entries) {
    await db.delete('importedTicketHolders', entry._id);
  }
  if (entries.length === EVENT_CLEANUP_BATCH_SIZE) {
    return true;
  }

  const batches = await db
    .query('importBatches')
    .withIndex('by_event_batch_key_target', (q) => q.eq('eventId', eventId))
    .take(EVENT_CLEANUP_BATCH_SIZE);
  for (const batch of batches) {
    await db.delete('importBatches', batch._id);
  }
  return batches.length === EVENT_CLEANUP_BATCH_SIZE;
}

async function finalizeEventRemoval(
  db: EventCleanupDb,
  event: Doc<'events'>,
): Promise<void> {
  if (event.inventoryId) {
    const inventory = await db.get('event_inventory', event.inventoryId);
    if (inventory) {
      await db.delete('event_inventory', inventory._id);
    }
  }

  await db.delete('events', event._id);
}

async function hasCompletedOrdersForEvent(
  db: EventCleanupDb,
  eventId: Id<'events'>,
): Promise<boolean> {
  const completedOrder = await db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', eventId).eq('state', 'completed'),
    )
    .first();
  return completedOrder !== null;
}

async function runEventRemovalCleanupBatch(
  db: EventCleanupDb,
  eventId: Id<'events'>,
): Promise<boolean> {
  const hasMoreOpenOrders = await releaseOpenOrdersForEvent(
    db,
    eventId,
    'cancelled',
  );
  const hasMoreReleasedOrders = await deleteReleasedOrdersForEvent(db, eventId);
  const hasMoreImportedEntries = await deleteImportedEntriesForEvent(
    db,
    eventId,
  );
  return hasMoreOpenOrders || hasMoreReleasedOrders || hasMoreImportedEntries;
}

async function runGatedManagementAction<T>(
  ctx: ActionCtx,
  eventId: Id<'events'>,
  runInternal: (userId: Id<'users'>) => Promise<T>,
): Promise<T> {
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!userId) throwUnauthenticated();

  const canManage = await ctx.runQuery(internal.lib.access._isEventAdmin, {
    userId,
    eventId,
  });
  if (!canManage) throwUnauthorized();

  await ctx.runMutation(internal.communities.management.audit.logAdminAccess, {
    adminId: userId,
    action: 'event.management.view',
    eventId,
    source: 'admin-ui',
  });

  return await runInternal(userId);
}

export async function adminList(
  ctx: QueryCtx,
  args: {organizerId?: Id<'organizers'>},
): Promise<AdminEventListItem[]> {
  const user = await requireUser(ctx);
  const events = await loadAdminVisibleEvents(ctx, user, args);
  const availabilityByEventId = await loadCanonicalListAvailability(
    ctx.db,
    events,
  );
  const deleteBlockersByEventId = await loadAdminDeleteBlockers(ctx.db, events);
  const eventsWithAvailability = await mapEventsWithPosterUrls(
    ctx,
    events,
    availabilityByEventId,
  );

  return eventsWithAvailability.map((event) => ({
    ...event,
    ...deleteBlockersByEventId.get(event._id),
  }));
}

export async function getForEdit(
  ctx: QueryCtx,
  args: {id: Id<'events'>},
): Promise<EventEditDetail> {
  const {event} = await resolveEditableEventForCaller(ctx, ctx.db, args.id);

  const posterUrl = await getPosterUrl(ctx, event.poster);
  const organizer = await ctx.db.get('organizers', event.organizerId);
  return toEditableEventDetail(event, {
    posterUrl,
    organizer,
  });
}

export async function getManagementSummaryInternal(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; requestUserId: Id<'users'>},
): Promise<ManagementSummary> {
  return await buildManagementSummary(ctx, args);
}

export async function getManagementSummary(
  ctx: ActionCtx,
  args: {eventId: Id<'events'>},
): Promise<ManagementSummary> {
  return await runGatedManagementAction(ctx, args.eventId, (userId) =>
    ctx.runQuery(internal.events.management.getManagementSummaryInternal, {
      eventId: args.eventId,
      requestUserId: userId,
    }),
  );
}

export async function getManagementPurchasesInternal(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; requestUserId: Id<'users'>},
): Promise<ManagementPurchases> {
  return await buildManagementPurchases(ctx, args);
}

export async function getManagementPurchases(
  ctx: ActionCtx,
  args: {eventId: Id<'events'>},
): Promise<ManagementPurchases> {
  return await runGatedManagementAction(ctx, args.eventId, (userId) =>
    ctx.runQuery(internal.events.management.getManagementPurchasesInternal, {
      eventId: args.eventId,
      requestUserId: userId,
    }),
  );
}

export async function getManagementResaleInternal(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>; requestUserId: Id<'users'>},
): Promise<ManagementResaleData> {
  return await buildManagementResale(ctx, args);
}

export async function getManagementResale(
  ctx: ActionCtx,
  args: {eventId: Id<'events'>},
): Promise<ManagementResaleData> {
  return await runGatedManagementAction(ctx, args.eventId, (userId) =>
    ctx.runQuery(internal.events.management.getManagementResaleInternal, {
      eventId: args.eventId,
      requestUserId: userId,
    }),
  );
}

export async function create(
  ctx: MutationCtx,
  args: CreateEventInput,
): Promise<Id<'events'>> {
  const {_id: userId} = await requireUser(ctx);

  await requireCreateEvent(ctx, userId, args.organizerId);

  await assertCommunityNotDraft(ctx.db, args.organizerId, args.status);

  const {announcement, ...eventArgs} = args;
  const eventId = await ctx.db.insert(
    'events',
    await prepareEventCreateFields(
      ctx.db,
      userId,
      eventArgs as CreateEventInput,
    ),
  );
  const inventoryId = await ctx.db.insert('event_inventory', {
    eventId,
    soldCount: 0,
    heldCount: 0,
  });
  await ctx.db.patch('events', eventId, {inventoryId});

  await maybeScheduleMarketingAnnouncementOnPublish({
    ctx,
    adminId: userId,
    eventId,
    organizerId: args.organizerId,
    announcement,
    nextStatus: args.status,
    previousStatus: 'draft',
  });

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: userId,
      action: 'event.create',
      eventId,
      organizerId: args.organizerId,
      source: 'admin-ui',
    },
  );

  return eventId;
}

export async function update(
  ctx: MutationCtx,
  args: UpdateEventInput & {id: Id<'events'>},
): Promise<null> {
  const {userId, event} = await resolveEditableEventForCaller(
    ctx,
    ctx.db,
    args.id,
  );

  let organizerChanged = false;
  let statusChanged = false;

  let nextOrganizerId: Id<'organizers'> = event.organizerId;
  const requestedOrganizerId = args.organizerId;
  if (
    requestedOrganizerId !== undefined &&
    requestedOrganizerId !== event.organizerId
  ) {
    organizerChanged = true;
    nextOrganizerId = requestedOrganizerId;
    await requireReassignEventOrganizer(ctx, userId, nextOrganizerId);
  }

  let nextStatus: Doc<'events'>['status'] = event.status;
  const requestedStatus = args.status;
  if (requestedStatus !== undefined && requestedStatus !== event.status) {
    statusChanged = true;
    nextStatus = requestedStatus;
  }

  if (statusChanged || organizerChanged) {
    await assertCommunityNotDraft(ctx.db, nextOrganizerId, nextStatus);
  }

  if (
    args.totalTickets !== undefined &&
    args.totalTickets !== event.totalTickets
  ) {
    await assertEventTotalTicketsUpdateAllowed(ctx, {
      eventId: args.id,
      totalTickets: args.totalTickets,
    });
  }

  const {id, announcement, ...updateArgs} = args;
  const preparedPatch = await prepareEventUpdateFields(
    ctx.db,
    userId,
    updateArgs as UpdateEventInput,
  );
  const patch = pruneNoopEventPatch(event, preparedPatch);
  const hasPatch = Object.keys(patch).length > 0;
  if (!hasPatch && announcement === undefined) {
    return null;
  }
  if (hasPatch) {
    await ctx.db.patch('events', id, patch);
  }

  const replacedPosterId = event.poster ? asStorageId(event.poster) : null;
  if (patch.poster !== undefined && replacedPosterId) {
    await cleanupReplacedUpload(ctx, replacedPosterId);
  }

  if (event.status !== 'cancelled' && nextStatus === 'cancelled') {
    const hasMoreOpenOrders = await releaseOpenOrdersForEvent(
      ctx.db,
      id,
      'cancelled',
    );
    if (hasMoreOpenOrders) {
      await ctx.scheduler.runAfter(
        0,
        internal.events.management.continueCancelledEventOrderCleanup,
        {eventId: id},
      );
    }
  }

  await autoCancelScheduledMarketingEmail({
    ctx,
    adminId: userId,
    eventId: id,
    nextStatus: args.status,
    previousStatus: event.status,
  });

  await maybeScheduleMarketingAnnouncementOnPublish({
    ctx,
    adminId: userId,
    eventId: id,
    organizerId: nextOrganizerId,
    announcement,
    nextStatus,
    previousStatus: event.status,
  });

  if (organizerChanged) {
    await insertAdminAuditLog(
      {db: ctx.db},
      {
        adminId: userId,
        action: 'event.organizer_reassign.from',
        eventId: id,
        organizerId: event.organizerId,
        source: 'admin-ui',
      },
    );
    await insertAdminAuditLog(
      {db: ctx.db},
      {
        adminId: userId,
        action: 'event.organizer_reassign.to',
        eventId: id,
        organizerId: nextOrganizerId,
        source: 'admin-ui',
      },
    );
  }

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: userId,
      action: 'event.update',
      eventId: id,
      organizerId: nextOrganizerId,
      source: 'admin-ui',
    },
  );
  return null;
}

export async function remove(
  ctx: MutationCtx,
  args: {id: Id<'events'>},
): Promise<null> {
  const {userId, event} = await resolveEditableEventForCaller(
    ctx,
    ctx.db,
    args.id,
  );

  await throwIfEventHasTickets(ctx.db, args.id);
  if (await hasCompletedOrdersForEvent(ctx.db, args.id)) {
    throwInvalidState('Cannot delete event with completed orders');
  }

  if (event.status !== 'cancelled') {
    await ctx.db.patch('events', args.id, {status: 'cancelled'});
  }
  await autoCancelScheduledMarketingEmail({
    ctx,
    adminId: userId,
    eventId: args.id,
    nextStatus: 'cancelled',
    previousStatus: event.status,
  });

  const hasMoreCleanup = await runEventRemovalCleanupBatch(ctx.db, args.id);
  if (hasMoreCleanup) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.management.continueEventRemovalCleanup,
      {
        adminId: userId,
        eventId: args.id,
      },
    );
    return null;
  }

  await finalizeEventRemoval(ctx.db, event);

  const deletedPosterId = event.poster ? asStorageId(event.poster) : null;
  if (deletedPosterId) {
    await cleanupReplacedUpload(ctx, deletedPosterId);
  }

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: userId,
      action: 'event.delete',
      eventId: args.id,
      organizerId: event.organizerId,
      source: 'admin-ui',
      deletedEventName: event.title,
    },
  );
  return null;
}

export async function continueCancelledEventOrderCleanup(
  ctx: MutationCtx,
  args: {eventId: Id<'events'>},
): Promise<null> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event || event.status !== 'cancelled') {
    return null;
  }

  const hasMoreOpenOrders = await releaseOpenOrdersForEvent(
    ctx.db,
    args.eventId,
    'cancelled',
  );
  if (hasMoreOpenOrders) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.management.continueCancelledEventOrderCleanup,
      {eventId: args.eventId},
    );
  }

  return null;
}

export async function continueEventRemovalCleanup(
  ctx: MutationCtx,
  args: {
    adminId: Id<'users'>;
    eventId: Id<'events'>;
  },
): Promise<null> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    return null;
  }

  if (await hasCompletedOrdersForEvent(ctx.db, args.eventId)) {
    throwInvalidState('Cannot delete event with completed orders');
  }

  const hasMoreCleanup = await runEventRemovalCleanupBatch(
    ctx.db,
    args.eventId,
  );
  if (hasMoreCleanup) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.management.continueEventRemovalCleanup,
      args,
    );
    return null;
  }

  await finalizeEventRemoval(ctx.db, event);

  const deletedPosterId = event.poster ? asStorageId(event.poster) : null;
  if (deletedPosterId) {
    await cleanupReplacedUpload(ctx, deletedPosterId);
  }

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: args.adminId,
      action: 'event.delete',
      eventId: args.eventId,
      organizerId: event.organizerId,
      source: 'admin-ui',
      deletedEventName: event.title,
    },
  );
  return null;
}

export async function getInternal(
  ctx: QueryCtx,
  args: {id: Id<'events'>},
): Promise<Doc<'events'> | null> {
  return await ctx.db.get('events', args.id);
}
