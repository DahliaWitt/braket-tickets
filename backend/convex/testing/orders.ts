import {v} from 'convex/values';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {ORDER_HOLD_EXPIRATION_MS} from '../lib/constants';
import {assertOrderTrustMetadata} from '../lib/orders/trust';
import {
  callerTrustSourceValidator,
  tierValidator,
} from '../lib/validators/ticketing';
import {eventVisibilityValidator} from '../lib/validators/events';
import {seedOrderStatusValidator, testingMutation} from './wrappers';
import {insertSeedOrganizer} from './communities';
import {insertSeedEvent} from './events';

interface InsertSeedOrderArgs {
  userId?: Id<'users'>;
  eventId: Id<'events'>;
  amount: number;
  quantity: number;
  status: 'pending' | 'completed' | 'refunded';
  tier: 'regular' | 'notaflof' | 'supporter';
  guestSessionId?: Id<'guest_sessions'>;
  stripePaymentIntentId?: string;
  trustSource: 'direct' | 'shared' | 'open_access';
  trustViaOrganizerId?: Id<'organizers'>;
}

function normalizeSeedEventDate(date: string): string {
  return date.includes('T') ? date : `${date}T12:00:00.000Z`;
}

/* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test seed helper:
 * creates canonical order + ledger rows directly so dev resets and E2E setup can
 * cover completed, open, and refunded states without invoking Stripe checkout. */
export async function insertSeedOrder(
  ctx: MutationCtx,
  args: InsertSeedOrderArgs,
): Promise<{orderId: Id<'ticket_orders'>}> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    throw new Error(`Event ${args.eventId} not found`);
  }

  const now = Date.now();
  const orderState =
    args.status === 'pending' ? 'open' : ('completed' as const);
  assertOrderTrustMetadata({
    trustSource: args.trustSource,
    trustViaOrganizerId: args.trustViaOrganizerId,
  });

  // Snapshot the event's connected account onto the order so seed data
  // mirrors the production flow (see `lib/orders/open.ts`
  // `resolveOrderConnectedAccountId`). Refund + settlement code reads
  // this snapshot to route Stripe calls through `{stripeAccount}`.
  const organizer = await ctx.db.get('organizers', event.organizerId);
  const connectedAccountId =
    organizer && !organizer.isPlatformOrganizer
      ? organizer.stripeConnectedAccountId
      : undefined;

  const userId = args.guestSessionId ? undefined : args.userId;
  const orderId = await ctx.db.insert('ticket_orders', {
    userId,
    guestSessionId: args.guestSessionId,
    eventId: args.eventId,
    kind: 'primary',
    quantity: args.quantity,
    tier: args.tier,
    amountCents: args.amount,
    currency: 'USD',
    state: orderState,
    expiresAt: now + ORDER_HOLD_EXPIRATION_MS,
    completedAt: orderState === 'completed' ? now : undefined,
    stripePaymentIntentId: args.stripePaymentIntentId,
    ...(connectedAccountId !== undefined ? {connectedAccountId} : {}),
    trustSource: args.trustSource,
    trustViaOrganizerId: args.trustViaOrganizerId,
  });

  if (orderState === 'open' && event.inventoryId) {
    const inventory = await ctx.db.get('event_inventory', event.inventoryId);
    if (inventory && inventory.eventId === args.eventId) {
      await ctx.db.patch('event_inventory', inventory._id, {
        heldCount: inventory.heldCount + args.quantity,
      });
    }
  }

  if (orderState === 'completed') {
    await ctx.db.insert('order_financial_events', {
      orderId,
      eventId: args.eventId,
      currency: 'USD',
      kind: 'payment_captured',
      amountCents: args.amount,
      occurredAt: now,
    });
  }

  if (args.status === 'refunded') {
    await ctx.db.insert('order_financial_events', {
      orderId,
      eventId: args.eventId,
      currency: 'USD',
      kind: 'payment_refunded',
      amountCents: args.amount,
      occurredAt: now,
    });
  }

  return {orderId};
}
/* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

/**
 * Seeds a ticket order for testing.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedPayment = testingMutation({
  args: {
    userId: v.id('users'),
    eventId: v.id('events'),
    amount: v.number(),
    status: seedOrderStatusValidator,
    stripePaymentIntentId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    tier: v.optional(tierValidator),
    guestSessionId: v.optional(v.id('guest_sessions')),
    trustSource: callerTrustSourceValidator,
    trustViaOrganizerId: v.optional(v.id('organizers')),
  },
  returns: v.id('ticket_orders'),
  handler: async (ctx, args) => {
    const {orderId} = await insertSeedOrder(ctx, {
      userId: args.userId,
      eventId: args.eventId,
      amount: args.amount,
      quantity: args.quantity ?? 1,
      status: args.status,
      tier: args.tier ?? 'regular',
      guestSessionId: args.guestSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      trustSource: args.trustSource,
      trustViaOrganizerId: args.trustViaOrganizerId,
    });
    return orderId;
  },
});

/**
 * Upserts a shared sandbox-ready organizer + public event fixture used by QA/dev/staging
 * purchase-flow validation. This keeps purchase testing deterministic without weakening
 * runtime payment gates.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedSandboxPurchaseFixtureArgsValidator = {
  stripeConnectedAccountId: v.string(),
  organizerSlug: v.optional(v.string()),
  organizerName: v.optional(v.string()),
  organizerEmail: v.optional(v.string()),
  eventTitle: v.optional(v.string()),
  eventDate: v.optional(v.string()),
  eventPrice: v.optional(v.number()),
  totalTickets: v.optional(v.number()),
  visibility: eventVisibilityValidator,
};

export const seedSandboxPurchaseFixtureResultValidator = v.object({
  organizerId: v.id('organizers'),
  eventId: v.id('events'),
  organizerCreated: v.boolean(),
  eventCreated: v.boolean(),
  eventPath: v.string(),
});

interface SeedSandboxPurchaseFixtureArgs {
  stripeConnectedAccountId: string;
  organizerSlug?: string;
  organizerName?: string;
  organizerEmail?: string;
  eventTitle?: string;
  eventDate?: string;
  eventPrice?: number;
  totalTickets?: number;
  visibility?: Doc<'events'>['visibility'];
}

export async function seedSandboxPurchaseFixtureImpl(
  ctx: MutationCtx,
  args: SeedSandboxPurchaseFixtureArgs,
): Promise<{
  organizerId: Id<'organizers'>;
  eventId: Id<'events'>;
  organizerCreated: boolean;
  eventCreated: boolean;
  eventPath: string;
}> {
  const {db} = ctx;
  const organizerSlug = args.organizerSlug ?? 'qa-sandbox-organizer';
  const organizerName = args.organizerName ?? 'QA Sandbox Organizer';
  const organizerEmail = args.organizerEmail ?? 'qa-sandbox@braket.gay';

  const eventTitle = args.eventTitle ?? 'Guest Checkout Test Event';
  const eventDate = normalizeSeedEventDate(
    args.eventDate ??
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
  );
  const eventPrice = args.eventPrice ?? 2500;
  const totalTickets = args.totalTickets ?? 99;
  const visibility = args.visibility ?? 'public';

  const existingOrganizer = await db
    .query('organizers')
    .withIndex('by_slug', (q) => q.eq('slug', organizerSlug))
    .first();

  // Sandbox fixture vetting question — mirrors the invariant from
  // validatePublishedCommunityRequirements in backend/convex/lib/communities/writes.ts:
  // published communities must have at least one vetting question.
  const sandboxVettingQuestions: Doc<'organizers'>['vettingQuestions'] = [
    {
      id: 'q1',
      question: 'Are you using this for payment flow testing?',
      type: 'boolean' as const,
      required: true,
    },
  ];

  let organizerId: Id<'organizers'>;
  let organizerCreated = false;
  if (existingOrganizer) {
    organizerId = existingOrganizer._id;
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Upsert path: patching existing org, not creating
    await db.patch('organizers', organizerId, {
      name: organizerName,
      email: organizerEmail,
      slug: organizerSlug,
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      stripeOnboardingStatus: 'complete',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      isPlatformOrganizer: false,
      isPublicDirectory: true,
      status: 'published',
      vettingQuestions: existingOrganizer.vettingQuestions?.length
        ? existingOrganizer.vettingQuestions
        : sandboxVettingQuestions,
    });
  } else {
    organizerCreated = true;
    organizerId = await insertSeedOrganizer(ctx, {
      name: organizerName,
      email: organizerEmail,
      slug: organizerSlug,
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      isPlatformOrganizer: false,
      isPublicDirectory: true,
      status: 'published',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'How did you hear about this event?',
          type: 'text' as const,
          required: true,
        },
      ],
    });
  }

  const statuses: Array<'published' | 'draft' | 'cancelled'> = [
    'published',
    'draft',
    'cancelled',
  ];
  let existingEvent: Doc<'events'> | null = null;
  for (const status of statuses) {
    if (existingEvent) break;
    const batch = await db
      .query('events')
      .withIndex('by_organizer_status', (q) =>
        q.eq('organizerId', organizerId).eq('status', status),
      )
      .take(50);
    existingEvent = batch.find((event) => event.title === eventTitle) ?? null;
  }

  let eventId: Id<'events'>;
  let eventCreated = false;
  if (existingEvent) {
    eventId = existingEvent._id;
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Upsert path: patching an existing fixture event, not creating a new production event */
    await db.patch('events', eventId, {
      title: eventTitle,
      description: 'Automated Stripe sandbox purchase fixture event.',
      date: eventDate,
      location: 'Sandbox Fixture Venue',
      price: eventPrice,
      totalTickets,
      status: 'published',
      visibility,
      organizerId,
      ticketSalesStatus: 'active',
      maxTicketsPerUser: 10,
    });
    if (!existingEvent.inventoryId) {
      const inventoryId = await db.insert('event_inventory', {
        eventId,
        soldCount: 0,
        heldCount: 0,
      });
      await db.patch('events', eventId, {inventoryId});
    }
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  } else {
    eventCreated = true;
    eventId = await insertSeedEvent(ctx, {
      title: eventTitle,
      description: 'Automated Stripe sandbox purchase fixture event.',
      date: eventDate,
      location: 'Sandbox Fixture Venue',
      price: eventPrice,
      totalTickets,
      status: 'published',
      visibility,
      organizerId,
      ticketSalesStatus: 'active',
      maxTicketsPerUser: 10,
      supporterDefaultPrice: 0,
      slidingScaleEnabled: false,
      slidingScaleMin: 0,
      slidingScaleMax: 0,
      resaleEnabled: false,
    });
  }

  return {
    organizerId,
    eventId,
    organizerCreated,
    eventCreated,
    eventPath: `/events/${eventId}`,
  };
}

export const seedSandboxPurchaseFixture = testingMutation({
  args: seedSandboxPurchaseFixtureArgsValidator,
  returns: seedSandboxPurchaseFixtureResultValidator,
  handler: seedSandboxPurchaseFixtureImpl,
});
