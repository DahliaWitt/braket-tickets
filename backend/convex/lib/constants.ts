/**
 * Shared constants for Convex backend functions.
 */

export {PAYOUT_DELAY_DAYS, PAYOUT_DELAY_MS} from '../../../shared/constants';

/**
 * Maximum number of payout-eligible events the daily cron queues in one run.
 *
 * Bounding the batch keeps payout scheduling predictable if a backlog of
 * unpaid historical events accumulates.
 */
export const PAYOUT_BATCH_SIZE = 25;

/**
 * Checkout reservation hold duration for the new order flow.
 *
 * Stripe Checkout hosted sessions allow expires_at values between 30 minutes
 * and 24 hours, so the canonical hold aligns to 30 minutes.
 */
export const ORDER_HOLD_EXPIRATION_MS = 30 * 60 * 1000;

/**
 * Grace period before the scheduled release job frees an expired order.
 *
 * This small buffer reduces boundary races around checkout completion and
 * webhook delivery at the exact expiration timestamp.
 */
export const ORDER_RELEASE_GRACE_MS = 2 * 60 * 1000;

/**
 * Buffer added to Stripe Checkout Session `expires_at` to account for
 * latency between order creation and Stripe API call. Stripe requires
 * `expires_at` to be at least 30 minutes from session creation.
 */
export const STRIPE_CHECKOUT_EXPIRY_BUFFER_MS = 90 * 1000;

/**
 * Default currency for orders and financial events.
 *
 * Matches the `v.literal('USD')` constraint on `ticket_orders.currency`
 * and `order_financial_events.currency` in `schema.ts`. Centralized so a
 * future multi-currency migration has one touch point instead of every
 * order-insert and financial-event-insert call site.
 */
export const DEFAULT_CURRENCY = 'USD' as const;
