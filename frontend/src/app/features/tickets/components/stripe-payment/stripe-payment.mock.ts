/**
 * Mock Stripe.js for E2E and unit testing.
 *
 * The mock exposes the Embedded Checkout surface we use in production so tests
 * can mount a deterministic placeholder without the real Stripe CDN.
 */

import type {
  Stripe,
  StripeEmbeddedCheckout,
  StripeEmbeddedCheckoutOptions,
} from '@stripe/stripe-js';

type MockStripeClient = Pick<Stripe, 'createEmbeddedCheckoutPage'>;

function createMockEmbeddedCheckout(): StripeEmbeddedCheckout {
  return {
    mount: (domElement: string | HTMLElement) => {
      const el =
        typeof domElement === 'string'
          ? document.querySelector(domElement)
          : domElement;
      if (el) {
        const mockIndicator = document.createElement('div');
        mockIndicator.style.padding = '8px';
        mockIndicator.style.color = '#666';
        mockIndicator.style.fontSize = '12px';
        mockIndicator.style.fontFamily = 'monospace';
        mockIndicator.textContent =
          '[MOCK] Stripe Embedded Checkout (E2E Test Mode)';
        el.appendChild(mockIndicator);
      }
    },
    unmount: () => {
      // No-op
    },
    destroy: () => {
      // No-op
    },
  };
}

export function createMockStripeJs(): MockStripeClient {
  return {
    createEmbeddedCheckoutPage: async (
      options: StripeEmbeddedCheckoutOptions,
    ): Promise<StripeEmbeddedCheckout> => {
      if (!options.fetchClientSecret) {
        throw new Error('Mock Stripe checkout requires fetchClientSecret');
      }
      await options.fetchClientSecret();
      return createMockEmbeddedCheckout();
    },
  };
}
