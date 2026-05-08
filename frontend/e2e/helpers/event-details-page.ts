import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Page object for the event-details page (`/events/:id`).
 *
 * Wraps raw Playwright locators so that selector details live in one place.
 * Use this instead of inline `page.getByRole('heading', ...)` or
 * `page.getByRole('button', { name: /Get Tickets/i })` calls.
 */
export class EventDetailsPage {
  readonly eventTitle: Locator;
  readonly getTicketsButton: Locator;
  readonly resaleAvailableBanner: Locator;
  readonly siteHeader: Locator;

  constructor(private readonly page: Page) {
    this.eventTitle = page.getByTestId('event-title');
    this.getTicketsButton = page.getByTestId('get-tickets-button');
    this.resaleAvailableBanner = page.getByTestId('resale-available-banner');
    this.siteHeader = page.locator('header');
  }

  async getEventTitleText(): Promise<string> {
    return (await this.eventTitle.textContent() ?? '').trim();
  }

  async isGetTicketsButtonVisible(): Promise<boolean> {
    return this.getTicketsButton.isVisible();
  }

  async clickGetTickets(): Promise<void> {
    await this.getTicketsButton.click();
  }

  async getGetTicketsButtonText(): Promise<string> {
    return (await this.getTicketsButton.textContent() ?? '').trim();
  }

  async isResaleAvailableBannerVisible(): Promise<boolean> {
    return this.resaleAvailableBanner.isVisible();
  }

  /**
   * Waits for the event title to appear with the expected text.
   * Uses a generous timeout to allow for Convex subscription delivery.
   */
  async waitForEventTitle(title: string, timeout = 30000): Promise<void> {
    await expect(this.eventTitle).toHaveText(title, { timeout });
  }

  async expectSiteHeaderVisible(timeout = 10000): Promise<void> {
    await expect(this.siteHeader).toBeVisible({ timeout });
  }
}
