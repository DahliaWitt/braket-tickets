import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../_generated/server';
import {STRIPE_WEBHOOK_IN_FLIGHT_CODE} from '../lib/stripe_webhook_errors';
import {handleStripeWebhook} from './_impl/stripe';

function stripeRequest(): Request {
  return new Request('https://example.test/stripe/webhook', {
    method: 'POST',
    headers: {'stripe-signature': 'test_signature'},
    body: '{}',
  });
}

describe('handleStripeWebhook', () => {
  it('returns a retryable response for in-flight webhook claims', async () => {
    const ctx = {
      runAction: vi.fn().mockRejectedValue({
        data: {
          code: STRIPE_WEBHOOK_IN_FLIGHT_CODE,
          message:
            'Stripe webhook event is already being processed; retry delivery later.',
        },
      }),
    } as unknown as ActionCtx;

    const response = await handleStripeWebhook(ctx, stripeRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.text()).toContain('already in flight');
  });
});
