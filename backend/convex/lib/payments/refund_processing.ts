import type {Id} from '../../_generated/dataModel';
import type {ActionCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {
  ErrorMessages,
  throwInvalidState,
  throwUnauthenticated,
  throwUnauthorized,
} from '../../lib/errors';
import {logger} from '../../lib/logger';

export interface StoredProcessorRefundResult {
  refundId: string;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
}

export async function requireRootAdminAction(
  ctx: Pick<ActionCtx, 'runQuery'>,
): Promise<Id<'users'>> {
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!userId) throwUnauthenticated();

  const isRootAdminUser = await ctx.runQuery(internal.lib.access._isRootAdmin, {
    userId,
  });
  if (!isRootAdminUser) throwUnauthorized();

  return userId;
}

/**
 * Require the authenticated caller to have refund access for the given
 * order. Refund access is granted to community admins of the organizer
 * that owns the order's event (via `_isCommunityAdminOrRoot`, which
 * also passes for platform root admins). Returns the resolved user id
 * so the caller can attribute the refund in audit logs.
 *
 * Throws UNAUTHENTICATED if no session, UNAUTHORIZED if the caller is
 * neither a community admin of the event's organizer nor a root admin,
 * and NOT_FOUND if the order or its event is missing.
 */
export async function requireRefundOrderAction(
  ctx: Pick<ActionCtx, 'runQuery'>,
  orderId: Id<'ticket_orders'>,
): Promise<Id<'users'>> {
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!userId) throwUnauthenticated();

  const organizerId = await ctx.runQuery(
    internal.payments.refunds._getOrderOrganizer,
    {orderId},
  );
  if (!organizerId) throwUnauthorized();

  const hasAccess = await ctx.runQuery(
    internal.lib.access._isCommunityAdminOrRoot,
    {userId, organizerId},
  );
  if (!hasAccess) throwUnauthorized();

  return userId;
}

/**
 * Same as `requireRefundOrderAction` but for a single-ticket refund,
 * where the caller has a ticket id instead of an order id. Resolves the
 * ticket's order, then defers to the order-level helper.
 */
export async function requireRefundTicketAction(
  ctx: Pick<ActionCtx, 'runQuery'>,
  ticketId: Id<'tickets'>,
): Promise<Id<'users'>> {
  const orderId = await ctx.runQuery(
    internal.payments.refunds._getTicketOrderId,
    {ticketId},
  );
  if (!orderId) throwUnauthorized();
  return requireRefundOrderAction(ctx, orderId);
}

/**
 * Resolve the Stripe Connect information for a direct-charge refund.
 *
 * Under Accounts V2 direct charges the PaymentIntent and Charge both live
 * on the **connected account**, so refunds must pass
 * `{stripeAccount: connectedAccountId}`. The order's snapshotted
 * `connectedAccountId` (written at order creation in Task 4) is the SSOT
 * — reading it from the current organizer would be wrong if the organizer
 * rotated or offboarded their Stripe account since the charge.
 *
 * Platform-organizer orders store `connectedAccountId: undefined` and
 * resolve as non-Connect payments here.
 */
export async function resolveStripeConnectInfo(
  ctx: Pick<ActionCtx, 'runQuery'>,
  orderId: Id<'ticket_orders'>,
): Promise<{
  isConnectPayment: boolean;
  connectedAccountId: string | null;
}> {
  const order = await ctx.runQuery(internal.orders.core.getInternal, {orderId});
  if (!order?.connectedAccountId) {
    return {isConnectPayment: false, connectedAccountId: null};
  }
  return {
    isConnectPayment: true,
    connectedAccountId: order.connectedAccountId,
  };
}

export async function executeStoredProcessorRefund(
  ctx: Pick<ActionCtx, 'runAction' | 'runQuery'>,
  args: {
    stripePaymentIntentId: string;
    stripeIdempotencyKey: string;
    /**
     * Order receiving the refund. Drives the `connectedAccountId`
     * snapshot so the refund routes through the correct Stripe account.
     * Resale seller refunds pass the SELLER's original order id so the
     * refund lands on the seller's connected account, not the buyer's.
     */
    orderId: Id<'ticket_orders'>;
    amountCents: number;
    reason: string;
    loggerScope?: string;
    failureLogLabel?: string;
    failureMessage?: string;
  },
): Promise<StoredProcessorRefundResult> {
  if (!args.stripePaymentIntentId) {
    logger.error(
      args.loggerScope ?? 'payments',
      'Stripe refund aborted because the payment is missing a Stripe payment intent.',
    );
    throwInvalidState(
      ErrorMessages.INVALID_STATE('payment cannot be refunded'),
    );
  }

  // Direct charges: the PI lives on the connected account, so the refund
  // goes through `{stripeAccount}` on that account. Platform charges
  // (platform-organizer orders) refund on the platform account directly
  // — we omit `connectedAccountId` from the action args entirely in that
  // case so the value never has to be normalized downstream.
  const connectInfo = await resolveStripeConnectInfo(ctx, args.orderId);
  const result = await ctx.runAction(
    internal.stripe.actions.processStripeRefund,
    {
      paymentIntentId: args.stripePaymentIntentId,
      amountCents: args.amountCents,
      reason: args.reason,
      idempotencyKey: args.stripeIdempotencyKey,
      ...(connectInfo.connectedAccountId
        ? {connectedAccountId: connectInfo.connectedAccountId}
        : {}),
      // Per design spec, always refund the application fee on Connect
      // payments so the connected account is credited back its portion.
      refundApplicationFee: connectInfo.isConnectPayment,
    },
  );
  return {
    refundId: result.refundId,
    ...(result.processorFeeCents !== undefined
      ? {processorFeeCents: result.processorFeeCents}
      : {}),
    ...(result.platformFeeCents !== undefined
      ? {platformFeeCents: result.platformFeeCents}
      : {}),
    ...(result.connectedAccountNetCents !== undefined
      ? {connectedAccountNetCents: result.connectedAccountNetCents}
      : {}),
  };
}
