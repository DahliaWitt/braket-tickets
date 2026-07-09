'use node';

import type Stripe from 'stripe';
import type {Id} from '../../_generated/dataModel';
import type {ActionCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {logger} from '../../lib/logger';
import {mapStripeDisputeStatus, summarizeStripeError} from '../../lib/stripe';
import {STRIPE_WEBHOOK_IN_FLIGHT_CODE} from '../../lib/stripe_webhook_errors';
import {throwAppError} from '../../lib/errors';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. See node_modules/@convex-dev/eslint-plugin no-import-use-node.js (checks target, not importer).
import {
  extractOrderIdFromCheckoutSession,
  extractOrderIdFromPaymentIntent,
  retrieveChargeIdForPaymentIntent,
} from '../../lib/stripe_node';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that.
import {
  extractBalanceTransactionLedgerFields,
  recordPaymentCaptured,
  resolveExpandedBalanceTransaction,
} from './settlement';
import type {WebhookFailureReason} from './webhook_claims';

/**
 * Stripe webhook dispatch.
 *
 * Single entry point (`dispatchStripeEvent`) fans out to per-event
 * handlers through a shared `withClaim` wrapper. The wrapper owns the
 * four-state claim lifecycle on `stripe_webhook_events`:
 *
 *   pending  ──(handler returns ok)────────────────▶ completed
 *   pending  ──(handler returns nonActionable)─────▶ failed (reason)
 *   pending  ──(handler throws)────────────────────▶ claimedAt=0 (retry)
 *   pending  ──(reaper, REAPER_FAILURE_TIMEOUT_MS)─▶ failed (stale_timeout)
 *
 * A claim that's already `completed` / `failed` short-circuits with `skip`.
 * A still-pending claim inside the `STALE_CLAIM_THRESHOLD_MS` window throws a
 * retryable error so the HTTP endpoint does not ACK a delivery that may still
 * need Stripe to retry if the original attempt crashes.
 *
 * Keeping dispatch in `stripe/_impl/` (rather than `stripe/actions.ts`)
 * lets us unit-test handlers in isolation and keeps the top-level action file
 * focused on Stripe account/checkout session orchestration.
 */

/**
 * Return shape for per-event handlers.
 *
 * - `orderId` — the ticket order the event touched, stamped on the claim
 *   row for ops forensics.
 * - `nonActionable` — the event is terminal-but-not-successful: we know
 *   we cannot process it (missing order metadata, no PaymentIntent linked
 *   to an order we own, etc.). `withClaim` finalizes `failed` with this
 *   reason. Retries are pointless because the condition cannot resolve
 *   server-side, and we don't want these to masquerade as `completed` in
 *   ops counts.
 */
type HandlerResult = {
  orderId?: Id<'ticket_orders'>;
  nonActionable?: WebhookFailureReason;
};

type OrderConnectedAccountValidation =
  | 'ok'
  | 'order_not_found'
  | 'account_mismatch';

type WebhookActionCtx = Pick<
  ActionCtx,
  'runAction' | 'runMutation' | 'runQuery' | 'scheduler'
>;

/**
 * Execute a webhook handler inside a claim/finalize envelope.
 *
 * Contract:
 * - Handler returns `{orderId?}` => claim transitions to `completed`.
 * - Handler returns `{nonActionable}` => claim transitions to `failed`
 *   with that failure reason. Use this when the event is well-formed but
 *   references something we cannot act on (e.g. an order id that isn't
 *   in our db). Retries are pointless — the condition is terminal.
 * - Claim returns `in_flight` => throw retryable ConvexError so Stripe does
 *   not ACK this delivery while another attempt is still processing.
 * - Handler throws => claim's `claimedAt` is zeroed so the next Stripe
 *   retry (often within seconds) reclaims immediately via the stale path.
 *   Without the release, the pending row would read as `in_flight` for
 *   `STALE_CLAIM_THRESHOLD_MS` and the retry would be a no-op.
 * - A truly stuck claim (handler crashes every retry) is eventually
 *   promoted to `failed (stale_timeout)` by `reapStaleStripeWebhookClaims`.
 */
async function withClaim(
  ctx: WebhookActionCtx,
  event: Pick<Stripe.Event, 'id' | 'type'>,
  handler: () => Promise<HandlerResult>,
): Promise<void> {
  const claim = await ctx.runMutation(
    internal.stripe.webhooks.claimStripeWebhookEvent,
    {
      stripeEventId: event.id,
      stripeEventType: event.type,
    },
  );

  if (claim.disposition === 'skip') {
    const logContext = {
      eventId: event.id,
      eventType: event.type,
      reason: claim.reason,
      existingClaimId: claim.existingClaimId,
    };

    if (claim.reason === 'in_flight') {
      logger.warn(
        'stripe',
        'Stripe webhook event is already in flight; asking Stripe to retry',
        logContext,
      );
      throwAppError(
        STRIPE_WEBHOOK_IN_FLIGHT_CODE,
        'Stripe webhook event is already being processed; retry delivery later.',
        {
          stripeEventId: event.id,
          stripeEventType: event.type,
          existingClaimId: claim.existingClaimId,
        },
      );
    }

    logger.info(
      'stripe',
      'skipping duplicate Stripe webhook event',
      logContext,
    );
    return;
  }

  if (claim.mode === 'reclaimed_stale') {
    logger.warn(
      'stripe',
      'reclaimed stale Stripe webhook claim; previous attempt likely crashed',
      {
        eventId: event.id,
        eventType: event.type,
        claimId: claim.claimId,
        attempts: claim.attempts,
      },
    );
  }

  let result: HandlerResult;
  try {
    result = await handler();
  } catch (err: unknown) {
    // Release the claim so Stripe's next retry reclaims immediately instead
    // of seeing `in_flight` and skipping. The release itself must not mask
    // the original error, so we log+swallow if releasing fails.
    try {
      await ctx.runMutation(
        internal.stripe.webhooks.releaseStripeWebhookClaim,
        {claimId: claim.claimId},
      );
    } catch (releaseErr: unknown) {
      logger.error(
        'stripe',
        'failed to release Stripe webhook claim for retry',
        summarizeStripeError(releaseErr),
        {eventId: event.id, eventType: event.type, claimId: claim.claimId},
      );
    }

    logger.error(
      'stripe',
      'webhook handler threw; claim released for Stripe retry',
      summarizeStripeError(err),
      {
        eventId: event.id,
        eventType: event.type,
        claimId: claim.claimId,
        attempts: claim.attempts,
      },
    );
    throw err;
  }

  if (result.nonActionable) {
    logger.warn(
      'stripe',
      'webhook event non-actionable; finalizing as failed',
      {
        eventId: event.id,
        eventType: event.type,
        claimId: claim.claimId,
        reason: result.nonActionable,
        orderId: result.orderId,
      },
    );
    await ctx.runMutation(internal.stripe.webhooks.finalizeStripeWebhookEvent, {
      claimId: claim.claimId,
      outcome: 'failed',
      failureReason: result.nonActionable,
      orderId: result.orderId,
    });
    return;
  }

  await ctx.runMutation(internal.stripe.webhooks.finalizeStripeWebhookEvent, {
    claimId: claim.claimId,
    outcome: 'completed',
    orderId: result.orderId,
  });
}

/**
 * Validate a raw order-id candidate string as a real `ticket_orders` id.
 *
 * Node runtime has no `ctx.db.normalizeId`, so we bounce the string into
 * a Convex-runtime query. Returns `null` for values that aren't
 * well-formed ids — callers should treat that as "no matching order" and
 * return an empty HandlerResult so the claim still completes.
 */
async function normalizeOrderId(
  ctx: WebhookActionCtx,
  candidate: string | null,
): Promise<Id<'ticket_orders'> | null> {
  if (!candidate) return null;
  return await ctx.runQuery(internal.orders.core.normalizeTicketOrderId, {
    candidate,
  });
}

async function validateOrderConnectedAccount(
  ctx: WebhookActionCtx,
  orderId: Id<'ticket_orders'>,
  connectedAccountId?: string,
): Promise<OrderConnectedAccountValidation> {
  if (!connectedAccountId) return 'ok';

  const order = await ctx.runQuery(internal.orders.core.getInternal, {orderId});
  if (!order) return 'order_not_found';
  return order.connectedAccountId === connectedAccountId
    ? 'ok'
    : 'account_mismatch';
}

async function handleAccountUpdated(
  ctx: WebhookActionCtx,
  event: Stripe.AccountUpdatedEvent,
  connectedAccountId?: string,
): Promise<HandlerResult> {
  // Only treat this as a Connect state-refresh signal when dispatched from the
  // Connect webhook (i.e., `event.account` is set). Platform account.updated
  // events have no matching organizer row.
  if (!connectedAccountId) return {};
  if (event.data.object.id !== connectedAccountId) return {};
  await ctx.runAction(internal.stripe.actions.refreshConnectedAccountStatus, {
    stripeConnectedAccountId: event.data.object.id,
  });
  return {};
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------
//
// Each handler is pure-ish: it takes the narrowed Stripe event (and stripe
// client when it needs to call the API) and performs the Convex side
// effects. It returns the `orderId` it touched so `withClaim` can stamp
// that on the claim row for ops forensics. Handlers DO NOT touch the
// `stripe_webhook_events` table directly — that's exclusively `withClaim`'s
// responsibility.
//
// Ledger writes include `stripeEventId` so `appendFinancialEvent` (see
// `lib/orders/financial_events.ts`) can dedup even if a future code path
// somehow calls the settlement mutation twice for the same event. That's
// the defense-in-depth layer behind the claim row.
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(
  ctx: WebhookActionCtx,
  event: Stripe.CheckoutSessionCompletedEvent,
  stripe: Stripe,
  /**
   * Connected account id forwarded from the Connect webhook dispatcher.
   * Required for direct-charge sessions — the PI lives on the connected
   * account, so retrieving without `{stripeAccount}` returns 404.
   */
  connectedAccountId?: string,
): Promise<HandlerResult> {
  const session = event.data.object;
  const orderId = await normalizeOrderId(
    ctx,
    extractOrderIdFromCheckoutSession(session),
  );
  if (!orderId) {
    logger.warn('stripe', 'checkout.session.completed missing orderId');
    return {nonActionable: 'order_not_found'};
  }

  if (session.payment_status !== 'paid') {
    logger.warn(
      'stripe',
      'checkout.session.completed received unpaid session',
      {
        orderId,
        paymentStatus: session.payment_status,
      },
    );
    return {orderId};
  }

  const connectedAccountValidation = await validateOrderConnectedAccount(
    ctx,
    orderId,
    connectedAccountId,
  );
  if (connectedAccountValidation !== 'ok') {
    logger.warn(
      'stripe',
      `checkout.session.completed validation failed: ${connectedAccountValidation}`,
      {
        orderId,
        connectedAccountId,
      },
    );
    return {orderId, nonActionable: 'order_not_found'};
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  const stripeChargeId = paymentIntentId
    ? await retrieveChargeIdForPaymentIntent(
        stripe,
        paymentIntentId,
        connectedAccountId,
      )
    : undefined;

  await ctx.runAction(internal.orders.core.settlePaidOrderFromStripe, {
    orderId,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId,
    stripeEventId: event.id,
    note: 'checkout.session.completed',
  });

  // Post-settlement: record the actual BalanceTransaction for ledger math.
  // The settlement action above may refund-and-release (e.g. late invalid)
  // in which case there's no captured charge to record. We only pull the
  // balance transaction when Stripe actually exposed both a PI and charge.
  if (paymentIntentId && stripeChargeId) {
    const order = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId,
    });
    if (order && order.state === 'completed') {
      await recordPaymentCaptured({
        ctx,
        stripe,
        orderId,
        eventId: order.eventId,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId,
        connectedAccountId,
        stripeEventId: event.id,
      });
    }
  }
  return {orderId};
}

async function handleCheckoutSessionExpired(
  ctx: WebhookActionCtx,
  event: Stripe.CheckoutSessionExpiredEvent,
  connectedAccountId?: string,
): Promise<HandlerResult> {
  const session = event.data.object;
  const orderId = await normalizeOrderId(
    ctx,
    extractOrderIdFromCheckoutSession(session),
  );
  if (!orderId) {
    logger.warn('stripe', 'checkout.session.expired missing orderId');
    return {nonActionable: 'order_not_found'};
  }

  const connectedAccountValidation = await validateOrderConnectedAccount(
    ctx,
    orderId,
    connectedAccountId,
  );
  if (connectedAccountValidation !== 'ok') {
    logger.warn(
      'stripe',
      `checkout.session.expired validation failed: ${connectedAccountValidation}`,
      {
        orderId,
        connectedAccountId,
      },
    );
    return {orderId, nonActionable: 'order_not_found'};
  }

  await ctx.runMutation(internal.orders.core.expire, {orderId, force: true});
  return {orderId};
}

async function handlePaymentIntentSucceeded(
  ctx: WebhookActionCtx,
  event: Stripe.PaymentIntentSucceededEvent,
  _stripe: Stripe,
  _connectedAccountId?: string,
): Promise<HandlerResult> {
  // DESIGN: `checkout.session.completed` is the canonical settlement
  // event. `payment_intent.succeeded` arrives from the same Stripe flow
  // and carries no unique information we need; settling on both would
  // require cross-event idempotency beyond the per-event claim.
  //
  // Log-only is safe because all currently enabled payment methods
  // (card, Apple Pay, Google Pay, Link) settle synchronously — the PI
  // succeeds atomically with the Checkout Session. Async payment
  // methods (ACH, SEPA, Boleto, OXXO) are disabled in the Stripe
  // Dashboard. If any async method is enabled, add
  // `checkout.session.async_payment_succeeded` / `.failed` handlers
  // BEFORE enabling it — leaving this log-only under async would
  // strand paid orders.
  const pi = event.data.object;
  const orderId = await normalizeOrderId(
    ctx,
    extractOrderIdFromPaymentIntent(pi),
  );
  if (!orderId) {
    logger.info('stripe', 'payment_intent.succeeded (log-only)', {
      paymentIntentId: pi.id,
      observation: 'no orderId in metadata',
    });
    return {};
  }
  logger.info('stripe', 'payment_intent.succeeded (log-only)', {
    orderId,
    paymentIntentId: pi.id,
  });
  return {orderId};
}

async function handlePaymentIntentPaymentFailed(
  ctx: WebhookActionCtx,
  event: Stripe.PaymentIntentPaymentFailedEvent,
  connectedAccountId?: string,
): Promise<HandlerResult> {
  const pi = event.data.object;
  const orderId = await normalizeOrderId(
    ctx,
    extractOrderIdFromPaymentIntent(pi),
  );
  if (!orderId) {
    logger.warn('stripe', 'payment_intent.payment_failed missing orderId', {
      paymentIntentId: pi.id,
    });
    return {nonActionable: 'order_not_found'};
  }

  const connectedAccountValidation = await validateOrderConnectedAccount(
    ctx,
    orderId,
    connectedAccountId,
  );
  if (connectedAccountValidation !== 'ok') {
    logger.warn(
      'stripe',
      `payment_intent.payment_failed validation failed: ${connectedAccountValidation}`,
      {
        orderId,
        paymentIntentId: pi.id,
        connectedAccountId,
      },
    );
    return {orderId, nonActionable: 'order_not_found'};
  }

  const lastPaymentErrorType = pi.last_payment_error?.type;
  if (lastPaymentErrorType && lastPaymentErrorType !== 'card_error') {
    await ctx.runMutation(internal.orders.core.releaseForPaymentFailure, {
      orderId,
      errorCode: pi.last_payment_error?.code ?? 'payment_failed',
      failureStage: 'payment_intent',
    });
    logger.warn(
      'stripe',
      'payment_intent.payment_failed released order for non-card failure',
      {
        orderId,
        paymentIntentId: pi.id,
        errorType: lastPaymentErrorType,
        errorCode: pi.last_payment_error?.code,
      },
    );
    return {orderId};
  }

  logger.info('stripe', 'payment_intent.payment_failed (card retry allowed)', {
    orderId,
    paymentIntentId: pi.id,
    errorType: lastPaymentErrorType,
    errorCode: pi.last_payment_error?.code,
  });
  return {orderId};
}

async function handleChargeDisputeCreated(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeDisputeCreatedEvent,
): Promise<HandlerResult> {
  const dispute = event.data.object;
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) {
    logger.warn('stripe', 'charge.dispute.created missing payment_intent');
    return {nonActionable: 'order_not_found'};
  }

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) {
    logger.warn('stripe', 'charge.dispute.created: no matching order for PI', {
      piId,
    });
    return {nonActionable: 'order_not_found'};
  }

  await ctx.runMutation(internal.orders.core.recordFinancialEvent, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'dispute_opened',
    amountCents: dispute.amount,
    stripePaymentIntentId: piId,
    stripeChargeId: order.stripeChargeId,
    stripeDisputeId: dispute.id,
    stripeEventId: event.id,
    note: dispute.reason ?? undefined,
  });
  return {orderId: order._id};
}

async function handleChargeDisputeClosed(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeDisputeClosedEvent,
): Promise<HandlerResult> {
  const dispute = event.data.object;
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) {
    logger.warn('stripe', 'charge.dispute.closed missing payment_intent');
    return {nonActionable: 'order_not_found'};
  }

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) {
    logger.warn('stripe', 'charge.dispute.closed: no matching order for PI', {
      piId,
    });
    return {nonActionable: 'order_not_found'};
  }

  const resolution = mapStripeDisputeStatus(dispute.status);
  await ctx.runMutation(internal.orders.core.recordFinancialEvent, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'dispute_closed',
    stripePaymentIntentId: piId,
    stripeChargeId: order.stripeChargeId,
    stripeDisputeId: dispute.id,
    stripeEventId: event.id,
    note: resolution,
  });
  return {orderId: order._id};
}

async function handleChargeRefunded(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeRefundedEvent,
  stripe: Stripe,
  /**
   * Connected account id from the Connect webhook. Refund balance
   * transactions also live on the connected account for direct charges.
   */
  connectedAccountId?: string,
): Promise<HandlerResult> {
  const charge = event.data.object;
  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) {
    logger.warn('stripe', 'charge.refunded missing payment_intent');
    return {nonActionable: 'order_not_found'};
  }

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) {
    logger.warn('stripe', 'charge.refunded: no matching order for PI', {
      piId,
    });
    return {nonActionable: 'order_not_found'};
  }

  // `charge.amount_refunded` is the cumulative refunded total used to bring
  // ticket/order state up to date. The ledger row must use the individual
  // refund object's amount because Stripe webhook delivery is not an ordering
  // guarantee: a later partial refund can arrive before an earlier one.
  const refundedAmountCents = charge.amount_refunded ?? charge.amount;
  const latestRefund = charge.refunds?.data[0];
  if (!latestRefund) {
    logger.warn('stripe', 'charge.refunded missing refund object', {
      chargeId: charge.id,
    });
    throw new Error('Charge refund event is missing refund details');
  }
  const ledgerFields = await retrieveRefundLedgerFields(
    stripe,
    latestRefund.id,
    connectedAccountId,
  );

  await ctx.runMutation(internal.orders.core.applyExternalRefund, {
    orderId: order._id,
    refundedAmountCents,
    stripeRefundId: latestRefund.id,
    ledgerRefundAmountCents: latestRefund.amount,
    stripeEventId: event.id,
    ...ledgerFields,
  });
  return {orderId: order._id};
}

async function retrieveRefundLedgerFields(
  stripe: Stripe,
  stripeRefundId: string,
  connectedAccountId?: string,
): Promise<{
  processorFeeCents: number;
  platformFeeCents: number;
  connectedAccountNetCents: number;
}> {
  const refund = await stripe.refunds.retrieve(
    stripeRefundId,
    {expand: ['balance_transaction']},
    connectedAccountId ? {stripeAccount: connectedAccountId} : undefined,
  );
  const balanceTransaction = resolveExpandedBalanceTransaction(
    refund.balance_transaction,
  );
  if (!balanceTransaction) {
    logger.warn('stripe', 'refund missing balance_transaction', {
      stripeRefundId,
    });
    throw new Error('Refund balance transaction is not available yet');
  }

  const ledgerFields =
    extractBalanceTransactionLedgerFields(balanceTransaction);
  return {
    processorFeeCents: ledgerFields.processorFeeCents,
    platformFeeCents: ledgerFields.platformFeeCents,
    connectedAccountNetCents: ledgerFields.connectedAccountNetCents,
  };
}

async function handleChargeDisputeUpdated(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeDisputeUpdatedEvent,
): Promise<HandlerResult> {
  const dispute = event.data.object;
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) return {nonActionable: 'order_not_found'};

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) return {nonActionable: 'order_not_found'};

  // Status-only event — Stripe updated the dispute (new evidence uploaded,
  // status transitioned inside `needs_response` / `under_review`, etc.).
  // No money movement, so no ledger row beyond the existing dispute_opened.
  // Logged so ops can reconstruct the dispute timeline from
  // stripe_webhook_events.
  logger.info('stripe', 'charge.dispute.updated', {
    orderId: order._id,
    stripeDisputeId: dispute.id,
    status: dispute.status,
  });
  return {orderId: order._id};
}

async function recordDisputeFundsMovement(
  ctx: WebhookActionCtx,
  event: Stripe.Event,
  dispute: Stripe.Dispute,
  kind: 'dispute_funds_withdrawn' | 'dispute_funds_reinstated',
  connectedAccountId: string | undefined,
): Promise<HandlerResult> {
  const piId =
    typeof dispute.payment_intent === 'string'
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!piId) return {nonActionable: 'order_not_found'};

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) return {nonActionable: 'order_not_found'};

  // `dispute_funds_withdrawn`: connected account debited. Net is negative.
  // `dispute_funds_reinstated`: connected account credited back. Net is
  // positive. We record the dispute amount signed accordingly so the
  // settlement ledger (Task 7) sums them into `disputeNet` without extra
  // branching. Stripe does not always surface BalanceTransactions for
  // dispute debits in the snapshot payload, so we rely on the dispute
  // amount as the authoritative money-moved figure.
  const signedAmount =
    kind === 'dispute_funds_withdrawn' ? -dispute.amount : dispute.amount;

  await ctx.runMutation(internal.orders.core.recordFinancialEvent, {
    orderId: order._id,
    eventId: order.eventId,
    kind,
    amountCents: signedAmount,
    stripePaymentIntentId: piId,
    stripeChargeId: order.stripeChargeId,
    stripeDisputeId: dispute.id,
    stripeEventId: event.id,
    ...(connectedAccountId ? {connectedAccountId} : {}),
    connectedAccountNetCents: signedAmount,
    note: dispute.status,
  });
  return {orderId: order._id};
}

async function handleChargeDisputeFundsWithdrawn(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeDisputeFundsWithdrawnEvent,
  connectedAccountId?: string,
): Promise<HandlerResult> {
  return recordDisputeFundsMovement(
    ctx,
    event,
    event.data.object,
    'dispute_funds_withdrawn',
    connectedAccountId,
  );
}

async function handleChargeDisputeFundsReinstated(
  ctx: WebhookActionCtx,
  event: Stripe.ChargeDisputeFundsReinstatedEvent,
  connectedAccountId?: string,
): Promise<HandlerResult> {
  return recordDisputeFundsMovement(
    ctx,
    event,
    event.data.object,
    'dispute_funds_reinstated',
    connectedAccountId,
  );
}

async function handlePayoutPaid(
  ctx: WebhookActionCtx,
  event: Stripe.PayoutPaidEvent,
  connectedAccountId: string | undefined,
): Promise<HandlerResult> {
  const payout = event.data.object;
  const metadataBatchId = payout.metadata?.['braketBatchId'];
  await ctx.runMutation(internal.stripe.connect.confirmPayout, {
    stripePayoutId: payout.id,
    ...(typeof payout.amount === 'number' ? {amountCents: payout.amount} : {}),
    ...(typeof payout.currency === 'string' ? {currency: payout.currency} : {}),
    ...(metadataBatchId !== undefined ? {metadataBatchId} : {}),
    ...(connectedAccountId !== undefined ? {connectedAccountId} : {}),
  });
  return {};
}

async function handlePayoutFailed(
  ctx: WebhookActionCtx,
  event: Stripe.PayoutFailedEvent,
  connectedAccountId: string | undefined,
): Promise<HandlerResult> {
  const payout = event.data.object;
  const metadataBatchId = payout.metadata?.['braketBatchId'];
  await ctx.runMutation(internal.stripe.connect.failPayout, {
    stripePayoutId: payout.id,
    failureReason: payout.failure_message ?? payout.failure_code ?? undefined,
    ...(metadataBatchId !== undefined ? {metadataBatchId} : {}),
    ...(connectedAccountId !== undefined ? {connectedAccountId} : {}),
  });
  return {};
}

async function handleApplicationFeeCreated(
  ctx: WebhookActionCtx,
  event: Stripe.ApplicationFeeCreatedEvent,
): Promise<HandlerResult> {
  const fee = event.data.object;
  const piId =
    typeof fee.originating_transaction === 'string'
      ? fee.originating_transaction
      : undefined;

  if (!piId) {
    logger.info('stripe', 'application_fee.created without originating PI', {
      applicationFeeId: fee.id,
    });
    return {};
  }

  const order = await ctx.runQuery(
    internal.stripe.connect.getOrderByStripePaymentIntentId,
    {stripePaymentIntentId: piId},
  );
  if (!order) {
    // Not every application_fee traces back to one of our orders — Stripe
    // emits these for any charge on the platform account. Log and move on
    // so the reconciliation job (spec Section 15, deferred) can still
    // cross-check later.
    logger.info('stripe', 'application_fee.created unrelated to our orders', {
      applicationFeeId: fee.id,
      piId,
    });
    return {};
  }

  logger.info('stripe', 'application_fee.created', {
    orderId: order._id,
    applicationFeeId: fee.id,
    amountCents: fee.amount,
  });
  return {orderId: order._id};
}

async function handleLogOnlyEvent(event: Stripe.Event): Promise<HandlerResult> {
  // balance.available, person.updated, capability.updated,
  // account.external_account.updated — observability only. The authoritative
  // state refresh path is `checkAccountStatus` / the V2 event destination.
  logger.info('stripe', `log-only webhook ${event.type}`, {eventId: event.id});
  return {};
}

/**
 * Swallow a Stripe event we don't have a handler for.
 *
 * We still wrap it in a claim so every observed event gets a row — ops
 * can audit "did Stripe ever send us X?" from `stripe_webhook_events`
 * alone instead of grepping logs. The handler is a no-op, which means
 * the claim finalizes `completed` on first delivery and all retries
 * short-circuit as `already_completed`.
 */
async function handleUnhandledEventType(
  event: Pick<Stripe.Event, 'id' | 'type'>,
): Promise<HandlerResult> {
  logger.info('stripe', `Unhandled Stripe event type: ${event.type}`, {
    eventId: event.id,
  });
  return {};
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Route a verified Stripe event to its handler inside a claim envelope.
 *
 * Callers:
 * - `stripe/actions.verifyAndProcessWebhook` — platform account webhook.
 *   `connectedAccountId` is undefined; events refer to platform-owned
 *   objects.
 * - `stripe/actions.verifyAndProcessConnectWebhook` — Connect snapshot
 *   webhook. The payload's `event.account` is passed as
 *   `connectedAccountId` so handlers can thread `{stripeAccount}` on
 *   every Stripe SDK call that retrieves connected-account objects
 *   (Charges, BalanceTransactions, PaymentIntents).
 *
 * Both callers own signature verification; this function assumes `event`
 * is trusted. Unhandled event types still land in `stripe_webhook_events`
 * via `handleUnhandledEventType` so ops has a complete audit trail.
 */
export async function dispatchStripeEvent(
  ctx: WebhookActionCtx,
  event: Stripe.Event,
  stripe: Stripe,
  /**
   * Connected account id sourced from the Connect webhook's top-level
   * `event.account` field. Absent for platform-account webhook events.
   * Handlers that need to read connected-account objects must pass
   * `{stripeAccount: connectedAccountId}` on their Stripe SDK calls.
   */
  connectedAccountId?: string,
): Promise<void> {
  switch (event.type) {
    case 'account.updated':
      await withClaim(ctx, event, () =>
        handleAccountUpdated(ctx, event, connectedAccountId),
      );
      return;

    case 'checkout.session.completed':
      await withClaim(ctx, event, () =>
        handleCheckoutSessionCompleted(ctx, event, stripe, connectedAccountId),
      );
      return;

    case 'checkout.session.expired':
      await withClaim(ctx, event, () =>
        handleCheckoutSessionExpired(ctx, event, connectedAccountId),
      );
      return;

    case 'payment_intent.succeeded':
      await withClaim(ctx, event, () =>
        handlePaymentIntentSucceeded(ctx, event, stripe, connectedAccountId),
      );
      return;

    case 'payment_intent.payment_failed':
      await withClaim(ctx, event, () =>
        handlePaymentIntentPaymentFailed(ctx, event, connectedAccountId),
      );
      return;

    case 'charge.dispute.created':
      await withClaim(ctx, event, () => handleChargeDisputeCreated(ctx, event));
      return;

    case 'charge.dispute.closed':
      await withClaim(ctx, event, () => handleChargeDisputeClosed(ctx, event));
      return;

    case 'charge.dispute.updated':
      await withClaim(ctx, event, () => handleChargeDisputeUpdated(ctx, event));
      return;

    case 'charge.dispute.funds_withdrawn':
      await withClaim(ctx, event, () =>
        handleChargeDisputeFundsWithdrawn(ctx, event, connectedAccountId),
      );
      return;

    case 'charge.dispute.funds_reinstated':
      await withClaim(ctx, event, () =>
        handleChargeDisputeFundsReinstated(ctx, event, connectedAccountId),
      );
      return;

    case 'charge.refunded':
      await withClaim(ctx, event, () =>
        handleChargeRefunded(ctx, event, stripe, connectedAccountId),
      );
      return;

    case 'payout.paid':
      await withClaim(ctx, event, () =>
        handlePayoutPaid(ctx, event, connectedAccountId),
      );
      return;

    case 'payout.failed':
      await withClaim(ctx, event, () =>
        handlePayoutFailed(ctx, event, connectedAccountId),
      );
      return;

    case 'balance.available':
    case 'person.updated':
    case 'capability.updated':
    case 'account.external_account.updated':
      // Log-only observability — we surface the state via
      // `updateOrganizerFromStripeAccount` on the next `checkAccountStatus`
      // call or via the V2 event destination. Claiming here still gives
      // ops a complete audit trail of delivered webhooks.
      await withClaim(ctx, event, () => handleLogOnlyEvent(event));
      return;

    case 'application_fee.created':
      await withClaim(ctx, event, () =>
        handleApplicationFeeCreated(ctx, event),
      );
      return;

    default:
      await withClaim(ctx, event, () => handleUnhandledEventType(event));
      return;
  }
}
