import type {Doc, Id} from '../../_generated/dataModel';
import type {ActionCtx, MutationCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {isTestEnvironment, isUnitTestRuntime} from '../../lib/environment';
import {
  ErrorMessages,
  getAppErrorMessage,
  throwInvalidState,
  throwNotFound,
} from '../../lib/errors';
import {logger} from '../../lib/logger';
import {scheduleBroadcastCatchup} from '../../lib/broadcast_catchup';
import {enqueueTicketEmailDelivery} from '../../lib/email_delivery_wrapper';
import {stripePool} from '../../lib/resilience';
import {buildTicketRosterProjection} from '../../lib/ticket_roster_projection';
import {executeStoredProcessorRefund} from '../payments/refund_processing';
import {generateStripeIdempotencyKey} from '../payments/refunds';
import {appendFinancialEvent} from '../orders/financial_events';
import {loadOrderFinancial} from '../orders/financial_reporting';
import {calculateResaleSellerSettlement} from './helpers';
import {removeBuyerResaleNotificationSubscription} from './notifications';
import {
  assertValidListingTransition,
  isPendingResaleListingStatus,
  buildCompletionPatch,
  buildSellerRefundPendingPatch,
  buildSellerRefundResolvedPatch,
  type SellerRefundListingPatch,
} from '../../lib/resale_listing_transitions';

type ResaleSettlementMutationCtx = Pick<
  MutationCtx,
  'db' | 'runMutation' | 'runQuery' | 'scheduler'
>;

type MarkSellerOrderRefundedArgs = {
  orderId: Id<'ticket_orders'>;
  refundedAmountCents: number;
  lostProcessingFeeCents: number;
  /**
   * Required: `appendFinancialEvent` dedups `payment_refunded` rows on
   * (orderId, stripeRefundId); without it a retried completion would
   * double-insert the refund.
   */
  stripeRefundId: string;
  processorFeeCents?: number;
  platformFeeCents?: number;
  /**
   * Net impact on the seller's connected-account balance from the refund's
   * BalanceTransaction. Without it the settlement ledger skips this row and
   * the payout trust gate reads the account as diverged.
   */
  connectedAccountNetCents?: number;
};

type ProcessSellerRefundArgs = {
  sellerOrderId: Id<'ticket_orders'>;
  sellerOrderStripePaymentIntentId?: string;
  listingId: Id<'resale_listings'>;
  eventId: Id<'events'>;
  refundAmountCents: number;
  lostProcessingFeeCents: number;
  idempotencyKey: string;
};

export type SellerRefundResult = {
  stripeRefundId: string;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
};

export type SellerRefundWorkContext = ProcessSellerRefundArgs & {
  retryCount: number;
};

type SellerRefundCompletionArgs = {
  context: SellerRefundWorkContext;
  result:
    | {kind: 'success'; returnValue: SellerRefundResult}
    | {kind: 'failed'; error: string}
    | {kind: 'canceled'};
};

type FinalizeResaleArgs = {
  orderId: Id<'ticket_orders'>;
  /** Injectable wall-clock for deterministic tests / aligned caller timestamps. */
  now?: number;
};

const SELLER_REFUND_RETRY_BASE_DELAY_MS = 1_000;
const SELLER_REFUND_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;

function buildSellerRefundActionArgs(
  context: SellerRefundWorkContext,
): ProcessSellerRefundArgs {
  const {retryCount: _retryCount, ...actionArgs} = context;
  return actionArgs;
}

function getSellerRefundRetryDelayMs(retryCount: number): number {
  return Math.min(
    SELLER_REFUND_RETRY_MAX_DELAY_MS,
    SELLER_REFUND_RETRY_BASE_DELAY_MS * Math.pow(2, retryCount),
  );
}

export async function enqueueSellerRefund(
  ctx: Pick<MutationCtx, 'runMutation' | 'runQuery'>,
  context: SellerRefundWorkContext,
  runAfterMs?: number,
): Promise<void> {
  await stripePool.enqueueAction(
    ctx,
    internal.resale.listings.processSellerRefund,
    buildSellerRefundActionArgs(context),
    {
      retry: false,
      onComplete: internal.resale.listings.onSellerRefundComplete,
      context,
      ...(runAfterMs === undefined ? {} : {runAfter: runAfterMs}),
    },
  );
}

export async function markSellerOrderRefundedState(
  ctx: ResaleSettlementMutationCtx,
  args: MarkSellerOrderRefundedArgs,
): Promise<null> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) throwNotFound('Order');

  if (order.state !== 'completed') {
    logger.error(
      'resale',
      `markSellerOrderRefunded: order ${args.orderId} has state ${order.state}, cannot mark refunded`,
    );
    throwInvalidState(ErrorMessages.INVALID_STATE('order cannot be refunded'));
  }

  // `appendFinancialEvent` dedups on (orderId, stripeRefundId) and lets a
  // later `charge.refunded` webhook enrich the row in place — the raw insert
  // this replaces produced rows the payout settlement could never see.
  // `connectedAccountId` is passed from the already-loaded order so the
  // helper skips its fallback read.
  await appendFinancialEvent(ctx.db, {
    orderId: order._id,
    eventId: order.eventId,
    kind: 'payment_refunded',
    amountCents: args.refundedAmountCents,
    stripePaymentIntentId: order.stripePaymentIntentId,
    stripeChargeId: order.stripeChargeId,
    stripeRefundId: args.stripeRefundId,
    connectedAccountId: order.connectedAccountId,
    processorFeeCents: args.processorFeeCents,
    platformFeeCents: args.platformFeeCents,
    connectedAccountNetCents: args.connectedAccountNetCents,
    note: `resale_seller_refund_lost_fee:${args.lostProcessingFeeCents}`,
  });

  return null;
}

export async function processSellerRefundState(
  ctx: ActionCtx,
  args: ProcessSellerRefundArgs,
): Promise<SellerRefundResult> {
  if (!args.sellerOrderStripePaymentIntentId) {
    logger.error(
      'resale',
      `processSellerRefund: order ${args.sellerOrderId} has no Stripe payment intent`,
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE('seller order cannot be refunded'),
    );
  }

  // Seller refunds target the SELLER's original `ticket_orders` row so
  // the refund lands on the seller's connected account, not the buyer's.
  // `executeStoredProcessorRefund` resolves the connected account from
  // that order's snapshotted `connectedAccountId`.
  const stripeRefund = await executeStoredProcessorRefund(ctx, {
    stripePaymentIntentId: args.sellerOrderStripePaymentIntentId,
    stripeIdempotencyKey: args.idempotencyKey,
    orderId: args.sellerOrderId,
    amountCents: args.refundAmountCents,
    reason: 'Resale seller refund',
    loggerScope: 'resale',
    failureLogLabel: 'Stripe seller refund failed:',
    failureMessage: ErrorMessages.SERVER_ERROR,
  });

  return {
    stripeRefundId: stripeRefund.refundId,
    ...(stripeRefund.processorFeeCents !== undefined
      ? {processorFeeCents: stripeRefund.processorFeeCents}
      : {}),
    ...(stripeRefund.platformFeeCents !== undefined
      ? {platformFeeCents: stripeRefund.platformFeeCents}
      : {}),
    ...(stripeRefund.connectedAccountNetCents !== undefined
      ? {connectedAccountNetCents: stripeRefund.connectedAccountNetCents}
      : {}),
  };
}

export async function handleSellerRefundCompletionState(
  ctx: ResaleSettlementMutationCtx,
  args: SellerRefundCompletionArgs,
): Promise<null> {
  const listing = await ctx.db.get('resale_listings', args.context.listingId);
  if (!listing) {
    logger.error(
      'resale',
      `handleSellerRefundCompletion: listing ${args.context.listingId} not found`,
    );
    return null;
  }

  if (listing.sellerRefundState === 'completed') {
    return null;
  }

  if ((listing.sellerRefundAttempts ?? 0) !== args.context.retryCount) {
    return null;
  }

  if (args.result.kind === 'success') {
    await markSellerOrderRefundedState(ctx, {
      orderId: args.context.sellerOrderId,
      refundedAmountCents: args.context.refundAmountCents,
      lostProcessingFeeCents: args.context.lostProcessingFeeCents,
      stripeRefundId: args.result.returnValue.stripeRefundId,
      processorFeeCents: args.result.returnValue.processorFeeCents,
      platformFeeCents: args.result.returnValue.platformFeeCents,
      connectedAccountNetCents:
        args.result.returnValue.connectedAccountNetCents,
    });

    await ctx.db.patch('resale_listings', listing._id, {
      sellerRefundState: 'completed',
      sellerRefundAttempts: args.context.retryCount + 1,
      sellerRefundCompletedAt: Date.now(),
      sellerRefundFailedAt: null,
      sellerRefundNextRetryAt: null,
      sellerRefundLastError: null,
    });
    return null;
  }

  const errorMessage =
    args.result.kind === 'failed'
      ? args.result.error
      : 'Seller refund work item was canceled before completion';
  const delayMs = getSellerRefundRetryDelayMs(args.context.retryCount);
  const nextRetryAt = Date.now() + delayMs;
  const nextContext: SellerRefundWorkContext = {
    ...args.context,
    retryCount: args.context.retryCount + 1,
  };

  await ctx.db.patch('resale_listings', listing._id, {
    sellerRefundState: 'retrying',
    sellerRefundAttempts: args.context.retryCount + 1,
    sellerRefundFailedAt: Date.now(),
    sellerRefundNextRetryAt: nextRetryAt,
    sellerRefundLastError: errorMessage,
  });

  logger.error(
    'resale',
    `Seller refund failed for listing ${listing._id}; re-enqueueing in ${delayMs}ms`,
    errorMessage,
  );

  try {
    await enqueueSellerRefund(ctx, nextContext, delayMs);
  } catch (error) {
    const enqueueError = getAppErrorMessage(error) ?? String(error);
    const combinedError = `${errorMessage} Retry enqueue failed: ${enqueueError}`;

    await ctx.db.patch('resale_listings', listing._id, {
      sellerRefundState: 'failed',
      sellerRefundNextRetryAt: null,
      sellerRefundLastError: combinedError,
    });

    logger.error(
      'resale',
      `Seller refund retry enqueue failed for listing ${listing._id}`,
      enqueueError,
    );
  }
  return null;
}

async function enqueueTicketDeliveryEmail(
  ctx: ResaleSettlementMutationCtx,
  order: Doc<'ticket_orders'>,
): Promise<void> {
  let recipientEmail = '';
  if (order.userId) {
    const owner = await ctx.db.get('users', order.userId);
    recipientEmail = owner?.email ?? '';
  } else if (order.guestSessionId) {
    const guest = await ctx.db.get('guest_sessions', order.guestSessionId);
    recipientEmail = guest?.email ?? '';
  }

  if (!recipientEmail) {
    // Enqueuing with an empty `recipient` hides the problem inside the
    // email action — the delivery later fails with a confusing error and no
    // audit trail. The preflight already guarantees `order.userId ||
    // order.guestSessionId`, so an empty email here means the user/guest
    // row exists without an address (legacy rows, race with account
    // deletion). Skip the enqueue and warn so ops can investigate.
    logger.warn(
      'resale',
      `resale ticket delivery: no recipient email for order ${order._id}`,
    );
    return;
  }

  await enqueueTicketEmailDelivery(ctx, {orderId: order._id});
}

export type PreflightedResale = {
  order: Doc<'ticket_orders'>;
  listing: Doc<'resale_listings'>;
  sellerTicket: Doc<'tickets'>;
  event: Doc<'events'>;
  sellerOrder: Doc<'ticket_orders'> | null;
  sellerFinancial: Awaited<ReturnType<typeof loadOrderFinancial>>;
};

/**
 * Narrowed view of `PreflightedResale` containing only the fields
 * `deriveResaleSettlement` actually reads. A full `PreflightedResale` is
 * structurally assignable to this, so production callers pass the entire
 * preflight bundle while tests build a minimal fixture.
 *
 * Spelling out the picked fields here (instead of reusing the wider
 * `PreflightedResale`) means a future derive reaching for a new field
 * fails to compile until this type and its test fixtures are updated —
 * which is the regression net this narrow buys.
 */
export type DeriveSettlementInput = {
  sellerTicket: Pick<Doc<'tickets'>, 'orderId'>;
  event: Pick<Doc<'events'>, 'resaleFeePct'>;
  sellerOrder: Pick<
    Doc<'ticket_orders'>,
    '_id' | 'amountCents' | 'quantity' | 'stripePaymentIntentId'
  > | null;
  sellerFinancial: Awaited<ReturnType<typeof loadOrderFinancial>>;
};

/**
 * Seller-refund context whose `stripePaymentIntentId` is narrowed from
 * `string | undefined` on `Doc<'ticket_orders'>` down to a concrete
 * `string`. Only produced inside the `queued` branch of `RefundDecision`,
 * so the enqueue site does not re-check presence.
 */
export type EnqueueableSellerRefundContext = {
  sellerOrderId: Id<'ticket_orders'>;
  sellerOrderStripePaymentIntentId: string;
};

/**
 * Discriminated outcome of the seller-refund classification step.
 *
 * - `none`: no recoverable payment to refund against — complimentary /
 *   imported seat, or a seller order not in `'completed'` state with no
 *   refund amount owed. Nothing to enqueue; the listing flips to a
 *   terminal refund state in the same mutation.
 * - `immediate`: seller order is refundable but no refund is owed
 *   (e.g. 100% resale fee). Same in-mutation resolution, no workpool
 *   entry needed.
 * - `queued`: Stripe refund must be queued. Context carries the narrowed
 *   PI so the enqueue site does not re-check presence.
 */
export type RefundDecision =
  | {kind: 'none'}
  | {kind: 'immediate'}
  | {
      kind: 'queued';
      refundContext: EnqueueableSellerRefundContext;
    };

export type ResaleSettlement = {
  resaleFeeCents: number;
  sellerRefundAmount: number;
  lostProcessingFeeCents: number;
  refund: RefundDecision;
};

/**
 * Read-only validation phase.
 *
 * Loads every record finalization depends on and throws on any invariant
 * violation before the first write. Returning `null` sellerOrder /
 * sellerFinancial is legal (complimentary / imported tickets); the derive
 * step decides whether a refund is required.
 */
async function preflightResaleFinalization(
  ctx: ResaleSettlementMutationCtx,
  args: FinalizeResaleArgs,
): Promise<PreflightedResale> {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order || order.kind !== 'resale' || !order.resaleListingId) {
    logger.error(
      'resale',
      `finalizeResale: order ${args.orderId} is not a resale order`,
    );
    throwInvalidState(ErrorMessages.INVALID_STATE('not a resale order'));
  }

  const listing = await ctx.db.get('resale_listings', order.resaleListingId);
  if (!listing || !isPendingResaleListingStatus(listing.status)) {
    logger.error(
      'resale',
      `finalizeResale: listing for order ${args.orderId} has unexpected status: ${listing?.status ?? 'not found'}`,
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE('listing is not in the expected state'),
    );
  }
  if (listing.pendingOrderId !== args.orderId) {
    logger.error(
      'resale',
      `finalizeResale: listing ${listing._id} is pending for order ${listing.pendingOrderId ?? 'none'}, not ${args.orderId}`,
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE('listing is not held by this order'),
    );
  }

  const sellerTicket = await ctx.db.get('tickets', listing.ticketId);
  if (!sellerTicket) throwNotFound('Ticket');
  if (sellerTicket.userId !== listing.sellerId) {
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'listing seller does not own the listed ticket',
      ),
    );
  }
  if (sellerTicket.status !== 'valid') {
    throwInvalidState(
      ErrorMessages.INVALID_STATE('seller ticket is not transferable'),
    );
  }
  if (order.tier !== sellerTicket.tier) {
    logger.error(
      'resale',
      `finalizeResale: order ${order._id} tier ${order.tier} does not match seller ticket tier ${sellerTicket.tier}`,
    );
    throwInvalidState(ErrorMessages.INVALID_STATE('resale tier mismatch'));
  }

  const event = await ctx.db.get('events', order.eventId);
  if (!event) throwNotFound('Event');

  if (!order.userId && !order.guestSessionId) {
    logger.error(
      'resale',
      `finalizeResale: order ${order._id} has no owner (userId and guestSessionId both absent)`,
    );
    throwInvalidState(ErrorMessages.INVALID_STATE('order has no owner'));
  }
  if (order.userId && order.userId === listing.sellerId) {
    throwInvalidState(
      ErrorMessages.INVALID_STATE('seller cannot buy their own resale listing'),
    );
  }

  const sellerOrder = sellerTicket.orderId
    ? await ctx.db.get('ticket_orders', sellerTicket.orderId)
    : null;
  const sellerFinancial = sellerOrder
    ? await loadOrderFinancial(ctx.db, sellerOrder._id)
    : null;

  return {order, listing, sellerTicket, event, sellerOrder, sellerFinancial};
}

/**
 * Derives settlement fee math and classifies the seller-refund decision
 * into a single `RefundDecision` discriminated variant.
 *
 * Not pure: throws `ConvexError` (and writes a `logger.error`) when the
 * settlement owes the seller money but the original seller order cannot
 * be refunded. That condition is a hard stop, not a silent skip — failing
 * quietly would lose money we owe the seller.
 *
 * @internal Exported for unit tests only. Production callers should go
 * through `finalizeResaleState`.
 */
export function deriveResaleSettlement(
  pre: DeriveSettlementInput,
): ResaleSettlement {
  const {sellerOrder, sellerFinancial, event, sellerTicket} = pre;
  const {resaleFeeCents, sellerRefundAmount, lostProcessingFeeCents} =
    calculateResaleSellerSettlement(
      sellerOrder,
      sellerFinancial?.originalProcessorFeeCents,
      event.resaleFeePct,
    );

  // `loadOrderFinancial` already returns null unless the seller order is
  // completed with a recorded payment event, so `sellerFinancial !== null`
  // is the single eligibility gate. `sellerOrder !== null` follows from it
  // (financial can't exist without the order) but is required here for the
  // type narrow.
  const isRefundable = sellerFinancial !== null && sellerOrder !== null;
  const needsSellerRefund = sellerRefundAmount > 0;

  if (needsSellerRefund && !isRefundable) {
    logger.error(
      'resale',
      `finalizeResale: seller order ${sellerTicket.orderId ?? 'missing'} is unavailable or not refundable`,
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE('seller order is not in a refundable state'),
    );
  }

  if (!isRefundable) {
    return {
      resaleFeeCents,
      sellerRefundAmount,
      lostProcessingFeeCents,
      refund: {kind: 'none'},
    };
  }

  if (!needsSellerRefund) {
    return {
      resaleFeeCents,
      sellerRefundAmount,
      lostProcessingFeeCents,
      refund: {kind: 'immediate'},
    };
  }

  if (!sellerOrder.stripePaymentIntentId) {
    logger.error(
      'resale',
      `finalizeResale: seller order ${sellerOrder._id} has no supported refund processor`,
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'seller order refund provider is unsupported',
      ),
    );
  }

  return {
    resaleFeeCents,
    sellerRefundAmount,
    lostProcessingFeeCents,
    refund: {
      kind: 'queued',
      refundContext: {
        sellerOrderId: sellerOrder._id,
        sellerOrderStripePaymentIntentId: sellerOrder.stripePaymentIntentId,
      },
    },
  };
}

/**
 * Moves the listed ticket from seller to buyer.
 *
 * Net sold count is unchanged — primary inventory already accounted for the
 * seat at the original sale. Two-write pattern on buyer ticket is required
 * by `buildTicketRosterProjection` (needs real ticket id).
 */
async function applyResaleTicketTransfer(
  ctx: ResaleSettlementMutationCtx,
  order: Doc<'ticket_orders'>,
  sellerTicket: Doc<'tickets'>,
): Promise<void> {
  const resaleOwnerFields = {
    ...(order.userId ? {userId: order.userId} : {}),
    ...(order.guestSessionId ? {guestSessionId: order.guestSessionId} : {}),
  };

  const [buyerUser, buyerGuestSession] = await Promise.all([
    order.userId ? ctx.db.get('users', order.userId) : Promise.resolve(null),
    order.guestSessionId
      ? ctx.db.get('guest_sessions', order.guestSessionId)
      : Promise.resolve(null),
  ]);

  // Defensive: openResaleOrderState rejects guest identities today, so a
  // resale order never carries a guestSessionId. Kept aligned with the primary
  // path so enabling guest resale cannot silently drop the cap anchor.
  const buyerGuestEmail =
    order.guestEmailLower ?? buyerGuestSession?.email ?? null;

  const buyerTicketId = await ctx.db.insert('tickets', {
    ...resaleOwnerFields,
    // Anchor guest tickets to the buyer email so the per-email ticket cap
    // survives guest session deletion (see countActiveOwnedTicketsForEvent).
    ...(order.guestSessionId && buyerGuestEmail
      ? {guestEmailLower: buyerGuestEmail.toLowerCase()}
      : {}),
    eventId: order.eventId,
    orderId: order._id,
    status: 'valid',
    tier: sellerTicket.tier,
  });
  await ctx.db.patch(
    'tickets',
    buyerTicketId,
    buildTicketRosterProjection({
      ticketId: buyerTicketId,
      status: 'valid',
      attendeeName: buyerUser?.name ?? buyerGuestEmail,
      email: buyerUser?.email ?? buyerGuestEmail,
      checkedInByName: null,
    }),
  );

  await ctx.db.patch('tickets', sellerTicket._id, {
    status: 'refunded',
    ...buildTicketRosterProjection({
      ticketId: sellerTicket._id,
      status: 'refunded',
      attendeeName: sellerTicket.rosterAttendeeName ?? null,
      email: sellerTicket.rosterEmail ?? null,
      checkedInByName: sellerTicket.rosterCheckedInByName ?? null,
    }),
  });

  // Catch the resale buyer up on broadcasts sent before they joined.
  await scheduleBroadcastCatchup(ctx, {
    eventId: order.eventId,
    email: buyerUser?.email ?? buyerGuestSession?.email,
    userId: order.userId,
  });
}

/**
 * Pure: derives the listing-level seller-refund patch that accompanies the
 * canonical completion patch. Mirrors the `RefundDecision` variant:
 *
 *  - `none` / `immediate`: resolved in-transaction. Returns the resolved
 *    patch so the listing flips out of `sellerRefundState: 'pending'`
 *    (which `buildCompletionPatch` bakes in as a default) in the same
 *    mutation. Leaving `none` as an empty overlay would strand the
 *    listing on `'pending'` forever, since no workpool entry is ever
 *    enqueued to flip it.
 *  - `queued`: leaves `sellerRefundState: 'pending'` (from the completion
 *    patch default) and zeroes the attempt counters so the workpool's
 *    onComplete handler can gate on `retryCount === sellerRefundAttempts`.
 */
function deriveSellerRefundPatch(
  settlement: ResaleSettlement,
  completedAt: number,
): SellerRefundListingPatch {
  switch (settlement.refund.kind) {
    case 'none':
    case 'immediate':
      return buildSellerRefundResolvedPatch({now: completedAt});
    case 'queued':
      return buildSellerRefundPendingPatch();
  }
}

/**
 * Side-effecting: enqueues the Stripe seller refund action when the
 * classification decided one is needed. No-op for `none` and `immediate`.
 *
 * Split from `deriveSellerRefundPatch` so callers can await only the
 * branch that actually does I/O; every non-`queued` call site stays sync.
 */
async function enqueueSellerRefundIfNeeded(
  ctx: ResaleSettlementMutationCtx,
  settlement: ResaleSettlement,
  listingId: Id<'resale_listings'>,
  eventId: Id<'events'>,
): Promise<void> {
  if (settlement.refund.kind !== 'queued') return;

  const {refundContext} = settlement.refund;
  const workContext: SellerRefundWorkContext = {
    sellerOrderId: refundContext.sellerOrderId,
    sellerOrderStripePaymentIntentId:
      refundContext.sellerOrderStripePaymentIntentId,
    listingId,
    eventId,
    refundAmountCents: settlement.sellerRefundAmount,
    lostProcessingFeeCents: settlement.lostProcessingFeeCents,
    idempotencyKey: generateStripeIdempotencyKey(
      refundContext.sellerOrderId,
      'rsrfd',
      listingId,
    ),
    retryCount: 0,
  };
  await enqueueSellerRefund(ctx, workContext);
}

/**
 * Completes the listing FSM and layers the seller-refund overlay on top
 * of the canonical completion patch. Kept as one step because the
 * listing record is the single source of truth for both settlement
 * amounts and refund state.
 *
 * Enqueue runs before the listing patch so a failing enqueue rolls back
 * the whole mutation (Convex transactional guarantee) rather than
 * leaving a `'completed'` listing with no workpool entry to follow up.
 */
async function applySellerRefundAndCompleteListing(
  ctx: ResaleSettlementMutationCtx,
  listing: Doc<'resale_listings'>,
  settlement: ResaleSettlement,
  completedAt: number,
): Promise<void> {
  await enqueueSellerRefundIfNeeded(
    ctx,
    settlement,
    listing._id,
    listing.eventId,
  );
  const sellerRefundPatch = deriveSellerRefundPatch(settlement, completedAt);

  assertValidListingTransition(listing.status, 'completed');
  await ctx.db.patch('resale_listings', listing._id, {
    ...buildCompletionPatch({
      sellerRefundAmountCents: settlement.sellerRefundAmount,
      resaleFeeCents: settlement.resaleFeeCents,
      lostProcessingFeeCents: settlement.lostProcessingFeeCents,
      now: completedAt,
    }),
    ...sellerRefundPatch,
  });
}

/**
 * Buyer-facing side effects that must happen AFTER the listing + ticket
 * state transitions: clear the buyer's resale notification subscription
 * for this event (they just got a ticket, they don't need a waitlist
 * anymore) and queue the ticket delivery email.
 *
 * Email enqueue is skipped in test/unit runtimes so delivery state stays
 * deterministic and provider mocks are not required.
 */
async function queueResaleSideEffects(
  ctx: ResaleSettlementMutationCtx,
  order: Doc<'ticket_orders'>,
): Promise<void> {
  await removeBuyerResaleNotificationSubscription(ctx.db, {
    eventId: order.eventId,
    userId: order.userId,
  });

  if (isTestEnvironment() || isUnitTestRuntime()) return;
  await enqueueTicketDeliveryEmail(ctx, order);
}

/**
 * Ordering contract (do not reorder):
 *  1. preflight — all reads + invariant checks. No writes yet.
 *  2. derive — classify the seller refund (throws on money-owed-but-
 *              -unrefundable). Still no writes.
 *  3. snap completedAt — one wall-clock read reused by the listing
 *                        completion patch and the resolved-state
 *                        timestamp fields, so those timestamps agree
 *                        within this mutation.
 *  4. apply ticket transfer — seller ticket → buyer ticket.
 *  5. apply listing refund + completion patch (including seller-refund
 *                                              enqueue on the `queued`
 *                                              branch).
 *  6. queue side effects — email + notification subscription cleanup.
 *
 * Steps 1–3 leave the DB untouched; a throw from any of them is free.
 *
 * Steps 4–6 all run inside the same Convex mutation transaction. A throw
 * from any of them rolls back the entire mutation, including the
 * earlier-in-pipeline writes. The *async actions* that steps 5 and 6
 * schedule (Stripe seller refund on the `queued` branch, ticket-delivery
 * email) execute outside the transaction and may fail independently;
 * the scheduling itself is transactional.
 */
export async function finalizeResaleState(
  ctx: ResaleSettlementMutationCtx,
  args: FinalizeResaleArgs,
): Promise<null> {
  const pre = await preflightResaleFinalization(ctx, args);
  const settlement = deriveResaleSettlement(pre);
  const completedAt = args.now ?? Date.now();

  await applyResaleTicketTransfer(ctx, pre.order, pre.sellerTicket);
  await applySellerRefundAndCompleteListing(
    ctx,
    pre.listing,
    settlement,
    completedAt,
  );
  await queueResaleSideEffects(ctx, pre.order);

  return null;
}
