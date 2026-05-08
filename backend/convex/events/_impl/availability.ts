import {v} from 'convex/values';
import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {getAuthUserId} from '../../lib/auth_identity';
import {calculateEventInventory} from '../../lib/inventory';
import {countMatchingInQuery} from '../../lib/query_scan';
import {canViewEvent, isPlatformAdmin} from '../../lib/access';
import {
  canPurchaseEventForUser,
  type PurchaseAccess,
} from '../../lib/access/purchase';
import {isListedResaleListingStatus} from '../../lib/resale_listing_transitions';
import {ticketSalesStatusValidator} from '../../lib/validators/events';
import {isActiveTicketStatus} from '../../lib/validators/ticketing';
import {throwInvalidInput} from '../../lib/errors';

const purchaseAccessValidator = v.union(
  v.object({
    allowed: v.literal(true),
    source: v.literal('open_access'),
  }),
  v.object({
    allowed: v.literal(true),
    source: v.literal('direct'),
  }),
  v.object({
    allowed: v.literal(true),
    source: v.literal('shared'),
    viaOrganizerId: v.id('organizers'),
  }),
  v.object({
    allowed: v.literal(false),
  }),
);

export const eventAvailabilityAdminValidator = v.object({
  totalTickets: v.number(),
  soldCount: v.number(),
  remainingTickets: v.number(),
  isSoldOut: v.boolean(),
  userTicketCount: v.optional(v.number()),
  ticketSalesStatus: ticketSalesStatusValidator,
  resaleAvailable: v.optional(v.number()),
  resaleEnabled: v.optional(v.boolean()),
  isSubscribedToResaleNotifications: v.optional(v.boolean()),
  purchaseAccess: purchaseAccessValidator,
});

export const eventAvailabilityUserValidator = v.object({
  totalTickets: v.optional(v.number()),
  soldCount: v.optional(v.number()),
  remainingTickets: v.optional(v.number()),
  isSoldOut: v.boolean(),
  userTicketCount: v.optional(v.number()),
  ticketSalesStatus: ticketSalesStatusValidator,
  resaleAvailable: v.optional(v.number()),
  resaleEnabled: v.optional(v.boolean()),
  isSubscribedToResaleNotifications: v.optional(v.boolean()),
  purchaseAccess: purchaseAccessValidator,
});

export const eventAvailabilityValidator = v.union(
  v.null(),
  eventAvailabilityAdminValidator,
  eventAvailabilityUserValidator,
);

export const batchEventAvailabilityValidator = v.record(
  v.string(),
  v.union(
    v.null(),
    eventAvailabilityAdminValidator,
    eventAvailabilityUserValidator,
  ),
);

export interface AvailabilityShape {
  isSoldOut: boolean;
  userTicketCount: number;
  ticketSalesStatus: 'active' | 'paused' | 'ended';
  resaleAvailable: number;
  resaleEnabled: boolean;
  isSubscribedToResaleNotifications?: boolean;
  purchaseAccess: PurchaseAccess;
}

export interface EventAvailabilityUser {
  totalTickets?: number;
  soldCount?: number;
  remainingTickets?: number;
  isSoldOut: boolean;
  userTicketCount: number;
  ticketSalesStatus: 'active' | 'paused' | 'ended';
  resaleAvailable: number;
  resaleEnabled: boolean;
  isSubscribedToResaleNotifications?: boolean;
  purchaseAccess: PurchaseAccess;
}

export interface EventAvailabilityAdmin extends EventAvailabilityUser {
  totalTickets: number;
  soldCount: number;
  remainingTickets: number;
}

export type EventAvailabilityResult =
  | EventAvailabilityAdmin
  | EventAvailabilityUser
  | null;

export function buildAdminAvailability(
  base: AvailabilityShape,
  totalTickets: number,
  soldCount: number,
  remainingTickets: number,
): EventAvailabilityAdmin {
  return {
    totalTickets,
    soldCount,
    remainingTickets,
    ...base,
  };
}

export function buildUserAvailability(
  base: AvailabilityShape,
): EventAvailabilityUser {
  return {
    isSoldOut: base.isSoldOut,
    userTicketCount: base.userTicketCount,
    ticketSalesStatus: base.ticketSalesStatus,
    resaleAvailable: base.resaleAvailable,
    resaleEnabled: base.resaleEnabled,
    purchaseAccess: base.purchaseAccess,
    ...(base.isSubscribedToResaleNotifications !== undefined
      ? {
          isSubscribedToResaleNotifications:
            base.isSubscribedToResaleNotifications,
        }
      : {}),
  };
}

type EventAvailabilityCtx = QueryCtx;

type EventInventorySummary = {
  soldCount: number;
  remainingTickets: number;
  isSoldOut: boolean;
};

async function resolveEventInventory(args: {
  db: QueryCtx['db'];
  event: Doc<'events'>;
  eventId: Id<'events'>;
}): Promise<EventInventorySummary> {
  const inventory = await calculateEventInventory(
    args.db,
    args.eventId,
    args.event.totalTickets,
  );

  return {
    soldCount: inventory.soldCount,
    remainingTickets: inventory.remaining,
    isSoldOut: inventory.remaining === 0,
  };
}

async function countUserTicketsForEvent(
  db: Pick<QueryCtx['db'], 'query'>,
  userId: Id<'users'>,
  eventId: Id<'events'>,
): Promise<number> {
  return countMatchingInQuery(
    db
      .query('tickets')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', eventId),
      ),
    (ticket) => isActiveTicketStatus(ticket.status),
  );
}

async function countUserTicketsForEvents(args: {
  db: Pick<QueryCtx['db'], 'query'>;
  userId: Id<'users'>;
  eventIds: Id<'events'>[];
}): Promise<Map<Id<'events'>, number>> {
  const counts = await Promise.all(
    args.eventIds.map(async (eventId) => ({
      eventId,
      count: await countUserTicketsForEvent(args.db, args.userId, eventId),
    })),
  );

  return new Map(
    counts
      .filter(({count}) => count > 0)
      .map(({eventId, count}) => [eventId, count] as const),
  );
}

async function countListedResaleTicketsForEvent(
  db: Pick<QueryCtx['db'], 'query'>,
  eventId: Id<'events'>,
): Promise<number> {
  return countMatchingInQuery(
    db
      .query('resale_listings')
      .withIndex('by_event_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'listed'),
      ),
    (listing) => isListedResaleListingStatus(listing.status),
  );
}

async function hasResaleNotificationSubscription(
  db: Pick<QueryCtx['db'], 'query'>,
  userId: Id<'users'>,
  eventId: Id<'events'>,
): Promise<boolean> {
  const subscription = await db
    .query('resale_notifications')
    .withIndex('by_user_event', (q) =>
      q.eq('userId', userId).eq('eventId', eventId),
    )
    .first();

  return subscription !== null;
}

function buildAvailabilityBase(args: {
  inventory: EventInventorySummary;
  ticketSalesStatus: 'active' | 'paused' | 'ended';
  userTicketCount: number;
  resaleAvailable: number;
  resaleEnabled: boolean;
  isSubscribedToResaleNotifications?: boolean;
  purchaseAccess: PurchaseAccess;
}): AvailabilityShape {
  return {
    isSoldOut: args.inventory.isSoldOut,
    userTicketCount: args.userTicketCount,
    ticketSalesStatus: args.ticketSalesStatus,
    resaleAvailable: args.resaleAvailable,
    resaleEnabled: args.resaleEnabled,
    purchaseAccess: args.purchaseAccess,
    ...(args.isSubscribedToResaleNotifications !== undefined
      ? {
          isSubscribedToResaleNotifications:
            args.isSubscribedToResaleNotifications,
        }
      : {}),
  };
}

function buildEventAvailabilityResult(args: {
  event: Doc<'events'>;
  inventory: EventInventorySummary;
  isRootAdmin: boolean;
  ticketSalesStatus: 'active' | 'paused' | 'ended';
  userTicketCount: number;
  resaleAvailable: number;
  resaleEnabled: boolean;
  isSubscribedToResaleNotifications?: boolean;
  purchaseAccess: PurchaseAccess;
}): EventAvailabilityResult {
  const base = buildAvailabilityBase({
    inventory: args.inventory,
    ticketSalesStatus: args.ticketSalesStatus,
    userTicketCount: args.userTicketCount,
    resaleAvailable: args.resaleAvailable,
    resaleEnabled: args.resaleEnabled,
    isSubscribedToResaleNotifications: args.isSubscribedToResaleNotifications,
    purchaseAccess: args.purchaseAccess,
  });

  return args.isRootAdmin
    ? buildAdminAvailability(
        base,
        args.event.totalTickets,
        args.inventory.soldCount,
        args.inventory.remainingTickets,
      )
    : buildUserAvailability(base);
}

function buildBatchAvailabilityMap(args: {
  eventIds: Id<'events'>[];
  events: Array<Doc<'events'> | null>;
  inventoryByEventId: Map<Id<'events'>, EventInventorySummary>;
  resaleByEventId: Map<Id<'events'>, number>;
  userTicketsByEventId: Map<Id<'events'>, number>;
  purchaseAccessByEventId: Map<Id<'events'>, PurchaseAccess>;
  isRootAdmin: boolean;
}): Record<string, EventAvailabilityResult> {
  const results: Record<string, EventAvailabilityResult> = {};

  for (const [index, eventId] of args.eventIds.entries()) {
    const event = args.events[index];
    if (!event) {
      results[eventId] = null;
      continue;
    }

    const inventory = args.inventoryByEventId.get(eventId)!;
    results[eventId] = buildEventAvailabilityResult({
      event,
      inventory,
      isRootAdmin: args.isRootAdmin,
      ticketSalesStatus: event.ticketSalesStatus ?? 'active',
      userTicketCount: args.userTicketsByEventId.get(eventId) ?? 0,
      resaleAvailable: args.resaleByEventId.get(eventId) ?? 0,
      resaleEnabled: event.resaleEnabled ?? false,
      purchaseAccess: args.purchaseAccessByEventId.get(eventId) ?? {
        allowed: false,
      },
    });
  }

  return results;
}

export async function loadEventAvailability(
  ctx: EventAvailabilityCtx,
  args: {eventId: Id<'events'>; now: number},
): Promise<EventAvailabilityResult> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) return null;

  const userId = await getAuthUserId(ctx);
  if (!(await canViewEvent(ctx, userId, event))) {
    return null;
  }

  const isRootAdminUser = userId ? await isPlatformAdmin(ctx, userId) : false;
  const inventory = await resolveEventInventory({
    db: ctx.db,
    event,
    eventId: args.eventId,
  });
  const ticketSalesStatus = event.ticketSalesStatus ?? 'active';
  const purchaseAccess = await canPurchaseEventForUser(ctx, userId, event);

  if (!userId) {
    return buildUserAvailability({
      isSoldOut: inventory.isSoldOut,
      userTicketCount: 0,
      ticketSalesStatus,
      resaleAvailable: 0,
      resaleEnabled: event.resaleEnabled ?? false,
      purchaseAccess,
    });
  }

  const [userTicketCount, resaleAvailable, isSubscribedToResaleNotifications] =
    await Promise.all([
      countUserTicketsForEvent(ctx.db, userId, args.eventId),
      countListedResaleTicketsForEvent(ctx.db, args.eventId),
      hasResaleNotificationSubscription(ctx.db, userId, args.eventId),
    ]);

  return buildEventAvailabilityResult({
    event,
    inventory,
    isRootAdmin: isRootAdminUser,
    ticketSalesStatus,
    userTicketCount,
    resaleAvailable,
    resaleEnabled: event.resaleEnabled ?? false,
    isSubscribedToResaleNotifications,
    purchaseAccess,
  });
}

export async function loadBatchEventAvailability(
  ctx: EventAvailabilityCtx,
  args: {eventIds: Id<'events'>[]; now: number},
): Promise<Record<string, EventAvailabilityResult>> {
  if (args.eventIds.length > 50) {
    throwInvalidInput('Too many event IDs (max 50)', {
      field: 'eventIds',
      maxItems: 50,
    });
  }

  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return {};
  }

  const isRootAdminUser = await isPlatformAdmin(ctx, userId);
  const events = await Promise.all(
    args.eventIds.map((eventId) => ctx.db.get('events', eventId)),
  );
  const visibleEvents = await Promise.all(
    events.map(async (event) => {
      if (!event) return null;
      return (await canViewEvent(ctx, userId, event)) ? event : null;
    }),
  );

  const eventById = new Map(
    args.eventIds
      .map((eventId, index) => [eventId, visibleEvents[index]] as const)
      .filter(
        (entry): entry is [Id<'events'>, Doc<'events'>] => entry[1] !== null,
      ),
  );
  const validEventIds = new Set(eventById.keys());

  const orderedValidEventIds = Array.from(validEventIds);

  const [
    userTicketsByEventId,
    resaleCounts,
    inventoryResults,
    purchaseAccessResults,
  ] = await Promise.all([
    countUserTicketsForEvents({
      db: ctx.db,
      userId,
      eventIds: orderedValidEventIds,
    }),
    Promise.all(
      orderedValidEventIds.map(async (eventId) => ({
        eventId,
        count: await countListedResaleTicketsForEvent(ctx.db, eventId),
      })),
    ),
    Promise.all(
      orderedValidEventIds.map(async (eventId) => {
        const event = eventById.get(eventId)!;
        return {
          eventId,
          inventory: await resolveEventInventory({
            db: ctx.db,
            event,
            eventId,
          }),
        };
      }),
    ),
    Promise.all(
      orderedValidEventIds.map(async (eventId) => {
        const event = eventById.get(eventId)!;
        return {
          eventId,
          access: await canPurchaseEventForUser(ctx, userId, event),
        };
      }),
    ),
  ]);

  const inventoryByEventId = new Map(
    inventoryResults.map(
      ({eventId, inventory}) => [eventId, inventory] as const,
    ),
  );
  const resaleByEventId = new Map(
    resaleCounts.map(({eventId, count}) => [eventId, count] as const),
  );
  const purchaseAccessByEventId = new Map(
    purchaseAccessResults.map(
      ({eventId, access}) => [eventId, access] as const,
    ),
  );

  return buildBatchAvailabilityMap({
    eventIds: args.eventIds,
    events: visibleEvents,
    inventoryByEventId,
    resaleByEventId,
    userTicketsByEventId,
    purchaseAccessByEventId,
    isRootAdmin: isRootAdminUser,
  });
}
