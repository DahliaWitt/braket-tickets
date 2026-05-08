'use node';

import Stripe from 'stripe';
import {logger} from './logger';
import {withRetry} from './resilience';
import {throwAppError} from './errors';

/**
 * Node-only Stripe helpers.
 *
 * Anything that imports the Stripe SDK (or relies on its runtime types)
 * belongs here. Pure fee math and pure string mappings live in
 * `lib/stripe.ts` so that Convex-runtime modules (queries/mutations) can
 * reuse them without pulling the Node SDK into their bundle.
 *
 * Shared between `stripe/actions.ts` (registered actions) and
 * `stripe/_impl/webhook_dispatch.ts` (webhook event handlers).
 */

/**
 * Lazily instantiate the Stripe SDK client. Called per-invocation rather
 * than at module load so actions that never touch Stripe (e.g. during
 * local dev without `STRIPE_SECRET_KEY`) do not crash on import.
 */
export function getStripeClient(): Stripe {
  const secretKey = process.env['STRIPE_SECRET_KEY'];
  if (!secretKey) {
    // Structured shape so the frontend/ops can branch on `code` rather
    // than pattern-matching free-text messages. Every other ConvexError
    // thrown from the stripe path uses this shape.
    throwAppError(
      'STRIPE_NOT_CONFIGURED',
      'STRIPE_SECRET_KEY is not set for this Convex deployment; set it before invoking Stripe-dependent actions.',
    );
  }
  return new Stripe(secretKey);
}

/**
 * Pull a raw candidate order id string out of a Checkout Session, preferring
 * the structured metadata key and falling back to `client_reference_id`.
 *
 * Returns an untyped `string | null` because validation against the
 * `ticket_orders` table schema requires `ctx.db.normalizeId(...)`, which
 * only exists in the Convex runtime. Callers in the Node runtime pass the
 * result to `internal.orders.core.normalizeTicketOrderId` before using it.
 *
 * Production Convex ids are opaque 32-char base32 strings — no table-name
 * suffix — so any "looks like an id" heuristic in Node would be wrong.
 */
export function extractOrderIdFromCheckoutSession(
  session: Pick<Stripe.Checkout.Session, 'client_reference_id' | 'metadata'>,
): string | null {
  return session.metadata?.['orderId'] ?? session.client_reference_id ?? null;
}

/**
 * Pull a raw candidate order id string out of a PaymentIntent's metadata.
 * PaymentIntents have no `client_reference_id`, so metadata is the only
 * channel. Same Node/runtime validation split as
 * `extractOrderIdFromCheckoutSession` — see that comment.
 */
export function extractOrderIdFromPaymentIntent(
  paymentIntent: Pick<Stripe.PaymentIntent, 'metadata'>,
): string | null {
  return paymentIntent.metadata?.['orderId'] ?? null;
}

/**
 * Retrieve the charge id associated with a PaymentIntent. Stripe only
 * exposes the charge via `latest_charge` once the PI transitions to a
 * terminal success state, so callers that need the charge id (for
 * dispute/refund ledger bookkeeping) expand it lazily here.
 *
 * Wrapped in `withRetry` to ride out transient Stripe API blips. Pass
 * `connectedAccountId` for direct-charge PaymentIntents so the retrieve
 * goes through the `{stripeAccount}` header — Stripe returns 404 if you
 * try to read a connected-account PI from the platform account.
 */
export async function retrieveChargeIdForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
  connectedAccountId?: string,
): Promise<string | undefined> {
  const paymentIntent: Stripe.PaymentIntent = await withRetry(
    () =>
      stripe.paymentIntents.retrieve(
        paymentIntentId,
        {expand: ['latest_charge']},
        connectedAccountId ? {stripeAccount: connectedAccountId} : undefined,
      ),
    {
      onRetry: (attempt, error) => {
        logger.warn('stripe', `PaymentIntent retrieve retry ${attempt}`, error);
      },
    },
  );

  const latestCharge = paymentIntent.latest_charge;
  if (!latestCharge) {
    return undefined;
  }
  return typeof latestCharge === 'string' ? latestCharge : latestCharge.id;
}
