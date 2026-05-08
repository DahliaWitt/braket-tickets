import { type Locator } from '@playwright/test';

/**
 * Fills an input and manually dispatches an 'input' event.
 * This is sometimes necessary for Angular Signal Forms to detect changes
 * when using Playwright's .fill() method, especially for validation triggers.
 *
 * @param locator The Playwright locator for the input element
 * @param value The value to fill
 */
export async function fillAndTriggerInput(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.evaluate((el: HTMLInputElement) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Trigger blur to ensure touched state is set (often required for validation display)
  await locator.blur();
}
