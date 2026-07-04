'use node';

/* eslint-disable @convex-dev/import-wrong-runtime -- Stripe action implementations run in the Node runtime and compose Node-only Stripe helpers. */

import type Stripe from 'stripe';
import type {ActionCtx} from '../../_generated/server';
import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {FunctionReturnType} from 'convex/server';
import type {CheckoutThemeMode} from '../../lib/orders/validators';
import {logger} from '../../lib/logger';
import {withRetry} from '../../lib/resilience';
import {
  ORDER_HOLD_EXPIRATION_MS,
  PAYOUT_BATCH_SIZE,
  PAYOUT_DELAY_MS,
  STRIPE_CHECKOUT_EXPIRY_BUFFER_MS,
} from '../../lib/constants';
import {
  ErrorMessages,
  throwAppError,
  throwInvalidInput,
  throwInvalidState,
  throwNotFound,
  throwUnauthenticated,
  throwUnauthorized,
} from '../../lib/errors';
import {throwPaymentAppError} from '../../lib/payment_errors';
import {isTestEnvironment, isUnitTestRuntime} from '../../lib/environment';
import {resolveSiteUrl} from '../../lib/site_url';
import {summarizeStripeError} from '../../lib/stripe';
import {
  extractOrderIdFromCheckoutSession,
  getStripeClient,
} from '../../lib/stripe_node';
import {
  getOrganizerChargeReadiness,
  isOrganizerChargeReady,
  isOrganizerPayoutReady,
} from '../../lib/stripe_connect_state';
import {
  createAccountSession as createAccountSessionSdk,
  createV2AccountOnboardingLink,
  createV2ConnectedAccount,
  ensureManualPayoutSettings,
  ensurePaymentMethodDomain,
  checkConnectedAccountStatus,
} from './accounts';
import {
  createDirectChargeCheckoutSession,
  createPlatformCheckoutSession,
  hasCurrentCheckoutBranding,
} from './checkout';
import {
  buildPayoutPlan,
  computeEventSettlements,
  computeLedgerTrustGate,
} from './payouts';
import {
  extractBalanceTransactionLedgerFields,
  isChargeBalanceTransactionUnavailableError,
  recordPaymentCaptured,
  resolveExpandedBalanceTransaction,
} from './settlement';
import type {OnboardingStatus} from '../../lib/validators/stripe_connect';
import {dispatchStripeEvent} from './webhook_dispatch';
import {
  resolveCallerIdentityAction,
  type CallerIdentity,
} from '../../lib/caller_identity';

type TicketOrderDoc = Doc<'ticket_orders'>;
type StripeOrganizer = NonNullable<
  FunctionReturnType<typeof internal.stripe.connect.getOrganizerInternal>
>;
type StripeConnectedOrganizer = StripeOrganizer & {
  stripeConnectedAccountId: string;
};
type OrganizerCheckoutReadinessFailure = Exclude<
  ReturnType<typeof getOrganizerChargeReadiness>,
  {ok: true}
>['code'];

const REFUND_BALANCE_TRANSACTION_MAX_ATTEMPTS = 4;
const REFUND_BALANCE_TRANSACTION_INITIAL_BACKOFF_MS = 500;

export type TicketOrderCheckoutSessionResult = {
  orderId: Id<'ticket_orders'>;
  clientSecret: string;
  stripeCheckoutSessionId: string;
  expiresAt: number;
  connectedAccountId: string | null;
};

export type TicketOrderCheckoutStatus = {
  orderId: Id<'ticket_orders'>;
  state: 'open' | 'completed' | 'released';
  kind: 'primary' | 'resale';
  expiresAt: number;
  completedAt?: number;
  releasedAt?: number;
};

function toTicketOrderCheckoutStatus(
  order: TicketOrderDoc,
): TicketOrderCheckoutStatus {
  return {
    orderId: order._id,
    state: order.state,
    kind: order.kind,
    expiresAt: order.expiresAt,
    completedAt: order.completedAt,
    releasedAt: order.releasedAt,
  };
}

function assertOrderOwnership(
  identity: CallerIdentity,
  order: {
    userId?: Id<'users'>;
    guestSessionId?: Id<'guest_sessions'>;
  },
): void {
  const ownsOrder =
    identity.type === 'user'
      ? order.userId === identity.userId
      : order.guestSessionId === identity.guestSessionId;
  if (!ownsOrder) {
    throwUnauthorized();
  }
}

async function resolveOwnedOrderForCheckout(
  ctx: ActionCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    sessionToken?: string;
  },
): Promise<{
  identity: CallerIdentity;
  order: TicketOrderDoc;
}> {
  const identity = await resolveCallerIdentityAction(ctx, args.sessionToken);
  const order = await ctx.runQuery(internal.orders.core.getInternal, {
    orderId: args.orderId,
  });
  if (!order) {
    throwNotFound('Order');
  }
  assertOrderOwnership(identity, order);
  return {identity, order};
}

async function resolveStripeCallerUserId(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await ctx.runQuery(
    internal.lib.auth_helpers.getAuthUserIdInternal,
    {},
  );
  if (!userId) {
    throwUnauthenticated();
  }
  return userId;
}

async function requireStripeOrganizerAccess(
  ctx: ActionCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  const canManageCommunity = await ctx.runQuery(
    internal.lib.access._isCommunityAdminOrRoot,
    {userId, organizerId},
  );
  if (!canManageCommunity) {
    throwUnauthorized();
  }
}

async function requireStripeOrganizer(
  ctx: ActionCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<StripeOrganizer> {
  const organizer = await ctx.runQuery(
    internal.stripe.connect.getOrganizerInternal,
    {organizerId},
  );
  if (!organizer) {
    throwNotFound('Organizer');
  }
  await requireStripeOrganizerAccess(ctx, userId, organizerId);
  return organizer;
}

async function requireStripeConnectedOrganizer(
  ctx: ActionCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<StripeConnectedOrganizer> {
  const organizer = await requireStripeOrganizer(ctx, userId, organizerId);
  if (!organizer.stripeConnectedAccountId) {
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'organizer does not have a Stripe account — create one first',
      ),
    );
  }
  return {
    ...organizer,
    stripeConnectedAccountId: organizer.stripeConnectedAccountId,
  };
}

async function resolveOrderFromCheckoutSession(
  ctx: ActionCtx,
  checkoutSessionId: string,
): Promise<TicketOrderDoc | null> {
  const direct = await ctx.runQuery(
    internal.orders.core.getByCheckoutSessionId,
    {
      stripeCheckoutSessionId: checkoutSessionId,
    },
  );
  if (direct) {
    return direct;
  }
  return null;
}

function getCheckoutSessionClientSecret(
  session: Stripe.Checkout.Session,
): string {
  if (!session.client_secret) {
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'checkout session did not include an embedded client secret',
      ),
    );
  }
  return session.client_secret;
}

function paymentSetupMessage(code: OrganizerCheckoutReadinessFailure): string {
  return code === 'ORGANIZER_STRIPE_NOT_CONNECTED'
    ? 'Organizer has not connected a Stripe account.'
    : code === 'ORGANIZER_STRIPE_CHARGES_DISABLED'
      ? 'Organizer Stripe account is not enabled for charges yet.'
      : 'Organizer Stripe account onboarding is incomplete.';
}

async function refreshConnectedOrganizerForCheckout(
  ctx: ActionCtx,
  organizer: StripeOrganizer,
): Promise<StripeOrganizer> {
  if (organizer.isPlatformOrganizer || !organizer.stripeConnectedAccountId) {
    return organizer;
  }

  const stripeConnectedAccountId = organizer.stripeConnectedAccountId;
  let status: Awaited<ReturnType<typeof checkConnectedAccountStatus>>;
  try {
    status = await withRetry(
      () => checkConnectedAccountStatus(stripeConnectedAccountId),
      {
        onRetry: (attempt, error) => {
          logger.warn(
            'stripe',
            `Checkout account status refresh retry ${attempt}`,
            summarizeStripeError(error),
            {stripeConnectedAccountId},
          );
        },
      },
    );
  } catch (error: unknown) {
    logger.error(
      'stripe',
      'Checkout account status refresh failed',
      summarizeStripeError(error),
      {stripeConnectedAccountId},
    );
    await ctx.runMutation(
      internal.stripe.connect.updateOrganizerFromStripeAccount,
      {
        stripeConnectedAccountId,
        onboardingStatus: 'in_progress',
        chargesEnabled: false,
        payoutsEnabled: false,
        currentlyDue: ['Unable to verify Stripe account status'],
      },
    );
    return {
      ...organizer,
      stripeOnboardingStatus: 'in_progress',
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeCurrentlyDue: ['Unable to verify Stripe account status'],
    };
  }

  await ctx.runMutation(
    internal.stripe.connect.updateOrganizerFromStripeAccount,
    {
      stripeConnectedAccountId,
      onboardingStatus: status.onboardingStatus,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      currentlyDue: status.currentlyDue,
    },
  );

  return {
    ...organizer,
    stripeOnboardingStatus: status.onboardingStatus,
    stripeChargesEnabled: status.chargesEnabled,
    stripePayoutsEnabled: status.payoutsEnabled,
    stripeCurrentlyDue: status.currentlyDue,
  };
}

async function releaseCheckoutOrderForRestart(
  ctx: ActionCtx,
  orderId: Id<'ticket_orders'>,
  failure: {
    errorCode: string;
    failureStage: 'account_setup' | 'checkout_session';
  },
): Promise<void> {
  await ctx.runMutation(internal.orders.core.releaseForPaymentFailure, {
    orderId,
    errorCode: failure.errorCode,
    failureStage: failure.failureStage,
  });
}

export async function startTicketOrderCheckoutSessionImpl(
  ctx: ActionCtx,
  args: {
    orderId: Id<'ticket_orders'>;
    checkoutTheme?: CheckoutThemeMode;
    sessionToken?: string;
  },
): Promise<TicketOrderCheckoutSessionResult> {
  const {identity, order} = await resolveOwnedOrderForCheckout(ctx, args);
  const checkoutTheme = args.checkoutTheme ?? 'light';
  if (order.state !== 'open') {
    throwPaymentAppError(
      'ORDER_NOT_OPEN',
      'This reservation is no longer open',
    );
  }
  if (order.expiresAt <= Date.now()) {
    throwPaymentAppError('RESERVATION_EXPIRED', 'This reservation has expired');
  }

  const safeExpiresAtMs = Math.max(
    order.expiresAt,
    Date.now() + ORDER_HOLD_EXPIRATION_MS + STRIPE_CHECKOUT_EXPIRY_BUFFER_MS,
  );
  const orderConnectedAccountId = order.connectedAccountId ?? null;

  if (order.stripeCheckoutSessionId) {
    const checkoutSessionId = order.stripeCheckoutSessionId;
    if (isTestEnvironment()) {
      return {
        orderId: order._id,
        clientSecret: `${checkoutSessionId}_secret_mock`,
        stripeCheckoutSessionId: checkoutSessionId,
        expiresAt: safeExpiresAtMs,
        connectedAccountId: orderConnectedAccountId,
      };
    }

    const stripe = getStripeClient();
    const retrieveOptions: Stripe.RequestOptions | undefined =
      orderConnectedAccountId
        ? {stripeAccount: orderConnectedAccountId}
        : undefined;
    const existingSession: Stripe.Response<Stripe.Checkout.Session> =
      await withRetry(
        (): Promise<Stripe.Response<Stripe.Checkout.Session>> =>
          stripe.checkout.sessions.retrieve(
            checkoutSessionId,
            {},
            retrieveOptions,
          ),
        {
          onRetry: (attempt, error) => {
            logger.warn(
              'stripe',
              `Checkout session retrieve retry ${attempt}`,
              error,
            );
          },
        },
      );

    if (existingSession.status === 'expired') {
      await ctx.runMutation(internal.orders.core.clearCheckoutSession, {
        orderId: order._id,
      });
    } else if (existingSession.status !== 'open') {
      throwPaymentAppError(
        'INVALID_STATE',
        'This checkout session is no longer available',
      );
    } else if (!hasCurrentCheckoutBranding(existingSession, checkoutTheme)) {
      await stripe.checkout.sessions.expire(
        existingSession.id,
        {},
        retrieveOptions,
      );
      await ctx.runMutation(internal.orders.core.clearCheckoutSession, {
        orderId: order._id,
      });
    } else {
      return {
        orderId: order._id,
        clientSecret: getCheckoutSessionClientSecret(existingSession),
        stripeCheckoutSessionId: existingSession.id,
        expiresAt: safeExpiresAtMs,
        connectedAccountId: orderConnectedAccountId,
      };
    }
  }

  const event = await ctx.runQuery(internal.events.management.getInternal, {
    id: order.eventId,
  });
  if (!event) {
    throwNotFound('Event');
  }
  if (event.status === 'cancelled') {
    throwPaymentAppError(
      'EVENT_UNAVAILABLE',
      'This event is no longer available for checkout',
    );
  }

  if (isTestEnvironment()) {
    const mockSessionId = `cs_test_${order._id}_${Date.now()}`;
    await ctx.runMutation(internal.orders.core.bindCheckoutSession, {
      orderId: order._id,
      stripeCheckoutSessionId: mockSessionId,
      expiresAt: safeExpiresAtMs,
    });
    return {
      orderId: order._id,
      clientSecret: `${mockSessionId}_secret_mock`,
      stripeCheckoutSessionId: mockSessionId,
      expiresAt: safeExpiresAtMs,
      connectedAccountId: orderConnectedAccountId,
    };
  }

  const loadedOrganizer = await ctx.runQuery(
    internal.stripe.connect.getOrganizerInternal,
    {
      organizerId: event.organizerId,
    },
  );
  if (!loadedOrganizer) {
    throwNotFound('Organizer');
  }
  const organizer = await refreshConnectedOrganizerForCheckout(
    ctx,
    loadedOrganizer,
  );

  const checkoutMetadata = {
    orderId: order._id,
    kind: order.kind,
    eventId: order.eventId,
  };
  const ticketDescription =
    order.kind === 'resale'
      ? `${order.tier} resale ticket`
      : `${order.tier} ticket`;

  const sessionResult = await withRetry(
    async () => {
      if (organizer.isPlatformOrganizer) {
        if (orderConnectedAccountId !== null) {
          await releaseCheckoutOrderForRestart(ctx, order._id, {
            errorCode: 'connected_account_mismatch',
            failureStage: 'checkout_session',
          });
          throwPaymentAppError(
            'ORDER_CONNECTED_ACCOUNT_MISMATCH',
            'Order was opened under a different Stripe account. Please restart checkout.',
          );
        }
        return createPlatformCheckoutSession({
          orderId: order._id,
          amountCents: order.amountCents,
          quantity: order.quantity,
          checkoutTheme,
          eventName: event.title,
          ticketDescription,
          buyerEmail: identity.email,
          expiresAtMs: safeExpiresAtMs,
          metadata: checkoutMetadata,
        });
      }

      const readiness = getOrganizerChargeReadiness(organizer);
      if (!readiness.ok) {
        await releaseCheckoutOrderForRestart(ctx, order._id, {
          errorCode: readiness.code.toLowerCase(),
          failureStage: 'account_setup',
        });
        throwPaymentAppError(
          readiness.code,
          paymentSetupMessage(readiness.code),
        );
      }
      if (organizer.stripeConnectedAccountId !== orderConnectedAccountId) {
        await releaseCheckoutOrderForRestart(ctx, order._id, {
          errorCode: 'connected_account_mismatch',
          failureStage: 'checkout_session',
        });
        throwPaymentAppError(
          'ORDER_CONNECTED_ACCOUNT_MISMATCH',
          'Order was opened under a different Stripe account. Please restart checkout.',
        );
      }

      return createDirectChargeCheckoutSession({
        connectedAccountId: organizer.stripeConnectedAccountId,
        orderId: order._id,
        amountCents: order.amountCents,
        quantity: order.quantity,
        checkoutTheme,
        eventName: event.title,
        ticketDescription,
        buyerEmail: identity.email,
        expiresAtMs: safeExpiresAtMs,
        metadata: checkoutMetadata,
      });
    },
    {
      onRetry: (attempt, error) => {
        logger.warn(
          'stripe',
          `Checkout session create retry ${attempt}`,
          summarizeStripeError(error),
        );
      },
    },
  );

  await ctx.runMutation(internal.orders.core.bindCheckoutSession, {
    orderId: order._id,
    stripeCheckoutSessionId: sessionResult.checkoutSessionId,
    expiresAt: safeExpiresAtMs,
  });

  return {
    orderId: order._id,
    clientSecret: sessionResult.clientSecret,
    stripeCheckoutSessionId: sessionResult.checkoutSessionId,
    expiresAt: safeExpiresAtMs,
    connectedAccountId: orderConnectedAccountId,
  };
}

export async function syncTicketOrderCheckoutSessionImpl(
  ctx: ActionCtx,
  args: {
    checkoutSessionId: string;
    sessionToken?: string;
  },
): Promise<TicketOrderCheckoutStatus> {
  const identity = await resolveCallerIdentityAction(ctx, args.sessionToken);

  let order = await resolveOrderFromCheckoutSession(
    ctx,
    args.checkoutSessionId,
  );

  if (isTestEnvironment()) {
    if (!order) {
      throwNotFound('Order');
    }
    assertOrderOwnership(identity, order);
    if (order.state === 'open') {
      await ctx.runAction(internal.orders.core.settlePaidOrderFromStripe, {
        orderId: order._id,
        stripePaymentIntentId: `pi_test_${args.checkoutSessionId}`,
        stripeChargeId: `ch_test_${args.checkoutSessionId}`,
        note: 'checkout_session_sync_test',
      });
    }
    const currentOrder = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId: order._id,
    });
    if (!currentOrder) {
      throwNotFound('Order');
    }
    return toTicketOrderCheckoutStatus(currentOrder);
  }

  if (order) {
    assertOrderOwnership(identity, order);
    if (order.state === 'completed') {
      return toTicketOrderCheckoutStatus(order);
    }
  }

  const connectedAccountId = order?.connectedAccountId ?? undefined;
  const stripe = getStripeClient();
  const session: Stripe.Response<Stripe.Checkout.Session> = await withRetry(
    (): Promise<Stripe.Response<Stripe.Checkout.Session>> =>
      stripe.checkout.sessions.retrieve(
        args.checkoutSessionId,
        {expand: ['payment_intent.latest_charge.balance_transaction']},
        connectedAccountId ? {stripeAccount: connectedAccountId} : {},
      ),
    {
      onRetry: (attempt, error) => {
        logger.warn('stripe', `Checkout session sync retry ${attempt}`, error);
      },
    },
  );

  const orderIdCandidate = extractOrderIdFromCheckoutSession(session);
  if (!order && orderIdCandidate) {
    const orderId = await ctx.runQuery(
      internal.orders.core.normalizeTicketOrderId,
      {candidate: orderIdCandidate},
    );
    if (orderId) {
      order = await ctx.runQuery(internal.orders.core.getInternal, {orderId});
    }
  }
  if (!order) {
    throwNotFound('Order');
  }
  assertOrderOwnership(identity, order);

  if (!order.stripeCheckoutSessionId) {
    await ctx.runMutation(internal.orders.core.bindCheckoutSession, {
      orderId: order._id,
      stripeCheckoutSessionId: session.id,
    });
    order = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId: order._id,
    });
    if (!order) {
      throwNotFound('Order');
    }
  }

  if (session.payment_status === 'paid') {
    const paymentIntent =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    const latestCharge =
      typeof session.payment_intent === 'object' &&
      session.payment_intent !== null &&
      typeof session.payment_intent.latest_charge === 'object' &&
      session.payment_intent.latest_charge !== null
        ? session.payment_intent.latest_charge.id
        : typeof session.payment_intent === 'object' &&
            session.payment_intent !== null &&
            typeof session.payment_intent.latest_charge === 'string'
          ? session.payment_intent.latest_charge
          : undefined;

    await ctx.runAction(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order._id,
      stripePaymentIntentId: paymentIntent,
      stripeChargeId: latestCharge,
      note: 'checkout_session_sync',
    });

    if (paymentIntent && latestCharge) {
      const settledOrder = await ctx.runQuery(
        internal.orders.core.getInternal,
        {
          orderId: order._id,
        },
      );
      if (settledOrder && settledOrder.state === 'completed') {
        try {
          await recordPaymentCaptured({
            ctx,
            stripe,
            orderId: order._id,
            eventId: settledOrder.eventId,
            stripePaymentIntentId: paymentIntent,
            stripeChargeId: latestCharge,
            connectedAccountId,
          });
        } catch (error: unknown) {
          if (!isChargeBalanceTransactionUnavailableError(error)) {
            throw error;
          }
          logger.warn(
            'stripe',
            'checkout session sync deferred payment_captured ledger; balance_transaction unavailable',
            {
              orderId: order._id,
              paymentIntentId: paymentIntent,
              chargeId: latestCharge,
            },
          );
        }
      }
    }
  } else if (session.status === 'expired') {
    await ctx.runMutation(internal.orders.core.expire, {
      orderId: order._id,
      force: true,
    });
  }

  const currentOrder: TicketOrderDoc | null = await ctx.runQuery(
    internal.orders.core.getInternal,
    {
      orderId: order._id,
    },
  );
  if (!currentOrder) {
    throwNotFound('Order');
  }

  return {
    orderId: currentOrder._id,
    state: currentOrder.state,
    kind: currentOrder.kind,
    expiresAt: currentOrder.expiresAt,
    completedAt: currentOrder.completedAt,
    releasedAt: currentOrder.releasedAt,
  };
}

export async function processStripeRefundImpl(
  _ctx: ActionCtx,
  args: {
    paymentIntentId: string;
    amountCents: number;
    reason?: string;
    idempotencyKey: string;
    connectedAccountId?: string;
    refundApplicationFee?: boolean;
  },
): Promise<{
  success: boolean;
  refundId: string;
  processorFeeCents?: number;
  platformFeeCents?: number;
  connectedAccountNetCents?: number;
}> {
  if (args.amountCents <= 0) {
    throwInvalidInput('Refund amount must be greater than zero');
  }

  if (isTestEnvironment()) {
    return {
      success: true,
      refundId: `re_mock_${args.idempotencyKey}`,
    };
  }

  const stripe = getStripeClient();
  const refundParams: Stripe.RefundCreateParams = {
    payment_intent: args.paymentIntentId,
    amount: args.amountCents,
    expand: ['balance_transaction'],
    ...(args.reason ? {reason: 'requested_by_customer' as const} : {}),
    ...(args.refundApplicationFee ? {refund_application_fee: true} : {}),
  };
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: args.idempotencyKey,
    ...(args.connectedAccountId
      ? {stripeAccount: args.connectedAccountId}
      : {}),
  };
  const readOptions: Stripe.RequestOptions | undefined = args.connectedAccountId
    ? {stripeAccount: args.connectedAccountId}
    : undefined;

  const refund: Stripe.Refund = await withRetry(
    () => stripe.refunds.create(refundParams, requestOptions),
    {
      onRetry: (attempt, error) => {
        logger.warn('stripe', `Refund create retry ${attempt}`, error);
      },
    },
  );
  let balanceTransaction = resolveExpandedBalanceTransaction(
    refund.balance_transaction,
  );
  if (!balanceTransaction) {
    balanceTransaction = await retrieveRefundBalanceTransaction(
      stripe,
      refund.id,
      readOptions,
    );
  }
  const ledgerFields =
    extractBalanceTransactionLedgerFields(balanceTransaction);

  return {
    success: true,
    refundId: refund.id,
    processorFeeCents: ledgerFields.processorFeeCents,
    platformFeeCents: ledgerFields.platformFeeCents,
    connectedAccountNetCents: ledgerFields.connectedAccountNetCents,
  };
}

async function retrieveRefundBalanceTransaction(
  stripe: Stripe,
  refundId: string,
  requestOptions: Stripe.RequestOptions | undefined,
): Promise<Stripe.BalanceTransaction> {
  try {
    return await withRetry(
      async () => {
        const refund = await stripe.refunds.retrieve(
          refundId,
          {expand: ['balance_transaction']},
          requestOptions,
        );
        const balanceTransaction = resolveExpandedBalanceTransaction(
          refund.balance_transaction,
        );
        if (!balanceTransaction) {
          throw new Error('Refund balance transaction is not available yet');
        }
        return balanceTransaction;
      },
      {
        maxAttempts: REFUND_BALANCE_TRANSACTION_MAX_ATTEMPTS,
        initialBackoffMs: REFUND_BALANCE_TRANSACTION_INITIAL_BACKOFF_MS,
        onRetry: (attempt, error) => {
          logger.warn(
            'stripe',
            `Refund balance transaction retrieve retry ${attempt}`,
            {refundId, error},
          );
        },
      },
    );
  } catch (error: unknown) {
    logger.warn('stripe', 'Refund balance transaction unavailable', {
      refundId,
      error,
    });
    throwInvalidState(
      ErrorMessages.INVALID_STATE(
        'refund balance transaction is not available yet',
      ),
    );
  }
}

export async function createConnectedAccountImpl(
  ctx: ActionCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<{stripeConnectedAccountId: string; alreadyExists: boolean}> {
  const userId = await resolveStripeCallerUserId(ctx);
  const organizer = await requireStripeOrganizer(ctx, userId, args.organizerId);

  if (isTestEnvironment() && !isUnitTestRuntime()) {
    const existing = organizer.stripeConnectedAccountId;
    const connectedAccountId = existing ?? `acct_test_${args.organizerId}`;
    if (!existing) {
      await ctx.runMutation(internal.stripe.connect.storeConnectedAccountId, {
        organizerId: args.organizerId,
        stripeConnectedAccountId: connectedAccountId,
        onboardingStatus: 'payout_settings_pending',
      });
    }
    await ctx.runMutation(internal.stripe.connect.markPayoutSettingsVerified, {
      organizerId: args.organizerId,
      stripeConnectedAccountId: connectedAccountId,
    });
    return {
      stripeConnectedAccountId: connectedAccountId,
      alreadyExists: !!existing,
    };
  }

  const existingAccountId = organizer.stripeConnectedAccountId;
  let connectedAccountId: string;
  let alreadyExists: boolean;

  if (existingAccountId) {
    connectedAccountId = existingAccountId;
    alreadyExists = true;
  } else {
    const created = await withRetry(
      () =>
        createV2ConnectedAccount({
          organizerId: args.organizerId,
          contactEmail: organizer.email ?? 'promoter@braket.gay',
          displayName: organizer.name,
        }),
      {
        onRetry: (attempt, error) => {
          logger.warn(
            'stripe',
            `V2 account create retry ${attempt}`,
            summarizeStripeError(error),
          );
        },
      },
    );
    connectedAccountId = created.accountId;
    alreadyExists = false;

    await ctx.runMutation(internal.stripe.connect.storeConnectedAccountId, {
      organizerId: args.organizerId,
      stripeConnectedAccountId: connectedAccountId,
      onboardingStatus: 'payout_settings_pending',
    });
  }

  const {payoutScheduleVerified} = await withRetry(
    () => ensureManualPayoutSettings(connectedAccountId),
    {
      onRetry: (attempt, error) => {
        logger.warn(
          'stripe',
          `Manual payout settings retry ${attempt}`,
          summarizeStripeError(error),
        );
      },
    },
  );
  if (!payoutScheduleVerified) {
    throwAppError(
      'STRIPE_PAYOUT_SETTINGS_NOT_VERIFIED',
      'Stripe account was created, but manual payout schedule was not verified.',
    );
  }

  await ctx.runMutation(internal.stripe.connect.markPayoutSettingsVerified, {
    organizerId: args.organizerId,
    stripeConnectedAccountId: connectedAccountId,
  });

  // Register the platform domain on the connected account so Apple Pay and
  // Google Pay appear in Embedded Checkout for direct-charge sessions.
  // Non-blocking: wallet payments are a nice-to-have, not a gate.
  const siteUrl = resolveSiteUrl();
  const hostname = new URL(siteUrl).hostname;
  if (hostname !== 'localhost' && !hostname.startsWith('127.')) {
    try {
      const {applePayStatus, googlePayStatus} = await withRetry(
        () => ensurePaymentMethodDomain(connectedAccountId, hostname),
        {
          onRetry: (attempt, error) => {
            logger.warn(
              'stripe',
              `Payment method domain registration retry ${attempt}`,
              summarizeStripeError(error),
            );
          },
        },
      );
      if (applePayStatus !== 'active' || googlePayStatus !== 'active') {
        logger.warn(
          'stripe',
          `Payment method domain registered but not fully active: apple_pay=${applePayStatus}, google_pay=${googlePayStatus}`,
        );
      }
    } catch (error) {
      logger.warn(
        'stripe',
        'Payment method domain registration failed — wallet payments may not appear for this account',
        summarizeStripeError(error),
      );
    }
  }

  return {stripeConnectedAccountId: connectedAccountId, alreadyExists};
}

export async function createAccountSessionImpl(
  ctx: ActionCtx,
  args: {
    organizerId: Id<'organizers'>;
    components: {
      accountOnboarding?: boolean;
      accountManagement?: boolean;
      notificationBanner?: boolean;
      payments?: boolean;
      balances?: boolean;
      documents?: boolean;
    };
  },
): Promise<{clientSecret: string}> {
  const userId = await resolveStripeCallerUserId(ctx);
  const organizer = await requireStripeConnectedOrganizer(
    ctx,
    userId,
    args.organizerId,
  );

  if (isTestEnvironment() && !isUnitTestRuntime()) {
    return {clientSecret: `connect_mock_${args.organizerId}`};
  }

  return await withRetry(
    () =>
      createAccountSessionSdk({
        connectedAccountId: organizer.stripeConnectedAccountId,
        components: args.components,
      }),
    {
      onRetry: (attempt, error) => {
        logger.warn(
          'stripe',
          `Account session create retry ${attempt}`,
          summarizeStripeError(error),
        );
      },
    },
  );
}

export async function createAccountOnboardingLinkImpl(
  ctx: ActionCtx,
  args: {organizerId: Id<'organizers'>; returnOrigin?: string},
): Promise<{url: string}> {
  const userId = await resolveStripeCallerUserId(ctx);
  const organizer = await requireStripeConnectedOrganizer(
    ctx,
    userId,
    args.organizerId,
  );

  if (isTestEnvironment() && !isUnitTestRuntime()) {
    return {url: `https://stripe.mock/onboard/${args.organizerId}`};
  }

  const baseUrl = resolveStripeReturnBaseUrl(args.returnOrigin);
  const returnUrl = `${baseUrl}/community-admin/settings?community=${args.organizerId}&stripeOnboardingReturn=1`;
  const refreshUrl = `${baseUrl}/community-admin/settings?community=${args.organizerId}&stripeOnboardingRefresh=1`;

  return await withRetry(
    () =>
      createV2AccountOnboardingLink({
        connectedAccountId: organizer.stripeConnectedAccountId,
        returnUrl,
        refreshUrl,
      }),
    {
      onRetry: (attempt, error) => {
        logger.warn(
          'stripe',
          `Account onboarding link create retry ${attempt}`,
          summarizeStripeError(error),
        );
      },
    },
  );
}

function resolveStripeReturnBaseUrl(returnOrigin: string | undefined): string {
  const configuredSiteUrl = resolveSiteUrl();
  if (!returnOrigin) {
    return configuredSiteUrl;
  }

  try {
    const configuredUrl = new URL(configuredSiteUrl);
    const requestedUrl = new URL(returnOrigin);
    if (
      requestedUrl.protocol === 'https:' &&
      isSameSiteHostname(requestedUrl.hostname, configuredUrl.hostname)
    ) {
      return requestedUrl.origin;
    }
    if (requestedUrl.origin === configuredUrl.origin)
      return requestedUrl.origin;
    if (isTrustedLocalReturnOrigin(requestedUrl)) return requestedUrl.origin;
  } catch {
    // Fall through to the configured URL for malformed client input.
  }

  logger.warn('stripe', 'Ignoring untrusted Stripe onboarding return origin', {
    returnOrigin,
  });
  return configuredSiteUrl;
}

function isSameSiteHostname(
  requestedHostname: string,
  configuredHostname: string,
): boolean {
  const requested = stripWww(requestedHostname.toLowerCase());
  const configured = stripWww(configuredHostname.toLowerCase());
  return (
    requested === configured ||
    requested.endsWith(`.${configured}`) ||
    configured.endsWith(`.${requested}`)
  );
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

function isTrustedLocalReturnOrigin(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (!['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase())) {
    return false;
  }
  return (
    process.env.ALLOW_LOCALHOST_CORS === 'true' ||
    isTestEnvironment() ||
    isUnitTestRuntime()
  );
}

export async function checkAccountStatusImpl(
  ctx: ActionCtx,
  args: {organizerId: Id<'organizers'>},
): Promise<{
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  userRequirementsClear: boolean;
  onboardingStatus: OnboardingStatus;
  currentlyDue: string[];
  chargeReady: boolean;
  payoutReady: boolean;
}> {
  const userId = await resolveStripeCallerUserId(ctx);
  const organizer = await requireStripeConnectedOrganizer(
    ctx,
    userId,
    args.organizerId,
  );

  if (isTestEnvironment() && !isUnitTestRuntime()) {
    await ctx.runMutation(
      internal.stripe.connect.updateOrganizerFromStripeAccount,
      {
        stripeConnectedAccountId: organizer.stripeConnectedAccountId,
        onboardingStatus: 'complete',
        chargesEnabled: true,
        payoutsEnabled: true,
        currentlyDue: [],
      },
    );
    const virtualOrganizer = {
      isPlatformOrganizer: organizer.isPlatformOrganizer ?? false,
      stripeConnectedAccountId: organizer.stripeConnectedAccountId,
      stripeOnboardingStatus: 'complete' as const,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    };
    return {
      chargesEnabled: true,
      payoutsEnabled: true,
      userRequirementsClear: true,
      onboardingStatus: 'complete',
      currentlyDue: [],
      chargeReady: isOrganizerChargeReady(virtualOrganizer),
      payoutReady: isOrganizerPayoutReady(virtualOrganizer),
    };
  }

  const status = await withRetry(
    () => checkConnectedAccountStatus(organizer.stripeConnectedAccountId),
    {
      onRetry: (attempt, error) => {
        logger.warn(
          'stripe',
          `V2 account retrieve retry ${attempt}`,
          summarizeStripeError(error),
        );
      },
    },
  );

  await ctx.runMutation(
    internal.stripe.connect.updateOrganizerFromStripeAccount,
    {
      stripeConnectedAccountId: organizer.stripeConnectedAccountId,
      onboardingStatus: status.onboardingStatus,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      currentlyDue: status.currentlyDue,
    },
  );

  const virtualOrganizer = {
    isPlatformOrganizer: organizer.isPlatformOrganizer ?? false,
    stripeConnectedAccountId: organizer.stripeConnectedAccountId,
    stripeOnboardingStatus: status.onboardingStatus,
    stripeChargesEnabled: status.chargesEnabled,
    stripePayoutsEnabled: status.payoutsEnabled,
  };

  return {
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
    userRequirementsClear: status.userRequirementsClear,
    onboardingStatus: status.onboardingStatus,
    currentlyDue: status.currentlyDue,
    chargeReady: isOrganizerChargeReady(virtualOrganizer),
    payoutReady: isOrganizerPayoutReady(virtualOrganizer),
  };
}

function constructVerifiedEvent(
  stripe: Stripe,
  payload: string,
  signature: string,
  secretEnvVar: string,
): Stripe.Event {
  const secret = process.env[secretEnvVar];
  if (!secret) {
    throwAppError('CONFIGURATION_ERROR', `${secretEnvVar} not configured`);
  }
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err: unknown) {
    logger.error('stripe', 'Stripe webhook signature verification failed', {
      secretEnvVar,
      ...summarizeStripeError(err),
    });
    throwAppError(
      'WEBHOOK_SIGNATURE_INVALID',
      'Webhook signature verification failed',
    );
  }
}

export async function verifyAndProcessWebhookImpl(
  ctx: ActionCtx,
  args: {payload: string; signature: string},
): Promise<null> {
  const stripe = getStripeClient();
  const event = constructVerifiedEvent(
    stripe,
    args.payload,
    args.signature,
    'STRIPE_WEBHOOK_SECRET',
  );
  await dispatchStripeEvent(ctx, event, stripe);
  return null;
}

export async function verifyAndProcessConnectWebhookImpl(
  ctx: ActionCtx,
  args: {payload: string; signature: string},
): Promise<null> {
  const stripe = getStripeClient();
  const event = constructVerifiedEvent(
    stripe,
    args.payload,
    args.signature,
    'STRIPE_WEBHOOK_SECRET_CONNECT',
  );
  await dispatchStripeEvent(ctx, event, stripe, event.account ?? undefined);
  return null;
}

const V2_ACCOUNT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'v2.core.account.updated',
  'v2.core.account[requirements].updated',
  'v2.core.account[future_requirements].updated',
  'v2.core.account[configuration.merchant].updated',
  'v2.core.account[configuration.merchant].capability_status_updated',
]);

type StripeV2RelatedObject = Extract<
  Stripe.V2.Core.EventNotification,
  {related_object: unknown}
>['related_object'];

function isStripeRelatedObject(value: unknown): value is StripeV2RelatedObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    'url' in value &&
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.url === 'string'
  );
}

function getRelatedObject(
  notification: Stripe.V2.Core.EventNotification,
): StripeV2RelatedObject | null {
  if (!('related_object' in notification)) {
    return null;
  }
  return isStripeRelatedObject(notification.related_object)
    ? notification.related_object
    : null;
}

async function syncOrganizerFromStripeConnectedAccountId(
  ctx: Pick<ActionCtx, 'runMutation'>,
  args: {
    stripeConnectedAccountId: string;
    logLabel: string;
    logContext?: Record<string, unknown>;
  },
): Promise<void> {
  let status: Awaited<ReturnType<typeof checkConnectedAccountStatus>>;
  try {
    status = await withRetry(
      () => checkConnectedAccountStatus(args.stripeConnectedAccountId),
      {
        onRetry: (attempt, err) => {
          logger.warn(
            'stripe',
            `${args.logLabel} retrieve retry ${attempt}`,
            summarizeStripeError(err),
            args.logContext,
          );
        },
      },
    );
  } catch (err: unknown) {
    logger.error(
      'stripe',
      `${args.logLabel} Stripe account retrieve failed`,
      summarizeStripeError(err),
      args.logContext,
    );
    return;
  }

  await ctx.runMutation(
    internal.stripe.connect.updateOrganizerFromStripeAccount,
    {
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      onboardingStatus: status.onboardingStatus,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      currentlyDue: status.currentlyDue,
    },
  );
}

export async function refreshConnectedAccountStatusImpl(
  ctx: ActionCtx,
  args: {stripeConnectedAccountId: string},
): Promise<null> {
  await syncOrganizerFromStripeConnectedAccountId(ctx, {
    stripeConnectedAccountId: args.stripeConnectedAccountId,
    logLabel: 'account.updated webhook',
    logContext: {stripeConnectedAccountId: args.stripeConnectedAccountId},
  });
  return null;
}

export async function verifyAndProcessV2EventNotificationImpl(
  ctx: ActionCtx,
  args: {payload: string; signature: string},
): Promise<null> {
  const secret = process.env['STRIPE_WEBHOOK_SECRET_V2_EVENTS'];
  if (!secret) {
    throwAppError(
      'CONFIGURATION_ERROR',
      'STRIPE_WEBHOOK_SECRET_V2_EVENTS not configured',
    );
  }

  const stripe = getStripeClient();
  let notification: Stripe.V2.Core.EventNotification;
  try {
    notification = stripe.parseEventNotification(
      args.payload,
      args.signature,
      secret,
    );
  } catch (err: unknown) {
    logger.error(
      'stripe',
      'V2 event notification verification failed',
      summarizeStripeError(err),
    );
    throwAppError(
      'WEBHOOK_SIGNATURE_INVALID',
      'Webhook signature verification failed',
    );
  }

  const relatedObject = getRelatedObject(notification);
  const accountId =
    relatedObject?.type === 'v2.core.account' ? relatedObject.id : undefined;
  if (!V2_ACCOUNT_EVENT_TYPES.has(notification.type) || !accountId) {
    logger.info('stripe', 'V2 event notification ignored', {
      type: notification.type,
      relatedObjectType: relatedObject?.type,
    });
    return null;
  }

  await syncOrganizerFromStripeConnectedAccountId(ctx, {
    stripeConnectedAccountId: accountId,
    logLabel: 'V2 event notification',
    logContext: {type: notification.type, stripeConnectedAccountId: accountId},
  });
  logger.info('stripe', 'V2 event notification applied', {
    type: notification.type,
    stripeConnectedAccountId: accountId,
  });

  return null;
}

async function processAccountPayout(
  ctx: ActionCtx,
  args: {
    stripe: Stripe;
    connectedAccountId: string;
    eligibleBeforeMs: number;
    cronRunDate: string;
  },
): Promise<void> {
  const bundle = await ctx.runQuery(
    internal.stripe.connect.getSettlementDataForAccount,
    {
      stripeConnectedAccountId: args.connectedAccountId,
      eligibleBeforeMs: args.eligibleBeforeMs,
    },
  );
  if (!bundle.organizerId || bundle.events.length === 0) {
    return;
  }

  const eligibleEventIds = new Set<string>(
    bundle.events.filter((e) => e.eligible).map((e) => e._id),
  );
  if (eligibleEventIds.size === 0) {
    return;
  }

  const settlements = computeEventSettlements(
    bundle.financialEvents,
    bundle.events,
    bundle.confirmedAllocations,
  );

  // Fully settled (or nothing eligible yet): skip before any Stripe call so
  // idle accounts cost nothing in the daily scan.
  const hasEligiblePayable = settlements.some(
    (s) => eligibleEventIds.has(s.eventId) && s.payableCents > 0,
  );
  if (!hasEligiblePayable) {
    return;
  }

  const balance: Stripe.Response<Stripe.Balance> = await withRetry(
    () =>
      args.stripe.balance.retrieve(undefined, {
        stripeAccount: args.connectedAccountId,
      }),
    {
      onRetry: (attempt, err) => {
        logger.warn(
          'stripe',
          `balance retrieve retry ${attempt}`,
          summarizeStripeError(err),
        );
      },
    },
  );
  const availableBalanceCents =
    balance.available.find(
      (b: Stripe.Balance.Available) => b.currency === 'usd',
    )?.amount ?? 0;
  const pendingBalanceCents =
    balance.pending.find((b: Stripe.Balance.Pending) => b.currency === 'usd')
      ?.amount ?? 0;

  // Fail-closed reconciliation: refuse to pay when the ledger's remaining
  // claim disagrees with the money actually in Stripe. Catches net-less
  // ledger rows, out-of-band dashboard actions, and dropped events before
  // they can produce a silently-wrong payout. One-off trips are webhook
  // timing races and self-heal by the next daily run.
  const trustGate = computeLedgerTrustGate({
    settlements,
    inflightSubmittedCents: bundle.inflightSubmittedCents,
    stripeAvailableCents: availableBalanceCents,
    stripePendingCents: pendingBalanceCents,
  });
  if (!trustGate.ok) {
    logger.error('stripe', 'payout trust gate mismatch; skipping account', {
      connectedAccountId: args.connectedAccountId,
      ledgerClaimCents: trustGate.ledgerClaimCents,
      stripeTruthCents: trustGate.stripeTruthCents,
      availableBalanceCents,
      pendingBalanceCents,
      inflightSubmittedCents: bundle.inflightSubmittedCents,
      deltaCents: trustGate.deltaCents,
    });
    return;
  }

  const plan = buildPayoutPlan({
    connectedAccountId: args.connectedAccountId,
    settlements,
    eligibleEventIds,
    availableBalanceCents,
  });

  if (plan.payableCents <= 0 || plan.allocations.length === 0) {
    logger.info('stripe', 'No payable balance after reserve', {
      connectedAccountId: args.connectedAccountId,
      reservedCents: plan.reservedCents,
      eligibleNetCents: plan.eligibleNetCents,
      availableBalanceCents: plan.availableBalanceCents,
    });
    return;
  }

  logger.info('stripe', 'Submitting payout plan', {
    connectedAccountId: args.connectedAccountId,
    payableCents: plan.payableCents,
    eligibleNetCents: plan.eligibleNetCents,
    reservedCents: plan.reservedCents,
    availableBalanceCents,
    pendingBalanceCents,
    allocations: plan.allocations,
  });
  if (plan.payableCents < plan.eligibleNetCents) {
    logger.warn('stripe', 'Partial payout: balance below eligible net', {
      connectedAccountId: args.connectedAccountId,
      payableCents: plan.payableCents,
      eligibleNetCents: plan.eligibleNetCents,
      shortfallCents: plan.eligibleNetCents - plan.payableCents,
    });
  }

  const idempotencyKey = `braket-payout-${args.connectedAccountId}-${args.cronRunDate}`;
  const batch = await ctx.runMutation(
    internal.stripe.connect.createPayoutIntent,
    {
      idempotencyKey,
      connectedAccountId: args.connectedAccountId,
      amountCents: plan.payableCents,
      currency: 'usd',
      allocations: plan.allocations.map((alloc) => ({
        eventId: alloc.eventId as Id<'events'>,
        amountCents: alloc.amountCents,
      })),
    },
  );

  if (batch.status !== 'pending') {
    return;
  }

  const payout: Stripe.Response<Stripe.Payout> = await withRetry(
    () =>
      args.stripe.payouts.create(
        {amount: batch.amountCents, currency: batch.currency},
        {
          stripeAccount: args.connectedAccountId,
          idempotencyKey: batch.idempotencyKey,
        },
      ),
    {
      maxAttempts: 4,
      initialBackoffMs: 1000,
      base: 2,
      onRetry: (attempt, err) => {
        logger.warn(
          'stripe',
          `payouts.create retry ${attempt}`,
          summarizeStripeError(err),
        );
      },
    },
  );

  await ctx.runMutation(internal.stripe.connect.markPayoutBatchSubmitted, {
    batchId: batch.batchId,
    stripePayoutId: payout.id,
  });
}

export async function processScheduledPayoutsImpl(
  ctx: ActionCtx,
): Promise<null> {
  const eligibleBeforeMs = Date.now() - PAYOUT_DELAY_MS;

  const platformEventIds = await ctx.runQuery(
    internal.stripe.connect.listPlatformOrganizerEligibleEventIds,
    {eligibleBeforeMs, limit: PAYOUT_BATCH_SIZE},
  );
  for (const eventId of platformEventIds) {
    await ctx.runMutation(internal.stripe.connect.markEventPaidOut, {eventId});
  }
  if (platformEventIds.length > 0) {
    logger.info('stripe', 'Retired platform-organizer events', {
      count: platformEventIds.length,
    });
  }

  const connectedAccountIds = await ctx.runQuery(
    internal.stripe.connect.listPayoutReadyConnectedAccounts,
    {limit: PAYOUT_BATCH_SIZE},
  );
  if (connectedAccountIds.length === 0) {
    logger.info('stripe', 'No payout-ready Connect accounts');
    return null;
  }

  const stripe = getStripeClient();
  const cronRunDate = new Date().toISOString().slice(0, 10);

  for (const connectedAccountId of connectedAccountIds) {
    try {
      await processAccountPayout(ctx, {
        stripe,
        connectedAccountId,
        eligibleBeforeMs,
        cronRunDate,
      });
    } catch (err: unknown) {
      logger.error(
        'stripe',
        'processAccountPayout failed',
        summarizeStripeError(err),
        {connectedAccountId},
      );
    }
  }

  return null;
}
