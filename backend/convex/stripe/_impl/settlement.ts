'use node';

import type Stripe from 'stripe';
import type {ActionCtx} from '../../_generated/server';
import type {Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import {logger} from '../../lib/logger';

/**
 * Extract actual Stripe fee numbers from a Charge's expanded
 * BalanceTransaction and append a `payment_captured` ledger row.
 *
 * This is the SINGLE place that normalizes BalanceTransaction into our
 * ledger. Two settlement paths call it:
 *   1. `handleCheckoutSessionCompleted` (Connect webhook) — fresh charge,
 *      freshly expanded BalanceTransaction in the handler.
 *   2. `syncTicketOrderCheckoutSession` (buyer poll) — the same charge,
 *      retrieved through the direct-charge retrieve helper.
 *
 * Both paths MUST call this so `connectedAccountNetCents` is populated on
 * every `payment_captured` row. Without that field, the settlement ledger
 * in `stripe/_impl/payouts.ts` has zero net to pay out.
 */

type WebhookActionCtx = Pick<
  ActionCtx,
  'runAction' | 'runMutation' | 'runQuery'
>;

export interface RecordPaymentCapturedArgs {
  ctx: WebhookActionCtx;
  stripe: Stripe;
  orderId: Id<'ticket_orders'>;
  eventId: Id<'events'>;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  /** Connected account id for direct-charge orders; undefined for platform. */
  connectedAccountId: string | undefined;
  stripeEventId?: string;
}

export interface BalanceTransactionLedgerFields {
  amountCents: number;
  processorFeeCents: number;
  platformFeeCents: number;
  connectedAccountNetCents: number;
}

type ExpandableBalanceTransaction =
  | string
  | Stripe.BalanceTransaction
  | null
  | undefined;

export function resolveExpandedBalanceTransaction(
  balanceTransaction: ExpandableBalanceTransaction,
): Stripe.BalanceTransaction | null {
  if (!balanceTransaction || typeof balanceTransaction === 'string') {
    return null;
  }
  return balanceTransaction;
}

export function extractBalanceTransactionLedgerFields(
  balanceTransaction: Stripe.BalanceTransaction,
): BalanceTransactionLedgerFields {
  const feeDetails: ReadonlyArray<Stripe.BalanceTransaction.FeeDetail> =
    balanceTransaction.fee_details ?? [];
  const processorFeeCents =
    feeDetails.find((f) => f.type === 'stripe_fee')?.amount ?? 0;
  const platformFeeCents =
    feeDetails.find((f) => f.type === 'application_fee')?.amount ?? 0;

  return {
    amountCents: balanceTransaction.amount,
    processorFeeCents,
    platformFeeCents,
    connectedAccountNetCents: balanceTransaction.net,
  };
}

/**
 * Read the Charge's expanded BalanceTransaction and append a
 * `payment_captured` ledger row carrying actual fee + net data.
 *
 * Idempotent via `appendFinancialEvent`'s single-row-per-order guard on
 * `payment_captured`.
 */
export async function recordPaymentCaptured(
  args: RecordPaymentCapturedArgs,
): Promise<void> {
  const charge = await args.stripe.charges.retrieve(
    args.stripeChargeId,
    {expand: ['balance_transaction']},
    args.connectedAccountId
      ? {stripeAccount: args.connectedAccountId}
      : undefined,
  );

  const bt = resolveExpandedBalanceTransaction(charge.balance_transaction);
  if (!bt) {
    logger.warn('stripe', 'payment_captured missing balance_transaction', {
      orderId: args.orderId,
      chargeId: args.stripeChargeId,
    });
    throw new Error('Charge balance transaction is not available yet');
  }

  const ledgerFields = extractBalanceTransactionLedgerFields(bt);

  await args.ctx.runMutation(internal.orders.core.recordFinancialEvent, {
    orderId: args.orderId,
    eventId: args.eventId,
    kind: 'payment_captured',
    amountCents: ledgerFields.amountCents,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId,
    stripeEventId: args.stripeEventId,
    ...(args.connectedAccountId
      ? {connectedAccountId: args.connectedAccountId}
      : {}),
    processorFeeCents: ledgerFields.processorFeeCents,
    platformFeeCents: ledgerFields.platformFeeCents,
    connectedAccountNetCents: ledgerFields.connectedAccountNetCents,
  });
}
