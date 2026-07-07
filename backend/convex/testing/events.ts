import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {assertCommunityNotDraft} from '../lib/events/community_guards';
import {
  toEventCreateFields,
  validateCreateEventInput,
} from '../lib/events/writes';
import {canonicalEventDocValidator} from '../lib/events/validators';
import {
  eventStatusValidator,
  eventVisibilityValidator,
  ticketSalesStatusValidator,
} from '../lib/validators/events';
import type {EventStatus} from '@shared/domain/event-status';
import type {EventVisibility} from '@shared/domain/event-visibility';
import {testingMutation, testingQuery} from './wrappers';

const seedEventArgsValidator = {
  title: v.string(),
  date: v.string(),
  endDate: v.optional(v.string()),
  price: v.number(),
  organizerId: v.id('organizers'),
  description: v.optional(v.string()),
  location: v.optional(v.string()),
  totalTickets: v.optional(v.number()),
  status: v.optional(eventStatusValidator),
  visibility: eventVisibilityValidator,
  ticketSalesStatus: ticketSalesStatusValidator,
  supporterDefaultPrice: v.optional(v.number()),
  maxTicketsPerUser: v.optional(v.number()),
  slidingScaleEnabled: v.optional(v.boolean()),
  slidingScaleMin: v.optional(v.number()),
  slidingScaleMax: v.optional(v.number()),
  resaleEnabled: v.optional(v.boolean()),
  resaleFeePct: v.optional(v.number()),
  soldCount: v.optional(v.number()),
  poster: v.optional(v.string()),
  paidOutAt: v.optional(v.number()),
} as const;

function applySeedEventDefaults(
  args: InsertSeedEventArgs,
): InsertSeedEventArgs {
  return {
    ...args,
    // E2E defaults — not set by shared function
    description: args.description ?? 'Seeded event for testing',
    location: args.location ?? 'Test Location',
    supporterDefaultPrice: args.supporterDefaultPrice ?? 0,
    maxTicketsPerUser: args.maxTicketsPerUser ?? 10,
    slidingScaleEnabled: args.slidingScaleEnabled ?? false,
    slidingScaleMin: args.slidingScaleMin ?? 0,
    slidingScaleMax: args.slidingScaleMax ?? 0,
    resaleEnabled: args.resaleEnabled ?? false,
  };
}

// 70% regular, 20% supporter, 10% notaflof — rounded so the sum is
// always exactly `count`. Distribution is deterministic so seed output
// stays stable across runs.
export function distributePhantomTiers(
  count: number,
): Array<'regular' | 'supporter' | 'notaflof'> {
  const regularCount = Math.round(count * 0.7);
  const supporterCount = Math.round(count * 0.2);
  const notaflofCount = count - regularCount - supporterCount;
  const tiers: Array<'regular' | 'supporter' | 'notaflof'> = [];
  for (let i = 0; i < regularCount; i++) tiers.push('regular');
  for (let i = 0; i < supporterCount; i++) tiers.push('supporter');
  for (let i = 0; i < notaflofCount; i++) tiers.push('notaflof');
  return tiers;
}

interface InsertSeedEventArgs {
  title: string;
  date: string;
  endDate?: string;
  price: number;
  organizerId: Id<'organizers'>;
  description?: string;
  location?: string;
  poster?: string;
  totalTickets?: number;
  status?: EventStatus;
  visibility?: EventVisibility;
  ticketSalesStatus?: 'active' | 'paused' | 'ended';
  soldCount?: number;
  supporterDefaultPrice?: number;
  maxTicketsPerUser?: number;
  slidingScaleEnabled?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  resaleEnabled?: boolean;
  resaleFeePct?: number;
  paidOutAt?: number;
}

/* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test seed helper:
 * creates a complete event + inventory pair with demo-only knobs that production
 * event mutations intentionally do not expose. */
export async function insertSeedEvent(
  ctx: MutationCtx,
  args: InsertSeedEventArgs,
): Promise<Id<'events'>> {
  // Normalize short date (e.g. '2030-01-01') to full ISO 8601 UTC so the
  // internal mutation's validateCreateEventInput call accepts it.
  // Use noon UTC (T12:00:00.000Z) instead of midnight UTC so the date is the
  // same calendar day in every US timezone (noon UTC = 5am–8am US time).
  // Midnight UTC would fall on the prior calendar day in US timezones.
  const normalizedDate = args.date.includes('T')
    ? args.date
    : `${args.date}T12:00:00.000Z`;

  const sliderConfig = args.slidingScaleEnabled
    ? {
        enabled: true,
        min: args.slidingScaleMin,
        max: args.slidingScaleMax,
      }
    : args.slidingScaleEnabled === false
      ? {enabled: false}
      : undefined;

  await assertCommunityNotDraft(
    ctx.db,
    args.organizerId,
    args.status ?? 'published',
  );
  validateCreateEventInput({
    title: args.title,
    description: args.description,
    date: normalizedDate,
    endDate: args.endDate,
    location: args.location,
    price: args.price,
    totalTickets: args.totalTickets ?? 100,
    status: args.status ?? 'published',
    poster: args.poster,
    organizerId: args.organizerId,
    supporterDefaultPrice: args.supporterDefaultPrice,
    maxTicketsPerUser: args.maxTicketsPerUser,
    visibility: args.visibility ?? 'private',
    sliderConfig,
  });
  const fields = toEventCreateFields({
    title: args.title,
    description: args.description,
    date: normalizedDate,
    endDate: args.endDate,
    location: args.location,
    price: args.price,
    totalTickets: args.totalTickets ?? 100,
    status: args.status ?? 'published',
    poster: args.poster,
    organizerId: args.organizerId,
    supporterDefaultPrice: args.supporterDefaultPrice,
    maxTicketsPerUser: args.maxTicketsPerUser,
    visibility: args.visibility ?? 'private',
    sliderConfig,
  });

  const eventId = await ctx.db.insert('events', {
    ...fields,
    ticketSalesStatus: args.ticketSalesStatus ?? 'active',
    resaleEnabled: args.resaleEnabled,
    resaleFeePct: args.resaleFeePct,
    paidOutAt: args.paidOutAt,
  });
  const inventoryId = await ctx.db.insert('event_inventory', {
    eventId,
    soldCount: args.soldCount ?? 0,
    heldCount: 0,
  });
  await ctx.db.patch('events', eventId, {inventoryId});

  // Materialize phantom tickets to match the seeded soldCount so the
  // management page's tier breakdown (sourced from the tickets table)
  // agrees with the summary counter. Without this step, an inflated
  // seed counter produces e.g. "62 / 100 sold" while "TICKET TIERS"
  // shows 3 — violating an invariant that prod code maintains
  // transactionally. Phantom tickets are tied to a single event-scoped
  // guest session so they don't pollute the BUYERS tab (which reads
  // ticket_orders, not tickets).
  const phantomCount = args.soldCount ?? 0;
  if (phantomCount > 0) {
    const phantomSessionId = await ctx.db.insert('guest_sessions', {
      email: `seed+phantom+${eventId}@example.com`,
      sessionToken: `seed-phantom-${eventId}-${Math.random()
        .toString(36)
        .slice(2)}`,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    const tiers = distributePhantomTiers(phantomCount);
    for (const tier of tiers) {
      await ctx.db.insert('tickets', {
        eventId,
        guestSessionId: phantomSessionId,
        status: 'valid',
        tier,
      });
    }
  }

  return eventId;
}
/* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

/**
 * Seeds a test event directly into the database.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEvent = testingMutation({
  args: seedEventArgsValidator,
  returns: v.id('events'),
  handler: async (ctx, args) => {
    return insertSeedEvent(ctx, applySeedEventDefaults(args));
  },
});

/**
 * Seeds many events through the same validation/defaulting path as `seedEvent`.
 * Used by tests that need large fixture sets without raw DB writes in spec files.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEventsBatch = testingMutation({
  args: {
    events: v.array(v.object(seedEventArgsValidator)),
  },
  returns: v.array(v.id('events')),
  handler: async (ctx, args) => {
    const eventIds: Id<'events'>[] = [];
    for (const event of args.events) {
      eventIds.push(await insertSeedEvent(ctx, applySeedEventDefaults(event)));
    }
    return eventIds;
  },
});

/**
 * Seeds an event with specific inventory counts, bypassing the default soldCount/heldCount
 * initialisation in insertSeedEvent. Use this only when testing inventory calculation logic
 * that requires explicit control over soldCount and heldCount (e.g. calculateEventInventory).
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEventWithInventory = testingMutation({
  args: {
    organizerId: v.id('organizers'),
    title: v.string(),
    totalTickets: v.number(),
    soldCount: v.number(),
    heldCount: v.number(),
  },
  returns: v.id('events'),
  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Intentionally invalid state for inventory edge-case tests */
  handler: async ({db}, args) => {
    const eventId = await db.insert('events', {
      title: args.title,
      price: 1000,
      totalTickets: args.totalTickets,
      date: '2030-12-15T12:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: args.organizerId,
    });
    const inventoryId = await db.insert('event_inventory', {
      eventId,
      soldCount: args.soldCount,
      heldCount: args.heldCount,
    });
    await db.patch('events', eventId, {inventoryId});
    return eventId;
  },
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
});

/**
 * Seeds an event without an inventoryId. Used to test calculateEventInventory's
 * "fails closed when inventoryId is missing" invariant — a state that production
 * mutations never produce but the validator must guard against.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEventWithoutInventory = testingMutation({
  args: {
    organizerId: v.id('organizers'),
    title: v.string(),
    totalTickets: v.number(),
  },
  returns: v.id('events'),
  handler: async ({db}, args) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Intentionally invalid state: event without inventory for edge-case tests
    return db.insert('events', {
      title: args.title,
      price: 1000,
      totalTickets: args.totalTickets,
      date: '2030-12-15T12:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: args.organizerId,
    });
  },
});

/**
 * Seeds an event whose inventoryId points to a row for a different event. Used to test
 * calculateEventInventory's "invalid inventory linkage" invariant — an impossible
 * production state that the validator must still guard against.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedEventWithMismatchedInventory = testingMutation({
  args: {
    organizerId: v.id('organizers'),
  },
  returns: v.object({
    eventId: v.id('events'),
    otherEventId: v.id('events'),
  }),
  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Intentionally invalid state: mismatched inventory linkage for edge-case tests */
  handler: async ({db}, args) => {
    const eventId = await db.insert('events', {
      title: 'Broken Event',
      price: 1000,
      totalTickets: 10,
      date: '2030-12-15T12:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: args.organizerId,
    });
    const otherEventId = await db.insert('events', {
      title: 'Other Event',
      price: 1000,
      totalTickets: 10,
      date: '2030-12-15T12:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: args.organizerId,
    });
    const inventoryId = await db.insert('event_inventory', {
      eventId: otherEventId,
      soldCount: 0,
      heldCount: 0,
    });
    await db.patch('events', eventId, {inventoryId});
    return {eventId, otherEventId};
  },
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
});

/**
 * Gets an event by ID, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const getEvent = testingQuery({
  args: {eventId: v.id('events')},
  returns: v.union(canonicalEventDocValidator, v.null()),
  handler: async ({db}, {eventId}) => {
    return await db.get('events', eventId);
  },
});
