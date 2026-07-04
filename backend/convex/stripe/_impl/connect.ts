import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {logger} from '../../lib/logger';
import {PAYOUT_BATCH_SIZE} from '../../lib/constants';
import {
  getAppErrorMessage,
  throwAppError,
  throwInvalidState,
  throwNotFound,
} from '../../lib/errors';
import {guardEmailDedup} from '../../lib/email_dedup';
import {enqueueEmailDelivery} from '../../lib/email_delivery_wrapper';
import {payoutSentTemplate} from '../../email/templates';
import type {OnboardingStatus} from '../../lib/validators/stripe_connect';
import {isOrganizerPayoutReady} from '../../lib/stripe_connect_state';
import {computeEventSettlements} from './payouts';
import {eventStartInstantMs} from '@shared/event-time';

export const MAX_ALLOCATIONS_PER_BATCH = 1_000;
/**
 * A `submitted` batch older than this without a confirming webhook gets its
 * payout status polled from Stripe (webhook fallback).
 */
export const SUBMITTED_BATCH_RECOVERY_AGE_MS = 48 * 60 * 60 * 1000;
/**
 * A `pending` batch older than this can no longer be replayed safely: Stripe
 * idempotency keys expire after 24h, so re-submitting would create a NEW
 * payout with the stale frozen amount. It is superseded instead.
 */
export const PENDING_BATCH_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 50;
const MAX_FINANCIAL_EVENTS_PER_MARKER_DERIVATION = 5_000;
const MAX_SETTLEMENT_EVENTS_PER_ACCOUNT = 500;
const MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT = 5_000;
const MAX_SETTLEMENT_CONFIRMED_ALLOCATIONS_PER_ACCOUNT = 1_000;
const MAX_SETTLEMENT_SUBMITTED_BATCHES_PER_ACCOUNT = 100;

type ReadCtx = Pick<QueryCtx, 'db'>;
type WriteCtx = Pick<MutationCtx, 'db' | 'scheduler'>;

async function maybeMarkFullySettledEventsPaidOut(
  ctx: WriteCtx,
  args: {
    connectedAccountId: string;
    allocations: Array<Doc<'payout_allocations'>>;
    now: number;
  },
): Promise<void> {
  const touchedEventIds = [...new Set(args.allocations.map((a) => a.eventId))];
  const touchedEvents = new Map(
    await Promise.all(
      touchedEventIds.map(async (eventId) => {
        const event = await ctx.db.get('events', eventId);
        return [eventId, event] as const;
      }),
    ),
  );

  for (const eventId of touchedEventIds) {
    const rawFinancialEvents = await ctx.db
      .query('order_financial_events')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .take(MAX_FINANCIAL_EVENTS_PER_MARKER_DERIVATION + 1);
    if (
      rawFinancialEvents.length > MAX_FINANCIAL_EVENTS_PER_MARKER_DERIVATION
    ) {
      logger.warn(
        'stripe',
        'Skipping paid-out marker derivation for event with too many financial events',
        {
          eventId,
          connectedAccountId: args.connectedAccountId,
          financialEventCount: rawFinancialEvents.length,
        },
      );
      continue;
    }
    const financialEvents = rawFinancialEvents
      .filter((row) => row.connectedAccountId === args.connectedAccountId)
      .map((row) => ({
        eventId: row.eventId,
        kind: row.kind,
        ...(row.connectedAccountNetCents !== undefined
          ? {connectedAccountNetCents: row.connectedAccountNetCents}
          : {}),
      }));

    const allocationRows = await ctx.db
      .query('payout_allocations')
      .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
      .take(MAX_ALLOCATIONS_PER_BATCH + 1);
    if (allocationRows.length > MAX_ALLOCATIONS_PER_BATCH) {
      logger.warn(
        'stripe',
        'Skipping paid-out marker derivation for event with too many payout allocations',
        {
          eventId,
          connectedAccountId: args.connectedAccountId,
          allocationCount: allocationRows.length,
        },
      );
      continue;
    }

    const confirmedAllocations = allocationRows
      .filter(
        (allocation) =>
          allocation.connectedAccountId === args.connectedAccountId &&
          allocation.status === 'paid',
      )
      .map((allocation) => ({
        eventId: allocation.eventId,
        amountCents: allocation.amountCents,
      }));
    const [settlement] = computeEventSettlements(
      financialEvents,
      [{_id: eventId, date: 0}],
      confirmedAllocations,
    );
    if (settlement && settlement.payableCents <= 0) {
      const event = touchedEvents.get(eventId);
      if (event && !event.paidOutAt) {
        await ctx.db.patch('events', eventId, {paidOutAt: args.now});
      }
    }
  }
}

export async function getOrganizerInternalImpl(
  ctx: ReadCtx,
  args: {organizerId: Id<'organizers'>},
) {
  return await ctx.db.get('organizers', args.organizerId);
}

export async function storeConnectedAccountIdImpl(
  ctx: WriteCtx,
  args: {
    organizerId: Id<'organizers'>;
    stripeConnectedAccountId: string;
    onboardingStatus?: OnboardingStatus;
  },
): Promise<null> {
  const organizer = await ctx.db.get('organizers', args.organizerId);
  if (!organizer) {
    throwNotFound('Organizer');
  }

  const patch: Partial<{
    stripeConnectedAccountId: string;
    stripeOnboardingStatus: typeof args.onboardingStatus;
  }> = {};

  if (organizer.stripeConnectedAccountId !== args.stripeConnectedAccountId) {
    patch.stripeConnectedAccountId = args.stripeConnectedAccountId;
  }
  if (
    args.onboardingStatus !== undefined &&
    organizer.stripeOnboardingStatus !== args.onboardingStatus
  ) {
    patch.stripeOnboardingStatus = args.onboardingStatus;
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.patch('organizers', args.organizerId, patch);
  }
  return null;
}

export async function markPayoutSettingsVerifiedImpl(
  ctx: WriteCtx,
  args: {organizerId: Id<'organizers'>; stripeConnectedAccountId: string},
): Promise<null> {
  const organizer = await ctx.db.get('organizers', args.organizerId);
  if (!organizer) {
    throwNotFound('Organizer');
  }
  if (organizer.stripeConnectedAccountId !== args.stripeConnectedAccountId) {
    throwInvalidState(
      'Connected account mismatch — refusing to mark payout settings verified',
    );
  }
  await ctx.db.patch('organizers', args.organizerId, {
    stripeOnboardingStatus: 'in_progress',
  });
  return null;
}

export async function updateOrganizerFromStripeAccountImpl(
  ctx: WriteCtx,
  args: {
    stripeConnectedAccountId: string;
    onboardingStatus: OnboardingStatus;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    currentlyDue: string[];
  },
): Promise<null> {
  const organizer = await ctx.db
    .query('organizers')
    .withIndex('by_stripeConnectedAccountId', (q) =>
      q.eq('stripeConnectedAccountId', args.stripeConnectedAccountId),
    )
    .unique();
  if (!organizer) {
    logger.warn(
      'stripe',
      'No organizer found for Stripe account (V2 sync path)',
      {stripeConnectedAccountId: args.stripeConnectedAccountId},
    );
    return null;
  }

  await ctx.db.patch('organizers', organizer._id, {
    stripeOnboardingStatus: args.onboardingStatus,
    stripeChargesEnabled: args.chargesEnabled,
    stripePayoutsEnabled: args.payoutsEnabled,
    stripeCurrentlyDue: args.currentlyDue,
  });
  return null;
}

export async function getSettlementDataForAccountImpl(
  ctx: ReadCtx,
  args: {stripeConnectedAccountId: string; eligibleBeforeMs: number},
) {
  const organizer = await ctx.db
    .query('organizers')
    .withIndex('by_stripeConnectedAccountId', (q) =>
      q.eq('stripeConnectedAccountId', args.stripeConnectedAccountId),
    )
    .unique();
  if (!organizer || organizer.isPlatformOrganizer) {
    return {
      organizerId: null,
      events: [],
      financialEvents: [],
      confirmedAllocations: [],
      inflightSubmittedCents: 0,
    };
  }

  const rawFinancialEvents = await ctx.db
    .query('order_financial_events')
    .withIndex('by_connectedAccountId', (q) =>
      q.eq('connectedAccountId', args.stripeConnectedAccountId),
    )
    .take(MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT + 1);
  if (rawFinancialEvents.length > MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT) {
    throwAppError(
      'PAYOUT_SETTLEMENT_OVERFLOW',
      `Stripe account ${args.stripeConnectedAccountId} has more than ${MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT} settlement ledger rows; refusing to compute a partial payout settlement`,
    );
  }
  const financialEvents = rawFinancialEvents.map((row) => ({
    eventId: row.eventId,
    kind: row.kind,
    ...(row.connectedAccountNetCents !== undefined
      ? {connectedAccountNetCents: row.connectedAccountNetCents}
      : {}),
  }));

  // Derive the event set from the ledger itself, not from event status or
  // current organizer: captured money is owed regardless of whether the
  // event was later drafted, cancelled, or reassigned. A status- or
  // organizer-filtered load silently drops those events' captures AND
  // refunds from settlement (the exact shape of the 2026-07 shortfall).
  const ledgerEventIds = [
    ...new Set(rawFinancialEvents.map((row) => row.eventId)),
  ];
  if (ledgerEventIds.length > MAX_SETTLEMENT_EVENTS_PER_ACCOUNT) {
    throwAppError(
      'PAYOUT_SETTLEMENT_OVERFLOW',
      `Stripe account ${args.stripeConnectedAccountId} has ledger rows for more than ${MAX_SETTLEMENT_EVENTS_PER_ACCOUNT} events; refusing to compute a partial payout settlement`,
    );
  }
  const ledgerEvents = await Promise.all(
    ledgerEventIds.map(async (eventId) => ({
      eventId,
      event: await ctx.db.get('events', eventId),
    })),
  );
  const events = ledgerEvents.flatMap(({eventId, event}) => {
    if (!event) {
      // Hard-deleted event with ledger money. Its rows drop out of the
      // settlement claim, so the trust gate will hold the account until an
      // operator resolves where the funds belong.
      logger.error(
        'stripe',
        'Settlement ledger references a deleted event; its funds are excluded from payout until repaired',
        {eventId, stripeConnectedAccountId: args.stripeConnectedAccountId},
      );
      return [];
    }
    const eventDateMs = eventStartInstantMs(event.date);
    if (eventDateMs === null) {
      throwAppError(
        'PAYOUT_SETTLEMENT_INVALID_EVENT_DATE',
        `Event ${event._id} has an invalid date; refusing to compute payout settlement for Stripe account ${args.stripeConnectedAccountId}`,
        {
          eventId: event._id,
          organizerId: organizer._id,
          stripeConnectedAccountId: args.stripeConnectedAccountId,
        },
      );
    }
    return {
      _id: event._id,
      date: eventDateMs,
      eligible: eventDateMs <= args.eligibleBeforeMs,
      title: event.title,
    };
  });

  const confirmedAllocations = await ctx.db
    .query('payout_allocations')
    .withIndex('by_connectedAccountId_and_status', (q) =>
      q
        .eq('connectedAccountId', args.stripeConnectedAccountId)
        .eq('status', 'paid'),
    )
    .take(MAX_SETTLEMENT_CONFIRMED_ALLOCATIONS_PER_ACCOUNT + 1);
  if (
    confirmedAllocations.length >
    MAX_SETTLEMENT_CONFIRMED_ALLOCATIONS_PER_ACCOUNT
  ) {
    throwAppError(
      'PAYOUT_SETTLEMENT_OVERFLOW',
      `Stripe account ${args.stripeConnectedAccountId} has more than ${MAX_SETTLEMENT_CONFIRMED_ALLOCATIONS_PER_ACCOUNT} confirmed payout allocations; refusing to compute a partial payout settlement`,
    );
  }

  const submittedBatches = await ctx.db
    .query('payout_batches')
    .withIndex('by_connectedAccountId_and_status', (q) =>
      q
        .eq('connectedAccountId', args.stripeConnectedAccountId)
        .eq('status', 'submitted'),
    )
    .take(MAX_SETTLEMENT_SUBMITTED_BATCHES_PER_ACCOUNT + 1);
  if (submittedBatches.length > MAX_SETTLEMENT_SUBMITTED_BATCHES_PER_ACCOUNT) {
    throwAppError(
      'PAYOUT_SETTLEMENT_OVERFLOW',
      `Stripe account ${args.stripeConnectedAccountId} has more than ${MAX_SETTLEMENT_SUBMITTED_BATCHES_PER_ACCOUNT} submitted payout batches; refusing to compute a partial payout settlement`,
    );
  }
  const inflightSubmittedCents = submittedBatches.reduce(
    (sum, batch) => sum + batch.amountCents,
    0,
  );

  return {
    organizerId: organizer._id,
    events,
    financialEvents,
    confirmedAllocations: confirmedAllocations.map((a) => ({
      eventId: a.eventId,
      amountCents: a.amountCents,
    })),
    inflightSubmittedCents,
  };
}

/**
 * Discovery iterates organizers, not events: settlement is derived from the
 * ledger, so event status or date must never decide whether an account gets
 * examined (a drafted or cancelled event with captured money still settles).
 * Accounts with nothing payable exit `processAccountPayout` before any
 * Stripe call, so scanning every payout-ready organizer daily is cheap.
 */
export async function listPayoutReadyConnectedAccountsImpl(
  ctx: ReadCtx,
  args: {limit: number},
): Promise<string[]> {
  const limit = Math.max(1, Math.min(args.limit, PAYOUT_BATCH_SIZE));
  const accounts: string[] = [];
  let cursor: string | null = null;

  while (accounts.length < limit) {
    const page = await ctx.db
      .query('organizers')
      .paginate({numItems: 100, cursor});

    for (const organizer of page.page) {
      if (organizer.isPlatformOrganizer) continue;
      if (!isOrganizerPayoutReady(organizer)) continue;
      const connectedAccountId = organizer.stripeConnectedAccountId;
      if (!connectedAccountId) continue;
      accounts.push(connectedAccountId);
      if (accounts.length >= limit) break;
    }

    cursor = page.continueCursor;
    if (page.isDone) break;
  }

  return accounts;
}

export async function listPlatformOrganizerEligibleEventIdsImpl(
  ctx: ReadCtx,
  args: {eligibleBeforeMs: number; limit: number},
): Promise<Id<'events'>[]> {
  const limit = Math.max(1, Math.min(args.limit, PAYOUT_BATCH_SIZE));
  const cutoff = new Date(args.eligibleBeforeMs).toISOString();
  const eventIds: Id<'events'>[] = [];
  let cursor: string | null = null;

  const fetchedOrganizers = new Map<
    Id<'organizers'>,
    Doc<'organizers'> | null
  >();
  while (eventIds.length < limit) {
    const page = await ctx.db
      .query('events')
      .withIndex('by_status_date', (q) =>
        q.eq('status', 'published').lt('date', cutoff),
      )
      .paginate({numItems: 100, cursor});

    const uniqueOrganizerIds: Id<'organizers'>[] = [];
    for (const event of page.page) {
      if (event.paidOutAt) continue;
      if (fetchedOrganizers.has(event.organizerId)) continue;
      fetchedOrganizers.set(event.organizerId, null);
      uniqueOrganizerIds.push(event.organizerId);
    }
    const freshOrganizers = await Promise.all(
      uniqueOrganizerIds.map((id) => ctx.db.get('organizers', id)),
    );
    uniqueOrganizerIds.forEach((id, idx) => {
      fetchedOrganizers.set(id, freshOrganizers[idx] ?? null);
    });

    for (const event of page.page) {
      if (event.paidOutAt) continue;
      const organizer = fetchedOrganizers.get(event.organizerId) ?? null;
      if (organizer?.isPlatformOrganizer) {
        eventIds.push(event._id);
        if (eventIds.length >= limit) break;
      }
    }

    cursor = page.continueCursor;
    if (page.isDone) break;
  }

  return eventIds;
}

export async function createPayoutIntentImpl(
  ctx: WriteCtx,
  args: {
    idempotencyKey: string;
    connectedAccountId: string;
    amountCents: number;
    currency: 'usd';
    allocations: Array<{eventId: Id<'events'>; amountCents: number}>;
  },
) {
  const byKey = await ctx.db
    .query('payout_batches')
    .withIndex('by_idempotencyKey', (q) =>
      q.eq('idempotencyKey', args.idempotencyKey),
    )
    .first();
  if (byKey) {
    return {
      batchId: byKey._id,
      idempotencyKey: byKey.idempotencyKey,
      amountCents: byKey.amountCents,
      currency: byKey.currency,
      status: byKey.status,
      createdAt: byKey.createdAt,
      ...(byKey.stripePayoutId !== undefined
        ? {stripePayoutId: byKey.stripePayoutId}
        : {}),
      reused: true,
    };
  }

  const existingPending = await ctx.db
    .query('payout_batches')
    .withIndex('by_connectedAccountId_and_status', (q) =>
      q
        .eq('connectedAccountId', args.connectedAccountId)
        .eq('status', 'pending'),
    )
    .first();
  const existing =
    existingPending ??
    (await ctx.db
      .query('payout_batches')
      .withIndex('by_connectedAccountId_and_status', (q) =>
        q
          .eq('connectedAccountId', args.connectedAccountId)
          .eq('status', 'submitted'),
      )
      .first());

  if (existing) {
    return {
      batchId: existing._id,
      idempotencyKey: existing.idempotencyKey,
      amountCents: existing.amountCents,
      currency: existing.currency,
      status: existing.status,
      createdAt: existing.createdAt,
      ...(existing.stripePayoutId !== undefined
        ? {stripePayoutId: existing.stripePayoutId}
        : {}),
      reused: true,
    };
  }

  const createdAt = Date.now();
  const batchId = await ctx.db.insert('payout_batches', {
    idempotencyKey: args.idempotencyKey,
    connectedAccountId: args.connectedAccountId,
    amountCents: args.amountCents,
    currency: args.currency,
    status: 'pending',
    origin: 'cron',
    createdAt,
  });

  await Promise.all(
    args.allocations.map((alloc) =>
      ctx.db.insert('payout_allocations', {
        batchId,
        connectedAccountId: args.connectedAccountId,
        eventId: alloc.eventId,
        amountCents: alloc.amountCents,
        status: 'pending_confirmation',
        createdAt,
      }),
    ),
  );

  return {
    batchId,
    idempotencyKey: args.idempotencyKey,
    amountCents: args.amountCents,
    currency: args.currency,
    status: 'pending' as const,
    createdAt,
    reused: false,
  };
}

/**
 * Operator repair support: `payment_captured` rows that never received
 * their BalanceTransaction net (pre-e3c02b1 capture race) and therefore
 * contribute nothing to settlement while their money sits in Stripe.
 * Charge/PI identifiers fall back to the order snapshot so the backfill
 * action can retrieve the charge.
 */
export async function listNetlessCapturedRowsImpl(
  ctx: ReadCtx,
  args: {stripeConnectedAccountId: string},
) {
  const rows = await ctx.db
    .query('order_financial_events')
    .withIndex('by_connectedAccountId', (q) =>
      q.eq('connectedAccountId', args.stripeConnectedAccountId),
    )
    .take(MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT + 1);
  if (rows.length > MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT) {
    throwAppError(
      'PAYOUT_SETTLEMENT_OVERFLOW',
      `Stripe account ${args.stripeConnectedAccountId} has more than ${MAX_SETTLEMENT_FINANCIAL_EVENTS_PER_ACCOUNT} ledger rows; refusing a partial backfill scan`,
    );
  }

  const bare = rows.filter(
    (row) =>
      row.kind === 'payment_captured' &&
      row.connectedAccountNetCents === undefined,
  );

  return await Promise.all(
    bare.map(async (row) => {
      let stripeChargeId = row.stripeChargeId ?? null;
      let stripePaymentIntentId = row.stripePaymentIntentId ?? null;
      if (!stripeChargeId || !stripePaymentIntentId) {
        const order = await ctx.db.get('ticket_orders', row.orderId);
        stripeChargeId = stripeChargeId ?? order?.stripeChargeId ?? null;
        stripePaymentIntentId =
          stripePaymentIntentId ?? order?.stripePaymentIntentId ?? null;
      }
      return {
        orderId: row.orderId,
        eventId: row.eventId,
        stripeChargeId,
        stripePaymentIntentId,
      };
    }),
  );
}

/**
 * Batches the daily cron must reconcile against Stripe before doing normal
 * payout work: `submitted` batches whose confirming webhook never arrived,
 * and `pending` batches too old to replay under their (expired) Stripe
 * idempotency key.
 */
export async function listPayoutBatchesNeedingRecoveryImpl(
  ctx: ReadCtx,
  args: {now: number},
) {
  const submitted = await ctx.db
    .query('payout_batches')
    .withIndex('by_status_and_createdAt', (q) =>
      q
        .eq('status', 'submitted')
        .lt('createdAt', args.now - SUBMITTED_BATCH_RECOVERY_AGE_MS),
    )
    .take(RECOVERY_BATCH_LIMIT);
  const pending = await ctx.db
    .query('payout_batches')
    .withIndex('by_status_and_createdAt', (q) =>
      q
        .eq('status', 'pending')
        .lt('createdAt', args.now - PENDING_BATCH_RECOVERY_AGE_MS),
    )
    .take(RECOVERY_BATCH_LIMIT);

  return {
    submitted: submitted.flatMap((batch) =>
      batch.stripePayoutId !== undefined
        ? {
            batchId: batch._id,
            connectedAccountId: batch.connectedAccountId,
            stripePayoutId: batch.stripePayoutId,
          }
        : [],
    ),
    pending: pending.map((batch) => ({
      batchId: batch._id,
      connectedAccountId: batch.connectedAccountId,
      amountCents: batch.amountCents,
    })),
  };
}

/**
 * Supersede a `pending` batch that can no longer be replayed (Stripe
 * idempotency key expired and no matching payout exists on the account).
 * Failing it re-opens the events' payable balance so the next cron run
 * recomputes a fresh, correctly-sized batch.
 */
export async function failStalePendingBatchImpl(
  ctx: WriteCtx,
  args: {batchId: Id<'payout_batches'>; failureReason: string},
): Promise<null> {
  const batch = await ctx.db.get('payout_batches', args.batchId);
  if (!batch || batch.status !== 'pending') {
    return null;
  }

  const now = Date.now();
  await ctx.db.patch('payout_batches', args.batchId, {
    status: 'failed',
    confirmedAt: now,
    failureReason: args.failureReason,
  });
  const allocations = await loadBatchAllocations(ctx, args.batchId);
  for (const allocation of allocations) {
    if (allocation.status !== 'failed') {
      await ctx.db.patch('payout_allocations', allocation._id, {
        status: 'failed',
        confirmedAt: now,
        failureReason: args.failureReason,
      });
    }
  }
  logger.warn('stripe', 'Superseded stale pending payout batch', {
    batchId: args.batchId,
    connectedAccountId: batch.connectedAccountId,
    amountCents: batch.amountCents,
    failureReason: args.failureReason,
  });
  return null;
}

export async function markPayoutBatchSubmittedImpl(
  ctx: WriteCtx,
  args: {batchId: Id<'payout_batches'>; stripePayoutId: string},
): Promise<null> {
  const batch = await ctx.db.get('payout_batches', args.batchId);
  if (!batch) return null;
  if (batch.status === 'submitted' || batch.status === 'paid') return null;

  const allocations = await ctx.db
    .query('payout_allocations')
    .withIndex('by_batchId', (q) => q.eq('batchId', args.batchId))
    .take(MAX_ALLOCATIONS_PER_BATCH);
  if (allocations.length >= MAX_ALLOCATIONS_PER_BATCH) {
    throwAppError(
      'PAYOUT_BATCH_TOO_LARGE',
      `payout batch ${args.batchId} has ${allocations.length}+ allocations; refusing to mark submitted without full confirmation pagination`,
    );
  }

  const submittedAt = Date.now();
  await ctx.db.patch('payout_batches', args.batchId, {
    status: 'submitted',
    submittedAt,
    stripePayoutId: args.stripePayoutId,
  });
  await Promise.all(
    allocations.map((alloc) =>
      ctx.db.patch('payout_allocations', alloc._id, {
        stripePayoutId: args.stripePayoutId,
      }),
    ),
  );
  return null;
}

/**
 * Optional webhook context threaded through `confirmPayout` / `failPayout`.
 * `metadataBatchId` heals the payout.paid-before-markSubmitted race by
 * matching our own payout via the `braketBatchId` metadata stamped on
 * `payouts.create`; `amountCents`/`currency`/`connectedAccountId` allow a
 * truly external payout (Stripe dashboard) to be ingested instead of
 * silently ignored.
 */
export interface PayoutWebhookContext {
  amountCents?: number;
  currency?: string;
  metadataBatchId?: string;
  connectedAccountId?: string;
}

/**
 * Resolve a batch by the `braketBatchId` metadata on the Stripe payout and
 * stamp `stripePayoutId` onto the batch and its allocations. Heals the race
 * where `payout.paid` arrives before `markPayoutBatchSubmitted` stamped the
 * id (previously: "unknown payout; ignoring" and a permanently wedged
 * `submitted` batch).
 */
async function resolveBatchByMetadata(
  ctx: WriteCtx,
  args: {stripePayoutId: string} & PayoutWebhookContext,
): Promise<Doc<'payout_batches'> | null> {
  if (args.metadataBatchId === undefined) return null;
  const batchId = ctx.db.normalizeId('payout_batches', args.metadataBatchId);
  if (!batchId) return null;
  const batch = await ctx.db.get('payout_batches', batchId);
  if (!batch) return null;
  if (
    args.connectedAccountId !== undefined &&
    batch.connectedAccountId !== args.connectedAccountId
  ) {
    logger.error('stripe', 'payout metadata batch/account mismatch; ignoring', {
      stripePayoutId: args.stripePayoutId,
      batchId,
      batchConnectedAccountId: batch.connectedAccountId,
      webhookConnectedAccountId: args.connectedAccountId,
    });
    return null;
  }
  if (
    batch.stripePayoutId !== undefined &&
    batch.stripePayoutId !== args.stripePayoutId
  ) {
    logger.error(
      'stripe',
      'payout metadata points at a batch with a different payout id; ignoring',
      {
        stripePayoutId: args.stripePayoutId,
        batchId,
        batchStripePayoutId: batch.stripePayoutId,
      },
    );
    return null;
  }

  if (batch.stripePayoutId === undefined) {
    await ctx.db.patch('payout_batches', batchId, {
      stripePayoutId: args.stripePayoutId,
    });
    const allocations = await loadBatchAllocations(ctx, batchId);
    await Promise.all(
      allocations.map((alloc) =>
        alloc.stripePayoutId === undefined
          ? ctx.db.patch('payout_allocations', alloc._id, {
              stripePayoutId: args.stripePayoutId,
            })
          : Promise.resolve(),
      ),
    );
    logger.info('stripe', 'Recovered payout batch via metadata match', {
      stripePayoutId: args.stripePayoutId,
      batchId,
    });
  }
  return await ctx.db.get('payout_batches', batchId);
}

async function loadBatchAllocations(
  ctx: WriteCtx,
  batchId: Id<'payout_batches'>,
): Promise<Array<Doc<'payout_allocations'>>> {
  const allocations = await ctx.db
    .query('payout_allocations')
    .withIndex('by_batchId', (q) => q.eq('batchId', batchId))
    .take(MAX_ALLOCATIONS_PER_BATCH);
  if (allocations.length >= MAX_ALLOCATIONS_PER_BATCH) {
    throwAppError(
      'PAYOUT_BATCH_TOO_LARGE',
      `payout batch ${batchId} has ${allocations.length}+ allocations; refusing to partially transition`,
    );
  }
  return allocations;
}

/**
 * Record a payout that was created outside the pipeline (Stripe dashboard)
 * as an already-`paid` batch with FIFO allocations, so `alreadyPaidOut`
 * reflects the real money movement and manual payouts stop corrupting the
 * settlement math.
 *
 * Allocation ignores eligibility on purpose: the money already moved, so
 * attribution follows every positive payable oldest-event-first. Any
 * remainder beyond the ledger's total payable cannot be attributed and is
 * logged as an error for operator follow-up.
 */
async function ingestExternalPaidPayout(
  ctx: WriteCtx,
  args: {stripePayoutId: string} & PayoutWebhookContext,
): Promise<null> {
  if (
    args.connectedAccountId === undefined ||
    args.amountCents === undefined ||
    args.amountCents <= 0 ||
    args.currency !== 'usd'
  ) {
    logger.warn(
      'stripe',
      'payout.paid received for unknown payout; not ingestable; ignoring',
      {
        stripePayoutId: args.stripePayoutId,
        hasConnectedAccountId: args.connectedAccountId !== undefined,
        currency: args.currency,
      },
    );
    return null;
  }

  const idempotencyKey = `external-${args.stripePayoutId}`;
  const existing = await ctx.db
    .query('payout_batches')
    .withIndex('by_idempotencyKey', (q) =>
      q.eq('idempotencyKey', idempotencyKey),
    )
    .first();
  if (existing) {
    return null;
  }

  const bundle = await getSettlementDataForAccountImpl(ctx, {
    stripeConnectedAccountId: args.connectedAccountId,
    eligibleBeforeMs: Date.now(),
  });
  if (!bundle.organizerId) {
    logger.error(
      'stripe',
      'External payout on an account with no organizer; cannot ingest',
      {
        stripePayoutId: args.stripePayoutId,
        connectedAccountId: args.connectedAccountId,
      },
    );
    return null;
  }
  const settlements = computeEventSettlements(
    bundle.financialEvents,
    bundle.events,
    bundle.confirmedAllocations,
  );
  const payables = settlements
    .filter((s) => s.payableCents > 0)
    .sort((a, b) => a.eventDate - b.eventDate);

  const now = Date.now();
  const batchId = await ctx.db.insert('payout_batches', {
    idempotencyKey,
    connectedAccountId: args.connectedAccountId,
    amountCents: args.amountCents,
    currency: 'usd',
    status: 'paid',
    stripePayoutId: args.stripePayoutId,
    origin: 'external',
    createdAt: now,
    submittedAt: now,
    confirmedAt: now,
  });

  // FIFO amounts are derived synchronously first; inserts and the readback
  // for `maybeMarkFullySettledEventsPaidOut` then run batched. Captured as
  // a const so the guard's narrowing survives into the map callbacks.
  const connectedAccountId = args.connectedAccountId;
  let remaining = args.amountCents;
  const fifoAllocations: Array<{eventId: Id<'events'>; amountCents: number}> =
    [];
  for (const eventSettlement of payables) {
    if (remaining <= 0) break;
    const amountCents = Math.min(eventSettlement.payableCents, remaining);
    fifoAllocations.push({
      eventId: eventSettlement.eventId as Id<'events'>,
      amountCents,
    });
    remaining -= amountCents;
  }
  const allocationIds = await Promise.all(
    fifoAllocations.map((alloc) =>
      ctx.db.insert('payout_allocations', {
        batchId,
        stripePayoutId: args.stripePayoutId,
        connectedAccountId,
        eventId: alloc.eventId,
        amountCents: alloc.amountCents,
        status: 'paid',
        createdAt: now,
        confirmedAt: now,
      }),
    ),
  );
  const allocations = (
    await Promise.all(
      allocationIds.map((allocationId) =>
        ctx.db.get('payout_allocations', allocationId),
      ),
    )
  ).filter((allocation): allocation is Doc<'payout_allocations'> =>
    Boolean(allocation),
  );

  logger.info('stripe', 'Ingested external payout as paid batch', {
    stripePayoutId: args.stripePayoutId,
    connectedAccountId: args.connectedAccountId,
    amountCents: args.amountCents,
    allocatedCents: args.amountCents - remaining,
    allocationCount: allocations.length,
  });
  if (remaining > 0) {
    logger.error(
      'stripe',
      'External payout exceeds ledger payable; remainder unattributed',
      {
        stripePayoutId: args.stripePayoutId,
        connectedAccountId: args.connectedAccountId,
        unattributedCents: remaining,
      },
    );
  }

  try {
    await maybeMarkFullySettledEventsPaidOut(ctx, {
      connectedAccountId: args.connectedAccountId,
      allocations,
      now,
    });
  } catch (error: unknown) {
    logger.warn(
      'stripe',
      'Ingested external payout but could not derive paid-out event markers',
      {
        stripePayoutId: args.stripePayoutId,
        error: getAppErrorMessage(error) ?? String(error),
      },
    );
  }
  return null;
}

export async function confirmPayoutImpl(
  ctx: WriteCtx,
  args: {stripePayoutId: string} & PayoutWebhookContext,
): Promise<null> {
  let batch = await ctx.db
    .query('payout_batches')
    .withIndex('by_stripePayoutId', (q) =>
      q.eq('stripePayoutId', args.stripePayoutId),
    )
    .unique();

  if (!batch) {
    batch = await resolveBatchByMetadata(ctx, args);
  }
  if (!batch) {
    return await ingestExternalPaidPayout(ctx, args);
  }

  const now = Date.now();
  const isFirstTransition = batch.status !== 'paid';
  if (isFirstTransition) {
    await ctx.db.patch('payout_batches', batch._id, {
      status: 'paid',
      confirmedAt: now,
    });
  }

  const allocations = await loadBatchAllocations(ctx, batch._id);

  for (const allocation of allocations) {
    if (allocation.status !== 'paid') {
      await ctx.db.patch('payout_allocations', allocation._id, {
        status: 'paid',
        confirmedAt: now,
        ...(allocation.stripePayoutId === undefined
          ? {stripePayoutId: args.stripePayoutId}
          : {}),
      });
    }
  }

  if (isFirstTransition) {
    try {
      await maybeMarkFullySettledEventsPaidOut(ctx, {
        connectedAccountId: batch.connectedAccountId,
        allocations,
        now,
      });
    } catch (error: unknown) {
      logger.warn(
        'stripe',
        'Confirmed payout but could not derive paid-out event markers',
        {
          stripePayoutId: args.stripePayoutId,
          error: getAppErrorMessage(error) ?? String(error),
        },
      );
    }
  }
  return null;
}

export async function failPayoutImpl(
  ctx: WriteCtx,
  args: {stripePayoutId: string; failureReason?: string} & PayoutWebhookContext,
): Promise<null> {
  let batch = await ctx.db
    .query('payout_batches')
    .withIndex('by_stripePayoutId', (q) =>
      q.eq('stripePayoutId', args.stripePayoutId),
    )
    .unique();
  if (!batch) {
    batch = await resolveBatchByMetadata(ctx, args);
  }
  if (!batch) {
    // A failed external payout returns its funds to the balance — no
    // ledger impact, so ignoring is correct (unlike payout.paid).
    logger.warn(
      'stripe',
      'payout.failed received for unknown payout; ignoring',
      {
        stripePayoutId: args.stripePayoutId,
      },
    );
    return null;
  }

  const now = Date.now();
  if (batch.status !== 'failed') {
    await ctx.db.patch('payout_batches', batch._id, {
      status: 'failed',
      confirmedAt: now,
      ...(args.failureReason !== undefined
        ? {failureReason: args.failureReason}
        : {}),
    });
  }

  const allocations = await loadBatchAllocations(ctx, batch._id);

  for (const allocation of allocations) {
    if (allocation.status !== 'failed') {
      await ctx.db.patch('payout_allocations', allocation._id, {
        status: 'failed',
        confirmedAt: now,
        ...(args.failureReason !== undefined
          ? {failureReason: args.failureReason}
          : {}),
      });
    }
  }
  return null;
}

export async function markEventPaidOutImpl(
  ctx: MutationCtx,
  args: {eventId: Id<'events'>; payoutAmountCents?: number},
): Promise<null> {
  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    throwNotFound('Event');
  }
  if (event.paidOutAt) {
    return null;
  }
  await ctx.db.patch('events', args.eventId, {paidOutAt: Date.now()});

  if (args.payoutAmountCents && args.payoutAmountCents > 0) {
    const organizer = await ctx.db.get('organizers', event.organizerId);
    if (organizer?.email) {
      const dedupKey = `payout-sent-${args.eventId}`;
      const alreadySent = await guardEmailDedup(ctx, dedupKey);
      if (!alreadySent) {
        const amountFormatted = `$${(args.payoutAmountCents / 100).toFixed(2)}`;
        const {subject, html} = payoutSentTemplate(
          organizer.name,
          amountFormatted,
          event.title,
          args.eventId,
          organizer.slug ?? event.organizerId,
        );
        await enqueueEmailDelivery(
          ctx,
          {to: organizer.email, subject, html},
          {
            source: 'payout',
            sourceId: args.eventId as string,
            recipient: organizer.email,
          },
        );
      }
    }
  }
  return null;
}

export async function getOrderByStripePaymentIntentIdImpl(
  ctx: ReadCtx,
  args: {stripePaymentIntentId: string},
) {
  const order = await ctx.db
    .query('ticket_orders')
    .withIndex('by_stripePaymentIntentId', (q) =>
      q.eq('stripePaymentIntentId', args.stripePaymentIntentId),
    )
    .unique();

  if (!order) return null;
  return {
    _id: order._id,
    userId: order.userId,
    guestSessionId: order.guestSessionId,
    status: order.state,
    amountCents: order.amountCents,
    eventId: order.eventId,
    stripeChargeId: order.stripeChargeId,
  };
}
