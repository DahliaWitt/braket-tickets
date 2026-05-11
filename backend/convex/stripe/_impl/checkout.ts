'use node';

import type Stripe from 'stripe';
import type {CheckoutThemeMode} from '../../lib/orders/validators';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/actions.ts.
import {getStripeClient} from '../../lib/stripe_node';
import {PLATFORM_FEE_PERCENT, calculatePlatformFee} from '../../lib/stripe';
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

function buildTicketLineItem(args: {
  amountCents: number;
  quantity: number;
  eventName: string;
  ticketDescription: string;
}): NonNullable<CheckoutSessionCreateParams['line_items']>[number] {
  const quantity = Math.max(1, Math.trunc(args.quantity));
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
        description:
          hasExactUnitAmount && quantity > 1
            ? `${args.ticketDescription} (${quantity} tickets)`
            : args.ticketDescription,
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

  const session = await stripe.checkout.sessions.create(
    {
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
        application_fee_amount: applicationFee,
        ...(descriptorSuffix
          ? {statement_descriptor_suffix: descriptorSuffix}
          : {}),
        metadata,
      },
      metadata,
    },
    {
      stripeAccount: args.connectedAccountId,
      idempotencyKey: `braket-checkout-${args.orderId}`,
    },
  );

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

  const session = await stripe.checkout.sessions.create(
    {
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
        ...(descriptorSuffix
          ? {statement_descriptor_suffix: descriptorSuffix}
          : {}),
        metadata,
      },
      metadata,
    },
    {
      idempotencyKey: `braket-checkout-${args.orderId}`,
    },
  );

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
