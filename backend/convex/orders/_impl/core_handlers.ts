import type {Doc, Id} from '../../_generated/dataModel';
import type {ActionCtx, MutationCtx, QueryCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {getAuthUser, getAuthUserId} from '../../lib/auth_identity';
import {resolveCallerIdentity} from '../../lib/caller_identity';
import {rateLimiter} from '../../lib/rate_limits';
import {
  isActiveTicketStatus,
  isRefundedTicketStatus,
  isValidTicketStatus,
  type OrderFinancialEventKind,
  type TicketOrderKind,
  type TicketOrderState,
  type TicketTier,
} from '../../lib/validators/ticketing';
import {buildTicketRosterProjection} from '../../lib/ticket_roster_projection';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  completePrimaryOrderState,
  completeResaleOrderState,
} from '../../lib/orders/complete';
import {appendFinancialEvent} from '../../lib/orders/financial_events';
import {findGuestSessionByToken} from '../../lib/guest_sessions/lifecycle';
import {
  markLateInvalidRefundedState,
  prepareLateInvalidRefundState,
} from '../../lib/orders/late_invalid';
import {
  openPrimaryOrderState,
  openResaleOrderState,
} from '../../lib/orders/open';
import {
  getPrimaryHeldInventoryReconciliation,
  repairPrimaryHeldInventoryCount,
} from '../../lib/orders/inventory_reconciliation';
import {releaseOrderState} from '../../lib/orders/release';
import {getOrderForCaller, throwOrderError} from '../../lib/orders/access';
import {resolveStripeConnectInfo} from '../../lib/payments/refund_processing';
import {
  calculateRefundedTicketCount,
  generateStripeIdempotencyKey,
} from '../../lib/payments/refunds';
import {loadOrderFinancial} from '../../lib/orders/financial_reporting';
import {ORDER_RELEASE_GRACE_MS} from '../../lib/constants';
import {LEGAL_TERMS_VERSION} from '@shared/constants';

type CheckoutFailureStage =
  | 'account_setup'
  | 'checkout_session'
  | 'payment_intent';

type OpenArgs = {
  eventId: Id<'events'>;
  quantity: number;
  tier: TicketTier;
  totalAmount: number;
};

type OpenForGuestArgs = OpenArgs & {
  sessionToken: string;
  termsAccepted: boolean;
};
type OpenResaleArgs = Omit<OpenArgs, 'quantity'>;
type ClaimFreeTicketArgs = Omit<OpenArgs, 'totalAmount'>;
type ClaimFreeTicketAsGuestArgs = ClaimFreeTicketArgs & {
  sessionToken: string;
  termsAccepted: boolean;
};

type StartCheckoutArgs = {
  orderId: Id<'ticket_orders'>;
  checkoutTheme?: 'light' | 'dark';
  sessionToken?: string;
};

type SyncCheckoutSessionArgs = {
  checkoutSessionId: string;
  sessionToken?: string;
};

type GetCheckoutStatusArgs = {
  orderId: Id<'ticket_orders'>;
  sessionToken?: string;
};

type GetInternalArgs = {orderId: Id<'ticket_orders'>};
type NormalizeTicketOrderIdArgs = {candidate: string};
type GetByCheckoutSessionIdArgs = {stripeCheckoutSessionId: string};
type GetByStripePaymentIntentIdArgs = {stripePaymentIntentId: string};

type BindCheckoutSessionArgs = {
  orderId: Id<'ticket_orders'>;
  stripeCheckoutSessionId: string;
  expiresAt?: number;
};

type ExpireArgs = {orderId: Id<'ticket_orders'>; force?: boolean};

type ReleaseForPaymentFailureArgs = {
  orderId: Id<'ticket_orders'>;
  errorCode?: string;
  failureStage?: CheckoutFailureStage;
};

type PrepareStripeOrderSettlementArgs = {
  orderId: Id<'ticket_orders'>;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeEventId?: string;
  note?: string;
};

type MarkLateInvalidRefundedArgs = {
  orderId: Id<'ticket_orders'>;
  stripeRefundId: string;
  stripeEventId?: string;
  refundedAmountCents: number;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
};

type RecordFinancialEventArgs = {
  orderId: Id<'ticket_orders'>;
  eventId: Id<'events'>;
  kind: OrderFinancialEventKind;
  amountCents?: number;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeRefundId?: string;
  stripeDisputeId?: string;
  stripeEventId?: string;
  connectedAccountId?: string;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
  note?: string;
  occurredAt?: number;
};

type ApplyExternalRefundArgs = {
  orderId: Id<'ticket_orders'>;
  refundedAmountCents: number;
  stripeRefundId?: string;
  ledgerRefundAmountCents?: number;
  stripeEventId?: string;
  ticketIdsToRefund?: Id<'tickets'>[];
  refundedBy?: Id<'users'>;
  lostProcessingFeeCents?: number;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
  auditAction?: 'payment.refund' | 'payment.force-refund-all' | 'ticket.refund';
  auditSource?: string;
};

type ClearCheckoutSessionArgs = {orderId: Id<'ticket_orders'>};
type CancelOpenOrdersForEventArgs = {eventId: Id<'events'>};
type GetHeldInventoryReconciliationArgs = {eventId: Id<'events'>};
type RepairHeldInventoryCountArgs = {
  eventId: Id<'events'>;
  expectedStoredHeldCount?: number;
};

type CheckoutSessionResult = {
  orderId: Id<'ticket_orders'>;
  clientSecret: string;
  stripeCheckoutSessionId: string;
  expiresAt: number;
  connectedAccountId: string | null;
};

type CheckoutStatusResult = {
  orderId: Id<'ticket_orders'>;
  state: TicketOrderState;
  kind: TicketOrderKind;
  expiresAt: number;
  completedAt?: number;
  releasedAt?: number;
};

type StripeOrderSettlementResult = CheckoutStatusResult & {
  outcome: 'completed' | 'refund_required' | 'already_refunded';
  eventId?: Id<'events'>;
  refundedAmountCents?: number;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
};

function toOpenOrderResult(order: {
  _id: Id<'ticket_orders'>;
  expiresAt: number;
  state: 'open' | 'completed' | 'released';
}) {
  return {
    orderId: order._id,
    expiresAt: order.expiresAt,
    state: order.state,
  };
}

function toCheckoutStatus(order: {
  _id: Id<'ticket_orders'>;
  state: 'open' | 'completed' | 'released';
  kind: 'primary' | 'resale';
  expiresAt: number;
  completedAt?: number;
  releasedAt?: number;
}): CheckoutStatusResult {
  return {
    orderId: order._id,
    state: order.state,
    kind: order.kind,
    expiresAt: order.expiresAt,
    completedAt: order.completedAt,
    releasedAt: order.releasedAt,
  };
}

async function findCompletedFreeOrderForIdentity(
  ctx: MutationCtx,
  identity:
    | {type: 'user'; userId: Id<'users'>}
    | {type: 'guest'; guestSessionId: Id<'guest_sessions'>},
  args: ClaimFreeTicketArgs,
): Promise<Doc<'ticket_orders'> | null> {
  const query =
    identity.type === 'user'
      ? ctx.db
          .query('ticket_orders')
          .withIndex(
            'by_owner_user_event_state_kind_amountCents_tier_quantity',
            (q) =>
              q
                .eq('userId', identity.userId)
                .eq('eventId', args.eventId)
                .eq('state', 'completed')
                .eq('kind', 'primary')
                .eq('amountCents', 0)
                .eq('tier', args.tier)
                .eq('quantity', args.quantity),
          )
      : ctx.db
          .query('ticket_orders')
          .withIndex(
            'by_owner_guest_event_state_kind_amountCents_tier_quantity',
            (q) =>
              q
                .eq('guestSessionId', identity.guestSessionId)
                .eq('eventId', args.eventId)
                .eq('state', 'completed')
                .eq('kind', 'primary')
                .eq('amountCents', 0)
                .eq('tier', args.tier)
                .eq('quantity', args.quantity),
          );

  return await query.first();
}

async function resolveOrderCallerForQuery(
  ctx: QueryCtx,
  sessionToken?: string,
) {
  const user = await getAuthUser(ctx);
  if (user) {
    if (!user?.email) {
      throwOrderError('FORBIDDEN', 'Authenticated user record is invalid');
    }
    return {type: 'user' as const, userId: user._id, email: user.email};
  }

  if (!sessionToken) {
    throwOrderError('FORBIDDEN', 'Guest session required');
  }

  // Pure token lookup — query handlers must stay deterministic, so freshness
  // is intentionally NOT checked here. The order's `guestSessionId` match in
  // getOrderForCaller is the access control; the order state itself encodes
  // whether checkout is still viable. Mutations re-check freshness against
  // wall-clock independently.
  const guestSession = await findGuestSessionByToken(ctx, sessionToken);
  if (!guestSession || guestSession.convertedToUserId) {
    throwOrderError(
      'RESERVATION_EXPIRED',
      'Guest session is invalid or expired',
    );
  }

  return {
    type: 'guest' as const,
    guestSessionId: guestSession._id,
    email: guestSession.email,
    guestOwnerKey: `session:${guestSession._id}`,
  };
}

export async function openHandler(ctx: MutationCtx, args: OpenArgs) {
  const identity = await resolveCallerIdentity(ctx);
  if (identity.type !== 'user') {
    throwOrderError('FORBIDDEN', 'Authentication is required');
  }

  await rateLimiter.limit(ctx, 'orderOpen', {
    key: `${identity.userId}:${args.eventId}`,
    throws: true,
  });

  const order = await openPrimaryOrderState(ctx, {
    identity,
    eventId: args.eventId,
    quantity: args.quantity,
    tier: args.tier,
    amountCents: args.totalAmount,
  });

  return toOpenOrderResult(order);
}

export async function openForGuestHandler(
  ctx: MutationCtx,
  args: OpenForGuestArgs,
) {
  const identity = await resolveCallerIdentity(ctx, args.sessionToken);
  if (identity.type !== 'guest') {
    throwOrderError('FORBIDDEN', 'Guest session required');
  }

  if (args.termsAccepted !== true) {
    throwOrderError(
      'TERMS_NOT_ACCEPTED',
      'You must accept the terms of service to continue',
    );
  }

  await rateLimiter.limit(ctx, 'orderOpenForGuest', {
    key: `${identity.guestOwnerKey}:${args.eventId}`,
    throws: true,
  });

  const order = await openPrimaryOrderState(ctx, {
    identity,
    eventId: args.eventId,
    quantity: args.quantity,
    tier: args.tier,
    amountCents: args.totalAmount,
    tosAcceptedAt: Date.now(),
    tosVersion: LEGAL_TERMS_VERSION,
  });

  return toOpenOrderResult(order);
}

export async function openResaleHandler(
  ctx: MutationCtx,
  args: OpenResaleArgs,
) {
  const identity = await resolveCallerIdentity(ctx);
  if (identity.type !== 'user') {
    throwOrderError('FORBIDDEN', 'Authentication is required');
  }

  await rateLimiter.limit(ctx, 'orderOpenResale', {
    key: `${identity.userId}:${args.eventId}`,
    throws: true,
  });

  const order = await openResaleOrderState(ctx, {
    identity,
    eventId: args.eventId,
    tier: args.tier,
    amountCents: args.totalAmount,
  });

  return toOpenOrderResult(order);
}

export async function claimFreeTicketHandler(
  ctx: MutationCtx,
  args: ClaimFreeTicketArgs,
) {
  const identity = await resolveCallerIdentity(ctx);
  if (identity.type !== 'user') {
    throwOrderError('FORBIDDEN', 'Authentication is required');
  }

  const existingCompletedOrder = await findCompletedFreeOrderForIdentity(
    ctx,
    identity,
    args,
  );
  if (existingCompletedOrder) {
    return {success: true, orderId: existingCompletedOrder._id};
  }

  await rateLimiter.limit(ctx, 'orderClaimFreeTicket', {
    key: identity.userId,
    throws: true,
  });

  const order = await openPrimaryOrderState(ctx, {
    identity,
    eventId: args.eventId,
    quantity: args.quantity,
    tier: args.tier,
    amountCents: 0,
  });
  await completePrimaryOrderState(ctx, {
    orderId: order._id,
    note: 'free_ticket',
  });
  return {success: true, orderId: order._id};
}

export async function claimFreeTicketAsGuestHandler(
  ctx: MutationCtx,
  args: ClaimFreeTicketAsGuestArgs,
) {
  const identity = await resolveCallerIdentity(ctx, args.sessionToken);
  if (identity.type !== 'guest') {
    throwOrderError('FORBIDDEN', 'Guest session required');
  }

  const existingCompletedOrder = await findCompletedFreeOrderForIdentity(
    ctx,
    identity,
    args,
  );
  if (existingCompletedOrder) {
    return {success: true, orderId: existingCompletedOrder._id};
  }

  if (args.termsAccepted !== true) {
    throwOrderError(
      'TERMS_NOT_ACCEPTED',
      'You must accept the terms of service to continue',
    );
  }

  await rateLimiter.limit(ctx, 'orderClaimFreeTicketForGuest', {
    key: identity.guestOwnerKey,
    throws: true,
  });

  const order = await openPrimaryOrderState(ctx, {
    identity,
    eventId: args.eventId,
    quantity: args.quantity,
    tier: args.tier,
    amountCents: 0,
    tosAcceptedAt: Date.now(),
    tosVersion: LEGAL_TERMS_VERSION,
  });
  await completePrimaryOrderState(ctx, {
    orderId: order._id,
    note: 'free_ticket',
  });
  return {success: true, orderId: order._id};
}

export async function startCheckoutHandler(
  ctx: ActionCtx,
  args: StartCheckoutArgs,
): Promise<CheckoutSessionResult> {
  await ctx.runMutation(internal.lib.rate_limits.applyOrderActionRateLimit, {
    name: 'orderStartCheckout',
    key: args.orderId,
  });

  const result: CheckoutSessionResult = await ctx.runAction(
    internal.stripe.actions.startTicketOrderCheckoutSession,
    args,
  );
  return result;
}

export async function syncCheckoutSessionHandler(
  ctx: ActionCtx,
  args: SyncCheckoutSessionArgs,
): Promise<CheckoutStatusResult> {
  await ctx.runMutation(internal.lib.rate_limits.applyOrderActionRateLimit, {
    name: 'orderSyncCheckoutSession',
    key: args.checkoutSessionId,
  });

  const result: CheckoutStatusResult = await ctx.runAction(
    internal.stripe.actions.syncTicketOrderCheckoutSession,
    args,
  );
  return result;
}

export async function getCheckoutStatusHandler(
  ctx: QueryCtx,
  args: GetCheckoutStatusArgs,
) {
  const identity = await resolveOrderCallerForQuery(ctx, args.sessionToken);
  const order = await getOrderForCaller(ctx.db, {
    orderId: args.orderId,
    identity,
  });
  return {
    orderId: order._id,
    state: order.state,
    kind: order.kind,
    expiresAt: order.expiresAt,
    completedAt: order.completedAt,
    releasedAt: order.releasedAt,
  };
}

export async function listMyOrdersHandler(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return [];

  const latestOrders: Doc<'ticket_orders'>[] = [];
  const query = ctx.db
    .query('ticket_orders')
    .withIndex('by_owner_user_event_state', (q) => q.eq('userId', userId));

  for await (const order of query) {
    latestOrders.push(order);
    latestOrders.sort((a, b) => b._creationTime - a._creationTime);
    if (latestOrders.length > 100) {
      latestOrders.pop();
    }
  }

  return latestOrders.map((order) => ({
    _id: order._id,
    eventId: order.eventId,
    kind: order.kind,
    state: order.state,
    quantity: order.quantity,
    tier: order.tier,
    amountCents: order.amountCents,
    expiresAt: order.expiresAt,
    completedAt: order.completedAt,
    releasedAt: order.releasedAt,
    releaseReason: order.releaseReason,
  }));
}

export async function getInternalHandler(ctx: QueryCtx, args: GetInternalArgs) {
  return await ctx.db.get('ticket_orders', args.orderId);
}

export async function getHeldInventoryReconciliationHandler(
  ctx: QueryCtx,
  args: GetHeldInventoryReconciliationArgs,
) {
  return await getPrimaryHeldInventoryReconciliation(ctx, args.eventId);
}

export async function repairHeldInventoryCountHandler(
  ctx: MutationCtx,
  args: RepairHeldInventoryCountArgs,
) {
  return await repairPrimaryHeldInventoryCount(ctx, args);
}

export async function normalizeTicketOrderIdHandler(
  ctx: QueryCtx,
  args: NormalizeTicketOrderIdArgs,
) {
  return ctx.db.normalizeId('ticket_orders', args.candidate);
}

export async function getByCheckoutSessionIdHandler(
  ctx: QueryCtx,
  args: GetByCheckoutSessionIdArgs,
) {
  return await ctx.db
    .query('ticket_orders')
    .withIndex('by_stripeCheckoutSessionId', (q) =>
      q.eq('stripeCheckoutSessionId', args.stripeCheckoutSessionId),
    )
    .first();
}

export async function getByStripePaymentIntentIdHandler(
  ctx: QueryCtx,
  args: GetByStripePaymentIntentIdArgs,
) {
  return await ctx.db
    .query('ticket_orders')
    .withIndex('by_stripePaymentIntentId', (q) =>
      q.eq('stripePaymentIntentId', args.stripePaymentIntentId),
    )
    .first();
}

export async function bindCheckoutSessionHandler(
  ctx: MutationCtx,
  args: BindCheckoutSessionArgs,
) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) {
    throwOrderError('INVALID_STATE', 'Order not found');
  }

  if (
    order.stripeCheckoutSessionId &&
    order.stripeCheckoutSessionId !== args.stripeCheckoutSessionId
  ) {
    throwOrderError(
      'INVALID_STATE',
      'Order is already bound to a different Checkout Session',
    );
  }

  const resolvedExpiresAt =
    args.expiresAt !== undefined && args.expiresAt > order.expiresAt
      ? args.expiresAt
      : order.expiresAt;

  const patch: {stripeCheckoutSessionId?: string; expiresAt?: number} = {};
  if (order.stripeCheckoutSessionId !== args.stripeCheckoutSessionId) {
    patch.stripeCheckoutSessionId = args.stripeCheckoutSessionId;
  }
  if (resolvedExpiresAt !== order.expiresAt) {
    patch.expiresAt = resolvedExpiresAt;
  }
  if (
    patch.stripeCheckoutSessionId !== undefined ||
    patch.expiresAt !== undefined
  ) {
    await ctx.db.patch('ticket_orders', args.orderId, patch);
  }

  return {
    orderId: order._id,
    clientSecret: '',
    stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    expiresAt: resolvedExpiresAt,
    connectedAccountId: order.connectedAccountId ?? null,
  };
}

export async function expireHandler(ctx: MutationCtx, args: ExpireArgs) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) return null;
  if (order.state !== 'open') return null;
  const now = Date.now();
  if (!args.force && order.expiresAt > now) {
    await ctx.scheduler.runAfter(
      Math.max(0, order.expiresAt - now + ORDER_RELEASE_GRACE_MS),
      internal.orders.core.expire,
      {orderId: args.orderId},
    );
    return null;
  }

  await releaseOrderState(ctx.db, {
    orderId: args.orderId,
    reason: 'expired',
    now,
  });
  return null;
}

export async function releaseForPaymentFailureHandler(
  ctx: MutationCtx,
  args: ReleaseForPaymentFailureArgs,
) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (order?.state !== 'open') {
    return null;
  }
  await releaseOrderState(ctx.db, {
    orderId: args.orderId,
    reason: 'payment_failed',
  });
  return null;
}

export async function prepareStripeOrderSettlementHandler(
  ctx: MutationCtx,
  args: PrepareStripeOrderSettlementArgs,
) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order) {
    throwOrderError('INVALID_STATE', 'Order not found');
  }

  try {
    if (order.kind === 'resale') {
      const result = await completeResaleOrderState(ctx, args);
      return {
        ...toCheckoutStatus(result),
        outcome: 'completed' as const,
      };
    }

    const result = await completePrimaryOrderState(ctx, {
      ...args,
    });
    return {
      ...toCheckoutStatus(result),
      outcome: 'completed' as const,
    };
  } catch (error: unknown) {
    const currentOrder = await ctx.db.get('ticket_orders', args.orderId);
    if (!currentOrder || currentOrder.state !== 'released') {
      throw error;
    }

    const lateInvalid = await prepareLateInvalidRefundState(ctx, {
      orderId: args.orderId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId,
      stripeEventId: args.stripeEventId,
    });
    const outcome = lateInvalid.alreadyRefunded
      ? ('already_refunded' as const)
      : ('refund_required' as const);
    return {
      ...toCheckoutStatus(lateInvalid.order),
      outcome,
      eventId: lateInvalid.order.eventId,
      refundedAmountCents: lateInvalid.refundedAmountCents,
      stripePaymentIntentId:
        args.stripePaymentIntentId ?? lateInvalid.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId ?? lateInvalid.stripeChargeId,
    };
  }
}

export async function settlePaidOrderFromStripeHandler(
  ctx: ActionCtx,
  args: PrepareStripeOrderSettlementArgs,
): Promise<CheckoutStatusResult> {
  const result: StripeOrderSettlementResult = await ctx.runMutation(
    internal.orders.core.prepareStripeOrderSettlement,
    args,
  );

  if (result.outcome === 'refund_required') {
    if (
      !result.stripePaymentIntentId ||
      !result.eventId ||
      !result.refundedAmountCents
    ) {
      throwOrderError(
        'INVALID_STATE',
        'Late invalid payment could not be refunded automatically',
      );
    }

    const connectInfo = await resolveStripeConnectInfo(ctx, result.orderId);
    const refund = await ctx.runAction(
      internal.stripe.actions.processStripeRefund,
      {
        paymentIntentId: result.stripePaymentIntentId,
        amountCents: result.refundedAmountCents,
        reason: 'Late invalid ticket order payment',
        idempotencyKey: generateStripeIdempotencyKey(
          result.orderId,
          'late-invalid-refund',
        ),
        connectedAccountId: connectInfo.connectedAccountId ?? undefined,
        refundApplicationFee: connectInfo.isConnectPayment,
      },
    );

    await ctx.runMutation(internal.orders.core.markLateInvalidRefunded, {
      orderId: result.orderId,
      stripeRefundId: refund.refundId,
      stripeEventId: args.stripeEventId,
      refundedAmountCents: result.refundedAmountCents,
      processorFeeCents: refund.processorFeeCents,
      platformFeeCents: refund.platformFeeCents,
      connectedAccountNetCents: refund.connectedAccountNetCents,
    });
  }

  return {
    orderId: result.orderId,
    state: result.state,
    kind: result.kind,
    expiresAt: result.expiresAt,
    completedAt: result.completedAt,
    releasedAt: result.releasedAt,
  };
}

export async function markLateInvalidRefundedHandler(
  ctx: MutationCtx,
  args: MarkLateInvalidRefundedArgs,
) {
  await markLateInvalidRefundedState(ctx, args);
  return null;
}

export async function recordFinancialEventHandler(
  ctx: MutationCtx,
  args: RecordFinancialEventArgs,
) {
  await appendFinancialEvent(ctx.db, args);
  return null;
}

export async function applyExternalRefundHandler(
  ctx: MutationCtx,
  args: ApplyExternalRefundArgs,
) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order || order.state !== 'completed') {
    return null;
  }

  const financial = await loadOrderFinancial(ctx.db, order._id);
  const previousRefundedAmount = financial?.refundedAmountCents ?? 0;
  const nextRefundedAmount = Math.max(
    previousRefundedAmount,
    Math.min(order.amountCents, args.refundedAmountCents),
  );

  const refundDelta = Math.max(0, nextRefundedAmount - previousRefundedAmount);
  const ledgerRefundAmountCents = args.ledgerRefundAmountCents ?? refundDelta;
  if (
    ledgerRefundAmountCents > 0 ||
    (args.stripeRefundId && args.connectedAccountNetCents !== undefined)
  ) {
    await appendFinancialEvent(ctx.db, {
      orderId: order._id,
      eventId: order.eventId,
      kind: 'payment_refunded',
      amountCents:
        ledgerRefundAmountCents > 0 ? ledgerRefundAmountCents : undefined,
      stripePaymentIntentId: order.stripePaymentIntentId,
      stripeChargeId: order.stripeChargeId,
      stripeRefundId: args.stripeRefundId,
      stripeEventId: args.stripeEventId,
      processorFeeCents: args.processorFeeCents,
      platformFeeCents: args.platformFeeCents,
      connectedAccountNetCents: args.connectedAccountNetCents,
    });
  }

  if (
    previousRefundedAmount >= args.refundedAmountCents &&
    args.ticketIdsToRefund === undefined
  ) {
    return null;
  }

  // Bounded to one order's tickets (product design: 1–10 per order).
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const orderTickets = await ctx.db
    .query('tickets')
    .withIndex('by_order', (q) => q.eq('orderId', args.orderId))
    .collect();
  orderTickets.sort((a, b) => a._creationTime - b._creationTime);

  const activeTickets = orderTickets.filter((ticket) =>
    isActiveTicketStatus(ticket.status),
  );
  const alreadyRefundedCount = orderTickets.filter((ticket) =>
    isRefundedTicketStatus(ticket.status),
  ).length;
  const ticketIdsToRefundSet = args.ticketIdsToRefund
    ? new Set(args.ticketIdsToRefund)
    : null;
  const ticketsToRefund = ticketIdsToRefundSet
    ? activeTickets.filter((ticket) => ticketIdsToRefundSet.has(ticket._id))
    : (() => {
        // Auto-selection path (external/dashboard refunds with no explicit
        // ticket list, e.g. the Stripe `charge.refunded` webhook). Only
        // `valid` tickets may be invalidated here — `used` (checked-in)
        // tickets are preserved to keep attendance records intact and to
        // avoid freeing physically-occupied inventory, mirroring the admin
        // refund path in payments/refunds.ts. Slicing from valid-only tickets
        // also caps the selection when the refunded amount exceeds the value
        // of the remaining valid tickets, so a `used` ticket is never
        // invalidated to "fill" the refund (that is only ever done via the
        // explicit forceRefundAll path, which passes ticketIdsToRefund).
        const validTickets = activeTickets.filter((ticket) =>
          isValidTicketStatus(ticket.status),
        );
        const refundableTicketCount = calculateRefundedTicketCount(
          order.amountCents,
          order.quantity,
          args.refundedAmountCents,
        );
        const newlyRefundableCount = Math.max(
          0,
          refundableTicketCount - alreadyRefundedCount,
        );
        return validTickets.slice(0, newlyRefundableCount);
      })();

  for (const ticket of ticketsToRefund) {
    await ctx.db.patch('tickets', ticket._id, {
      status: 'refunded',
      ...buildTicketRosterProjection({
        ticketId: ticket._id,
        status: 'refunded',
        attendeeName: ticket.rosterAttendeeName ?? null,
        email: ticket.rosterEmail ?? null,
        checkedInByName: ticket.rosterCheckedInByName ?? null,
      }),
    });
  }

  let event =
    order.kind === 'primary' && ticketsToRefund.length > 0
      ? await ctx.db.get('events', order.eventId)
      : null;
  if (order.kind === 'primary' && ticketsToRefund.length > 0) {
    const inventoryId = event?.inventoryId;
    if (event && inventoryId) {
      const inventory = await ctx.db.get('event_inventory', inventoryId);
      if (inventory && inventory.eventId === event._id) {
        await ctx.db.patch('event_inventory', inventory._id, {
          soldCount: Math.max(0, inventory.soldCount - ticketsToRefund.length),
        });
      }
    }
  }

  if (args.refundedBy && args.auditAction) {
    event ??= await ctx.db.get('events', order.eventId);
    await insertAdminAuditLog(ctx, {
      adminId: args.refundedBy,
      action: args.auditAction,
      eventId: order.eventId,
      organizerId: event?.organizerId,
      source: args.auditSource,
    });
  }

  return null;
}

export async function clearCheckoutSessionHandler(
  ctx: MutationCtx,
  args: ClearCheckoutSessionArgs,
) {
  const order = await ctx.db.get('ticket_orders', args.orderId);
  if (!order || order.state !== 'open') {
    return null;
  }
  await ctx.db.patch('ticket_orders', args.orderId, {
    stripeCheckoutSessionId: undefined,
  });
  return null;
}

export async function cancelOpenOrdersForEventHandler(
  ctx: MutationCtx,
  args: CancelOpenOrdersForEventArgs,
) {
  // Bounded to concurrent open holds for one event. Open orders have a
  // 30-minute TTL (ORDER_HOLD_EXPIRATION_MS) and each hold consumes
  // `event_inventory`, so the set is capped by event capacity. Silent
  // truncation here would leak inventory — we must release every hold.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const openOrders = await ctx.db
    .query('ticket_orders')
    .withIndex('by_event_and_state', (q) =>
      q.eq('eventId', args.eventId).eq('state', 'open'),
    )
    .collect();

  for (const order of openOrders) {
    await releaseOrderState(ctx.db, {
      orderId: order._id,
      reason: 'cancelled',
    });
  }

  return openOrders.length;
}
