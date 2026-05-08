import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import type {FunctionReference} from 'convex/server';
import {logger} from '../../lib/logger';
import {isStripeWebhookInFlightError} from '../../lib/stripe_webhook_errors';

type WebhookProcessor = FunctionReference<
  'action',
  'internal',
  {payload: string; signature: string},
  null
>;

/**
 * Shared transport for Stripe webhook endpoints.
 *
 * Each endpoint has its own signing secret and dispatch action, but the
 * request shape (stripe-signature header + raw body) and retryable 503
 * semantics are identical. Dedup into one function so
 * `/stripe/webhook`, `/stripe/connect-webhook`, and `/stripe/v2-events`
 * stay lockstep on transport behavior.
 */
async function runStripeWebhookTransport(
  ctx: ActionCtx,
  request: Request,
  processor: WebhookProcessor,
  label: string,
): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', {status: 400});
  }

  const payload = await request.text();
  try {
    await ctx.runAction(processor, {payload, signature});
    return new Response('OK', {status: 200});
  } catch (error) {
    if (isStripeWebhookInFlightError(error)) {
      logger.warn(
        'stripe',
        `${label} event already in flight; returning retryable response`,
        error,
      );
      return new Response('Webhook processing already in flight', {
        status: 503,
        headers: {'Retry-After': '30'},
      });
    }
    logger.error('stripe', `${label} processing error`, error);
    return new Response('Webhook processing failed', {status: 400});
  }
}

/**
 * Platform account webhook (`/stripe/webhook`).
 *
 * Receives events on objects owned by the platform itself:
 * `application_fee.*` and any charges/PIs that live on the platform
 * account (e.g., platform-owned event orders). Verified with
 * `STRIPE_WEBHOOK_SECRET`.
 */
export async function handleStripeWebhook(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return runStripeWebhookTransport(
    ctx,
    request,
    internal.stripe.actions.verifyAndProcessWebhook,
    'Account webhook',
  );
}

/**
 * Connect webhook (`/stripe/connect-webhook`).
 *
 * Receives v1 snapshot events that target connected accounts — charges,
 * payments, refunds, disputes, payouts, balance. The payload carries an
 * `event.account` field that threads through to the dispatcher so every
 * Stripe SDK call routes through the right `{stripeAccount}` header.
 * Verified with `STRIPE_WEBHOOK_SECRET_CONNECT`.
 */
export async function handleStripeConnectWebhook(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return runStripeWebhookTransport(
    ctx,
    request,
    internal.stripe.actions.verifyAndProcessConnectWebhook,
    'Connect webhook',
  );
}

/**
 * Accounts V2 Event Destination (`/stripe/v2-events`).
 *
 * Receives V2 thin event notifications about account lifecycle:
 * `v2.core.account.updated`, `.requirements.updated`, and the merchant
 * configuration capability transitions. Verified with
 * `STRIPE_WEBHOOK_SECRET_V2_EVENTS`. This is NOT the same as a v1
 * snapshot webhook — the payload is parsed with
 * `stripe.parseEventNotification` and the actual account state is
 * fetched via `eventNotification.fetchRelatedObject()`.
 */
export async function handleStripeV2EventsWebhook(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return runStripeWebhookTransport(
    ctx,
    request,
    internal.stripe.actions.verifyAndProcessV2EventNotification,
    'V2 event destination',
  );
}
