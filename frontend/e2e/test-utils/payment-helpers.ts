import { Page, expect } from '@playwright/test';

/**
 * Payment Test Helpers
 *
 * Provides utilities for handling embedded Stripe checkout in E2E tests.
 * In E2E mode, Stripe.js is replaced with a deterministic embedded checkout
 * mock, so the flow is:
 * 1. Click once to mount embedded checkout and fetch the client secret.
 * 2. Click again to complete the mock payment.
 */

/**
 * Starts embedded checkout and completes the mock payment.
 *
 * Flow:
 * 1. Wait for the checkout CTA (`data-testid="stripe-pay-button"`).
 * 2. Click it once to mount the embedded checkout placeholder.
 * 3. Wait for the embedded checkout region and the mock completion CTA.
 * 4. Click again to complete the mock payment.
 *
 * @param page - Playwright page object
 */
export async function fillAndSubmitPayment(page: Page): Promise<void> {
  const payButton = page.getByTestId('stripe-pay-button');
  await expect(payButton).toBeVisible({ timeout: 15000 });
  await expect(payButton).toBeEnabled({ timeout: 5000 });
  await payButton.click();

  const embeddedCheckout = page.getByTestId('stripe-payment-element');
  await expect(embeddedCheckout).toBeVisible({ timeout: 15000 });
  await expect(payButton).toHaveText(/complete mock payment/i, { timeout: 5000 });
  await expect(payButton).toBeEnabled({ timeout: 5000 });
  await payButton.click();
}

/**
 * Waits for payment success confirmation.
 */
export async function waitForPaymentSuccess(
  page: Page,
  mode: 'authenticated' | 'guest' = 'authenticated',
) {
  await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 15000 });
  if (mode === 'guest') {
    await expect(page.getByText(/check your email for your tickets/i)).toBeVisible({
      timeout: 15000,
    });
    return;
  }

  await expect(page.getByText(/Payment successful/i)).toBeVisible({ timeout: 30000 });
}
