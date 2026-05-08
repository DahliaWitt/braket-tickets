import type { ComponentHarness } from '@angular/cdk/testing';
import { createEnvironment } from '@ngx-playwright/test';
import type { Page } from '@playwright/test';

type HarnessCtor<T extends ComponentHarness> = {
  new (...args: never[]): T;
  hostSelector: string;
};

/**
 * Zoneless Angular does not retry `getHarness()` until the host exists.
 * Wait for the harness host first, then resolve the harness from the page.
 * Overlay-backed components can keep the host attached while rendering the
 * visible UI within a descendant dialog, so callers can opt into `attached`.
 */
export async function getHarnessWhenVisible<T extends ComponentHarness>(
  page: Page,
  harnessType: HarnessCtor<T>,
  timeout = 15000,
  state: 'visible' | 'attached' = 'visible',
): Promise<T> {
  await page.locator(harnessType.hostSelector).waitFor({ state, timeout });
  return createEnvironment(page).getHarness(harnessType);
}
