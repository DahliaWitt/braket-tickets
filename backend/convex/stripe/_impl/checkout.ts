'use node';

import {createHash} from 'node:crypto';
import type Stripe from 'stripe';
import type {CheckoutThemeMode} from '../../lib/orders/validators';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/actions.ts.
import {getStripeClient} from '../../lib/stripe_node';
import {PLATFORM_FEE_PERCENT, calculatePlatformFee} from '../../lib/stripe';
import {generateStripeIdempotencyKey} from '../../lib/payments/refunds';
import {sanitizeStatementDescriptor} from './constants';

type CheckoutSessionCreateParams = NonNullable<
  Parameters<Stripe['checkout']['sessions']['create']>[0]
>;

/**
 * Stripe Checkout helpers for the direct-charge ticketing flow.
 *
 * Two code paths converge here:
 * - Third-party promoter events → `createDirectChargeCheckoutSession`. The
 *   charge lands on the connected account, Stripe deducts its processing
 *   fee, and Stripe transfers our platform fee via
 *   `application_fee_amount`.
 * - Platform-owned events (`organizers.isPlatformOrganizer === true`) →
 *   `createPlatformCheckoutSession`. The platform is the merchant of
 *   record; no connected account, no application fee.
 *
 * Both helpers return the `{client_secret, id, expires_at}` triple the
 * frontend needs to mount the embedded Checkout component. Idempotency and
 * amount math live here so the orchestration action in `stripe/actions.ts`
 * stays thin.
 */

export interface SharedCheckoutMetadata extends Record<string, string> {
  /** Our internal `ticket_orders._id`. */
  orderId: string;
  /** `'primary'` or `'resale'`. */
  kind: string;
  /** Our internal `events._id`. */
  eventId: string;
}

export interface CreateDirectChargeCheckoutSessionArgs {
  connectedAccountId: string;
  orderId: string;
  amountCents: number;
  quantity: number;
  checkoutTheme: CheckoutThemeMode;
  eventName: string;
  ticketDescription: string;
  buyerEmail?: string;
  /** Hard hold expiration, ms since epoch. Converted to seconds for Stripe. */
  expiresAtMs: number;
  metadata: SharedCheckoutMetadata;
}

export interface CreatePlatformCheckoutSessionArgs {
  orderId: string;
  amountCents: number;
  quantity: number;
  checkoutTheme: CheckoutThemeMode;
  eventName: string;
  ticketDescription: string;
  buyerEmail?: string;
  expiresAtMs: number;
  metadata: SharedCheckoutMetadata;
}

export interface CheckoutSessionResult {
  clientSecret: string;
  checkoutSessionId: string;
  /** `session.expires_at` — Stripe returns seconds, we re-expose ms. */
  expiresAtMs: number;
}

export const CHECKOUT_BRANDING_SETTINGS = {
  light: {
    background_color: '#fafafa',
    button_color: '#da0b62',
    border_style: 'rectangular',
    font_family: 'inconsolata',
  },
  dark: {
    background_color: '#110d10',
    button_color: '#de1467',
    border_style: 'rectangular',
    font_family: 'inconsolata',
  },
} satisfies Record<
  CheckoutThemeMode,
  NonNullable<CheckoutSessionCreateParams['branding_settings']>
>;

export const CHECKOUT_BRANDING_VERSION = 'embedded-pulp-v2';

export function resolveCheckoutBranding(checkoutTheme: CheckoutThemeMode): {
  brandingSettings: NonNullable<
    CheckoutSessionCreateParams['branding_settings']
  >;
  brandingVersion: string;
} {
  return {
    brandingSettings: CHECKOUT_BRANDING_SETTINGS[checkoutTheme],
    brandingVersion: `${CHECKOUT_BRANDING_VERSION}:${checkoutTheme}`,
  };
}

export function hasCurrentCheckoutBranding(
  session: Pick<Stripe.Checkout.Session, 'branding_settings' | 'metadata'>,
  checkoutTheme: CheckoutThemeMode,
): boolean {
  const {brandingSettings, brandingVersion} =
    resolveCheckoutBranding(checkoutTheme);
  const branding = session.branding_settings;
  if (!branding) {
    return false;
  }
  return (
    session.metadata?.['checkoutBrandingVersion'] === brandingVersion &&
    branding.background_color === brandingSettings.background_color &&
    branding.button_color === brandingSettings.button_color &&
    branding.border_style === brandingSettings.border_style &&
    branding.font_family === brandingSettings.font_family
  );
}

function toStripeSessionResult(
  session: Stripe.Checkout.Session,
): CheckoutSessionResult {
  if (!session.client_secret) {
    throw new Error(
      'Stripe Checkout Session did not include a client_secret (embedded_page ui_mode is required)',
    );
  }
  return {
    clientSecret: session.client_secret,
    checkoutSessionId: session.id,
    expiresAtMs: session.expires_at * 1000,
  };
}

/**
 * Stable JSON serialization with recursively sorted object keys so a
 * fingerprint is independent of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Derive a Stripe idempotency key that is stable for identical Checkout
 * Session parameters but changes whenever any session-defining parameter
 * changes.
 *
 * Stripe stores idempotency keys for at least 24h and rejects a replay of the
 * same key with *different* parameters with an `idempotency_error` (HTTP 400).
 * A Checkout Session for one still-open order is legitimately re-created with
 * different parameters mid-flight: the buyer flips the checkout theme
 * (`branding_settings` + `metadata.checkoutBrandingVersion` change) or the hold
 * is extended (`expires_at` advances with the wall clock). A fixed
 * `braket-checkout-${orderId}` key therefore wedges every restart with a 400,
 * and the wedge persists until the 30-minute hold expires. Folding the full
 * request body (plus the connected-account routing, which changes the target
 * account) into the key gives each distinct session its own key while keeping
 * true retries — `withRetry`'s transient-network replays send byte-identical
 * params — collapsed onto a single key so a lost response never double-creates.
 */
function buildCheckoutIdempotencyKey(
  orderId: string,
  params: CheckoutSessionCreateParams,
  requestOptions: {stripeAccount?: string},
): string {
  const fingerprint = stableStringify({
    params,
    stripeAccount: requestOptions.stripeAccount ?? null,
  });
  const digest = createHash('sha256').update(fingerprint).digest('hex');
  // Reuse the shared key builder so the checkout key stays on the same
  // `braket-${operation}-${subjectId}-${suffix}` convention as refunds/payouts.
  return generateStripeIdempotencyKey(orderId, 'checkout', digest.slice(0, 32));
}

function buildTicketLineItem(args: {
  amountCents: number;
  quantity: number;
  eventName: string;
  ticketDescription: string;
}): NonNullable<CheckoutSessionCreateParams['line_items']>[number] {
  if (!Number.isInteger(args.quantity) || args.quantity <= 0) {
    throw new Error(
      `Checkout line item quantity must be a positive integer; received ${args.quantity}`,
    );
  }

  const quantity = args.quantity;
  const hasExactUnitAmount = args.amountCents % quantity === 0;
  const unitAmount = hasExactUnitAmount
    ? args.amountCents / quantity
    : args.amountCents;

  return {
    quantity: hasExactUnitAmount ? quantity : 1,
    price_data: {
      currency: 'usd',
      unit_amount: unitAmount,
      product_data: {
        name: args.eventName,
        description: args.ticketDescription,
      },
    },
  };
}

/**
 * Promoter-as-MoR direct charge. Uses the `Stripe-Account` header via the
 * SDK's per-request `{stripeAccount}` option so the Checkout Session, the
 * resulting PaymentIntent, and the final Charge all live on the connected
 * account. The platform receives the application fee as a cross-account
 * transfer.
 *
 * Payment methods are determined by the Stripe Dashboard configuration
 * (automatic). `checkout.session.completed` is the canonical settlement
 * event; enabling async payment methods (ACH, SEPA, …) requires adding
 * `async_payment_succeeded` / `async_payment_failed` handlers first — keep
 * those disabled in the Dashboard until the handlers exist.
 */
export async function createDirectChargeCheckoutSession(
  args: CreateDirectChargeCheckoutSessionArgs,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();
  const applicationFee = calculatePlatformFee(
    args.amountCents,
    PLATFORM_FEE_PERCENT,
  );
  const descriptorSuffix = sanitizeStatementDescriptor(args.eventName);
  const {brandingSettings, brandingVersion} = resolveCheckoutBranding(
    args.checkoutTheme,
  );
  const metadata = {
    ...args.metadata,
    checkoutBrandingVersion: brandingVersion,
  };

  const sessionParams: CheckoutSessionCreateParams = {
    mode: 'payment',
    ui_mode: 'embedded_page',
    redirect_on_completion: 'never',
    branding_settings: brandingSettings,
    client_reference_id: args.orderId,
    ...(args.buyerEmail ? {customer_email: args.buyerEmail} : {}),
    expires_at: Math.floor(args.expiresAtMs / 1000),
    line_items: [
      buildTicketLineItem({
        amountCents: args.amountCents,
        quantity: args.quantity,
        eventName: args.eventName,
        ticketDescription: args.ticketDescription,
      }),
    ],
    payment_intent_data: {
      capture_method: 'automatic',
      application_fee_amount: applicationFee,
      ...(descriptorSuffix
        ? {statement_descriptor_suffix: descriptorSuffix}
        : {}),
      metadata,
    },
    metadata,
  };
  const requestOptions = {stripeAccount: args.connectedAccountId};

  const session = await stripe.checkout.sessions.create(sessionParams, {
    ...requestOptions,
    idempotencyKey: buildCheckoutIdempotencyKey(
      args.orderId,
      sessionParams,
      requestOptions,
    ),
  });

  return toStripeSessionResult(session);
}

/**
 * Platform-as-MoR standard charge for platform-owned events. Mirrors the
 * direct charge shape but drops the application fee and the
 * `{stripeAccount}` option so the charge lives on the platform account.
 */
export async function createPlatformCheckoutSession(
  args: CreatePlatformCheckoutSessionArgs,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();
  const descriptorSuffix = sanitizeStatementDescriptor(args.eventName);
  const {brandingSettings, brandingVersion} = resolveCheckoutBranding(
    args.checkoutTheme,
  );
  const metadata = {
    ...args.metadata,
    checkoutBrandingVersion: brandingVersion,
  };

  const sessionParams: CheckoutSessionCreateParams = {
    mode: 'payment',
    ui_mode: 'embedded_page',
    redirect_on_completion: 'never',
    branding_settings: brandingSettings,
    client_reference_id: args.orderId,
    ...(args.buyerEmail ? {customer_email: args.buyerEmail} : {}),
    expires_at: Math.floor(args.expiresAtMs / 1000),
    line_items: [
      buildTicketLineItem({
        amountCents: args.amountCents,
        quantity: args.quantity,
        eventName: args.eventName,
        ticketDescription: args.ticketDescription,
      }),
    ],
    payment_intent_data: {
      capture_method: 'automatic',
      ...(descriptorSuffix
        ? {statement_descriptor_suffix: descriptorSuffix}
        : {}),
      metadata,
    },
    metadata,
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: buildCheckoutIdempotencyKey(args.orderId, sessionParams, {}),
  });

  return toStripeSessionResult(session);
}

/**
 * Retrieve a Checkout Session with its PaymentIntent/Charge/BalanceTransaction
 * expanded. Routes through the connected account when an id is supplied so
 * direct-charge sessions resolve correctly; platform orders pass
 * `undefined` and retrieve on the platform account.
 *
 * The deep expand (`payment_intent.latest_charge.balance_transaction`) is
 * what enables `recordPaymentCaptured` (Task 6) to read
 * `BalanceTransaction.net` / `fee_details` directly from the session
 * payload without an additional Stripe round trip.
 */
export async function retrieveCheckoutSessionWithBalance(args: {
  checkoutSessionId: string;
  connectedAccountId: string | undefined;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const requestOptions: Stripe.RequestOptions = args.connectedAccountId
    ? {stripeAccount: args.connectedAccountId}
    : {};
  return stripe.checkout.sessions.retrieve(
    args.checkoutSessionId,
    {expand: ['payment_intent.latest_charge.balance_transaction']},
    requestOptions,
  );
}
