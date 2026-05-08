import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {DEFAULT_CURRENCY} from '../../lib/constants';

export async function findExistingOrderFinancialEvent(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    kind: Doc<'order_financial_events'>['kind'];
  },
): Promise<Doc<'order_financial_events'> | null> {
  return await db
    .query('order_financial_events')
    .withIndex('by_order_and_kind', (q) =>
      q.eq('orderId', args.orderId).eq('kind', args.kind),
    )
    .first();
}

async function findExistingDisputeFinancialEvent(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    kind: 'dispute_opened' | 'dispute_closed';
    stripeDisputeId: string;
  },
): Promise<Doc<'order_financial_events'> | null> {
  return await db
    .query('order_financial_events')
    .withIndex('by_order_and_kind_and_stripeDisputeId', (q) =>
      q
        .eq('orderId', args.orderId)
        .eq('kind', args.kind)
        .eq('stripeDisputeId', args.stripeDisputeId),
    )
    .first();
}

async function findExistingRefundFinancialEvent(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    stripeRefundId: string;
  },
): Promise<Doc<'order_financial_events'> | null> {
  return await db
    .query('order_financial_events')
    .withIndex('by_order_and_kind_and_stripeRefundId', (q) =>
      q
        .eq('orderId', args.orderId)
        .eq('kind', 'payment_refunded')
        .eq('stripeRefundId', args.stripeRefundId),
    )
    .first();
}

function hasSettlementFields(args: {
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
}): boolean {
  return (
    args.processorFeeCents !== undefined ||
    args.platformFeeCents !== undefined ||
    args.connectedAccountNetCents !== undefined
  );
}

async function patchExistingMoneyMovementEvent(
  db: MutationCtx['db'],
  existing: Doc<'order_financial_events'>,
  args: {
    orderId: Id<'ticket_orders'>;
    amountCents?: number;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeRefundId?: string;
    stripeEventId?: string;
    connectedAccountId?: string;
    processorFeeCents?: number;
    platformFeeCents?: number;
    connectedAccountNetCents?: number;
    note?: string;
  },
): Promise<void> {
  const patch: Partial<Doc<'order_financial_events'>> = {};

  if (
    args.amountCents !== undefined &&
    existing.amountCents !== args.amountCents
  ) {
    patch.amountCents = args.amountCents;
  }
  if (
    args.stripePaymentIntentId !== undefined &&
    existing.stripePaymentIntentId !== args.stripePaymentIntentId
  ) {
    patch.stripePaymentIntentId = args.stripePaymentIntentId;
  }
  if (
    args.stripeChargeId !== undefined &&
    existing.stripeChargeId !== args.stripeChargeId
  ) {
    patch.stripeChargeId = args.stripeChargeId;
  }
  if (
    args.stripeRefundId !== undefined &&
    existing.stripeRefundId !== args.stripeRefundId
  ) {
    patch.stripeRefundId = args.stripeRefundId;
  }
  if (
    args.stripeEventId !== undefined &&
    existing.stripeEventId !== args.stripeEventId
  ) {
    patch.stripeEventId = args.stripeEventId;
  }

  let connectedAccountId = args.connectedAccountId;
  if (
    connectedAccountId === undefined &&
    existing.connectedAccountId === undefined
  ) {
    const order = await db.get('ticket_orders', args.orderId);
    connectedAccountId = order?.connectedAccountId;
  }
  if (
    connectedAccountId !== undefined &&
    existing.connectedAccountId !== connectedAccountId
  ) {
    patch.connectedAccountId = connectedAccountId;
  }

  if (
    args.processorFeeCents !== undefined &&
    existing.processorFeeCents !== args.processorFeeCents
  ) {
    patch.processorFeeCents = args.processorFeeCents;
  }
  if (
    args.platformFeeCents !== undefined &&
    existing.platformFeeCents !== args.platformFeeCents
  ) {
    patch.platformFeeCents = args.platformFeeCents;
  }
  if (
    args.connectedAccountNetCents !== undefined &&
    existing.connectedAccountNetCents !== args.connectedAccountNetCents
  ) {
    patch.connectedAccountNetCents = args.connectedAccountNetCents;
  }
  if (args.note !== undefined && existing.note !== args.note) {
    patch.note = args.note;
  }

  if (Object.keys(patch).length > 0) {
    await db.patch('order_financial_events', existing._id, patch);
  }
}

async function findExistingStripeEventFinancialEvent(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    kind: Doc<'order_financial_events'>['kind'];
    stripeEventId: string;
  },
): Promise<Doc<'order_financial_events'> | null> {
  return await db
    .query('order_financial_events')
    .withIndex('by_order_and_kind_and_stripeEventId', (q) =>
      q
        .eq('orderId', args.orderId)
        .eq('kind', args.kind)
        .eq('stripeEventId', args.stripeEventId),
    )
    .first();
}

/**
 * Append a financial event for an order.
 *
 * Idempotency is layered:
 *
 * 1. The webhook transport layer (`stripe_webhook_events`) claims each
 *    Stripe event before any handler runs, so concurrent duplicate
 *    deliveries never both reach this function.
 * 2. When a caller supplies `stripeEventId`, this function dedups on
 *    `(orderId, kind, stripeEventId)` so any direct-callable path that
 *    forwards an event ID (e.g. manual replay, backfill) is idempotent
 *    on its own without relying on the claim row.
 * 3. `payment_captured`: one row per order. If a bare completion row
 *    already exists, later Stripe balance-transaction data enriches that row
 *    in place so payout math has the actual connected-account net.
 * 4. `dispute_opened` / `dispute_closed` with `stripeDisputeId`: skipped
 *    if a matching row already exists. Legacy call sites that predate
 *    `stripeEventId` propagation rely on this.
 * 5. `payment_refunded` with `stripeRefundId`: one row per refund id. A
 *    later webhook can enrich the app-created row with actual Stripe net.
 *    Partial refunds distinguish via `stripeRefundId`.
 * 6. All other kinds without a dedup key: the caller is responsible for
 *    idempotency (e.g. `prepareLateInvalidRefundState` uses
 *    `findExistingOrderFinancialEvent` before emitting
 *    `late_payment_after_release`).
 */
export async function appendFinancialEvent(
  db: MutationCtx['db'],
  args: {
    orderId: Id<'ticket_orders'>;
    eventId: Id<'events'>;
    kind: Doc<'order_financial_events'>['kind'];
    amountCents?: number;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    stripeRefundId?: string;
    stripeDisputeId?: string;
    stripeEventId?: string;
    /**
     * Connected account id snapshot for this row. Copied from
     * `ticket_orders.connectedAccountId` by default when the caller
     * omits it; set explicitly for platform-owned orders. Enables the
     * payout settlement loop to read all rows for one account in one
     * indexed query.
     */
    connectedAccountId?: string;
    /**
     * Actual Stripe processing fee in cents, copied from
     * `BalanceTransaction.fee_details` where `type === 'stripe_fee'`.
     * Populated on `payment_captured` / `payment_refunded` rows when the
     * caller has the balance transaction in hand.
     */
    processorFeeCents?: number;
    /**
     * Actual platform application fee in cents, copied from
     * `BalanceTransaction.fee_details` where `type === 'application_fee'`.
     */
    platformFeeCents?: number;
    /**
     * Net impact on the connected account's Stripe balance, copied from
     * `BalanceTransaction.net`. Source of truth for the settlement ledger
     * — no fee estimation required.
     */
    connectedAccountNetCents?: number;
    note?: string;
    occurredAt?: number;
  },
): Promise<void> {
  if (args.kind === 'payment_captured') {
    const existing = await findExistingOrderFinancialEvent(db, {
      orderId: args.orderId,
      kind: 'payment_captured',
    });
    if (existing) {
      await patchExistingMoneyMovementEvent(db, existing, args);
      return;
    }
  }

  if (args.stripeEventId) {
    const existingStripeEventEvent =
      await findExistingStripeEventFinancialEvent(db, {
        orderId: args.orderId,
        kind: args.kind,
        stripeEventId: args.stripeEventId,
      });
    if (existingStripeEventEvent) {
      return;
    }
  }

  if (
    (args.kind === 'dispute_opened' || args.kind === 'dispute_closed') &&
    args.stripeDisputeId
  ) {
    const existingDisputeEvent = await findExistingDisputeFinancialEvent(db, {
      orderId: args.orderId,
      kind: args.kind,
      stripeDisputeId: args.stripeDisputeId,
    });
    if (existingDisputeEvent) {
      return;
    }
  }

  if (args.kind === 'payment_refunded' && args.stripeRefundId) {
    const existingRefundEvent = await findExistingRefundFinancialEvent(db, {
      orderId: args.orderId,
      stripeRefundId: args.stripeRefundId,
    });
    if (existingRefundEvent) {
      if (hasSettlementFields(args)) {
        await patchExistingMoneyMovementEvent(db, existingRefundEvent, args);
      }
      return;
    }

    if (args.amountCents === undefined && hasSettlementFields(args)) {
      return;
    }
  }

  // If the caller didn't supply `connectedAccountId`, fall back to the
  // snapshot on the order row. Keeps old call sites working without
  // plumbing the field through every refund helper.
  let connectedAccountId = args.connectedAccountId;
  if (connectedAccountId === undefined) {
    const order = await db.get('ticket_orders', args.orderId);
    connectedAccountId = order?.connectedAccountId;
  }

  await db.insert('order_financial_events', {
    orderId: args.orderId,
    eventId: args.eventId,
    currency: DEFAULT_CURRENCY,
    kind: args.kind,
    amountCents: args.amountCents,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId,
    stripeRefundId: args.stripeRefundId,
    stripeDisputeId: args.stripeDisputeId,
    stripeEventId: args.stripeEventId,
    connectedAccountId,
    processorFeeCents: args.processorFeeCents,
    platformFeeCents: args.platformFeeCents,
    connectedAccountNetCents: args.connectedAccountNetCents,
    note: args.note,
    occurredAt: args.occurredAt ?? Date.now(),
  });
}
