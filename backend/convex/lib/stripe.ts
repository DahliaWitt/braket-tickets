import {throwInvalidInput} from './errors';

/** Stripe processing fee: 2.9% + 30c for US card payments. */
export const STRIPE_RATE = 0.029;
export const STRIPE_FIXED_CENTS = 30;

/**
 * Platform application fee for Connect direct charges.
 *
 * Applied as `application_fee_amount` on the PaymentIntent. The connected
 * account is the Merchant of Record and pays Stripe processing fees directly
 * (`fees_collector: "stripe"` on the V2 account config).
 */
export const PLATFORM_FEE_PERCENT = 2;

/**
 * Calculate Stripe processing fee for a given amount in cents.
 * Returns 0 for free payments (amount <= 0).
 */
export function calculateStripeFee(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round(amountCents * STRIPE_RATE + STRIPE_FIXED_CENTS);
}

/**
 * Calculate platform fee for Connect direct charges.
 * @param amountCents - Total charge amount in cents
 * @param feePct - Platform fee percentage (0-50)
 */
export function calculatePlatformFee(
  amountCents: number,
  feePct: number,
): number {
  if (feePct < 0 || feePct > 50) {
    throwInvalidInput(`Platform fee percentage out of bounds: ${feePct}`, {
      field: 'feePct',
    });
  }
  return Math.round(amountCents * (feePct / 100));
}

/**
 * Maps Stripe's dispute status string to our internal resolution type.
 *
 * Pure string mapping — safe to call from Convex runtime code (no SDK
 * dependency). The Node-only webhook dispatcher passes the
 * `Stripe.Dispute['status']` through verbatim.
 *
 * Stripe statuses: https://stripe.com/docs/api/disputes/object#dispute_object-status
 * - `won` / `warning_closed` → merchant won, funds returned
 * - `lost` → merchant lost, funds taken
 * - everything else (e.g., `charge_refunded`, `withdrawn`) → withdrawn
 */
export function mapStripeDisputeStatus(
  stripeStatus: string,
): 'won' | 'lost' | 'withdrawn' {
  switch (stripeStatus) {
    case 'won':
    case 'warning_closed':
      return 'won';
    case 'lost':
      return 'lost';
    default:
      return 'withdrawn';
  }
}

/**
 * Reduce an arbitrary thrown value to a safe object for structured logs.
 *
 * Stripe SDK errors (`Stripe.errors.StripeError` and friends) attach the
 * full HTTP request — including `Authorization: Bearer sk_live_...`
 * headers — under `.headers` / `.raw.request`. The logger's field-name
 * sanitizer does not know the Stripe-specific keys, so we aggressively
 * whitelist just the fields ops actually care about.
 *
 * Shared by the webhook dispatcher and the top-level action file so the
 * same shape lands in Sentry regardless of which Node call threw.
 */
export function summarizeStripeError(err: unknown): Record<string, unknown> {
  if (err === null || err === undefined) {
    return {message: 'nullish error'};
  }
  if (typeof err !== 'object') {
    return {message: String(err)};
  }

  const e = err as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  if (typeof e['name'] === 'string') summary['name'] = e['name'];
  if (typeof e['message'] === 'string') summary['message'] = e['message'];
  // Stripe error taxonomy — type/code are the grep-able fields in ops
  // dashboards.
  if (typeof e['type'] === 'string') summary['type'] = e['type'];
  if (typeof e['code'] === 'string') summary['code'] = e['code'];
  if (typeof e['statusCode'] === 'number') {
    summary['statusCode'] = e['statusCode'];
  }
  if (typeof e['requestId'] === 'string') {
    summary['requestId'] = e['requestId'];
  }
  return summary;
}
