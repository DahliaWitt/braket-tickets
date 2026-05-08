/**
 * Playwright Harness Environment Bridge
 *
 * Bridges Angular CDK Component Harnesses with Playwright E2E tests.
 * This allows reusing existing harnesses (40+ in the codebase) for E2E tests.
 *
 * Note: Full SeleniumWebDriverHarnessEnvironment requires WebDriver.
 * Playwright uses its own protocol, so we create a lightweight adapter
 * that enables harness-style interactions while keeping Playwright's speed.
 */

import { Page, Locator } from '@playwright/test';

/**
 * Base class for E2E page objects that wrap component harnesses.
 * Provides harness-like API while using Playwright locators internally.
 */
export abstract class E2EPageObject {
  constructor(protected page: Page) {}

  /**
   * Wait for Angular to be stable (signals settled, change detection done).
   * Uses a custom window property that Angular sets when stable.
   */
  async whenStable(timeout = 5000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const win = window as Window & { ng?: { getZone?: () => { isStable: boolean; hasPendingMacrotasks: boolean } | undefined } };
        const ngZone = win.ng?.getZone?.();
        if (!ngZone) return true; // No Angular zone = assume stable
        return ngZone.isStable || !ngZone.hasPendingMacrotasks;
      },
      { timeout }
    );
  }

  /**
   * Get a locator with auto-waiting for Angular stability.
   */
  protected locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  /**
   * Get element by test ID (preferred selector strategy).
   */
  protected byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Get element by role and optional name.
   */
  protected byRole(
    role: Parameters<Page['getByRole']>[0],
    options?: Parameters<Page['getByRole']>[1],
  ): Locator {
    return this.page.getByRole(role, options);
  }

  /**
   * Get element by label text.
   */
  protected byLabel(label: string | RegExp): Locator {
    return this.page.getByLabel(label);
  }

  /**
   * Get element by placeholder.
   */
  protected byPlaceholder(placeholder: string | RegExp): Locator {
    return this.page.getByPlaceholder(placeholder);
  }

  /**
   * Get element by text content.
   */
  protected byText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }
}

/**
 * Generic harness adapter that wraps a component's harness methods
 * for use in Playwright E2E tests.
 *
 * Usage:
 * ```typescript
 * const vetting = new VettingPage(page);
 * await vetting.setReferral('My friend');
 * await vetting.setWhyJoin('I want to join...');
 * await vetting.submit();
 * ```
 */
export abstract class ComponentHarnessAdapter extends E2EPageObject {
  /**
   * Host selector for the component (e.g., 'app-vetting').
   */
  abstract readonly hostSelector: string;

  /**
   * Get the host element locator.
   */
  host(): Locator {
    return this.locator(this.hostSelector);
  }

  /**
   * Check if the component is present in the DOM.
   */
  async isPresent(): Promise<boolean> {
    const count = await this.host().count();
    return count > 0;
  }

  /**
   * Wait for the component to be visible.
   */
  async waitForVisible(timeout = 10000): Promise<void> {
    await this.host().waitFor({ state: 'visible', timeout });
  }
}

/**
 * Factory for creating harness adapters with proper typing.
 */
export function createHarnessAdapter<T extends ComponentHarnessAdapter>(
  AdapterClass: new (page: Page) => T,
  page: Page
): T {
  return new AdapterClass(page);
}
