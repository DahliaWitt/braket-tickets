/**
 * Landing Page Object for E2E tests
 *
 * Provides a stable API for interacting with the landing page.
 * Mirrors the structure of component harnesses for consistency.
 */

import { Locator, Page, expect } from '@playwright/test';

export class LandingPage {
  constructor(private page: Page) {}

  // Section locators
  private getHeroSection(): Locator {
    return this.page.getByTestId('landing-hero');
  }

  private getFeaturedEventSection(): Locator {
    return this.page.getByTestId('landing-featured-event');
  }

  private getOverflowEventsSection(): Locator {
    return this.page.getByTestId('landing-overflow-events');
  }

  private getCommunitiesSection(): Locator {
    return this.page.getByTestId('landing-communities');
  }

  /**
   * Navigate to the landing page.
   */
  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /**
   * Wait for the landing page to be fully loaded.
   */
  async waitForReady(timeout = 15000): Promise<void> {
    await expect(this.getHeroSection()).toBeVisible({ timeout });
  }

  /**
   * Check if hero section is visible.
   */
  async isHeroVisible(): Promise<boolean> {
    const el = this.getHeroSection();
    return (await el.count()) > 0 && (await el.isVisible());
  }

  /**
   * Check if featured event section is visible.
   */
  async isFeaturedEventVisible(): Promise<boolean> {
    const el = this.getFeaturedEventSection();
    return (await el.count()) > 0 && (await el.isVisible());
  }

  /**
   * Check if overflow events section is visible.
   */
  async isOverflowEventsVisible(): Promise<boolean> {
    const el = this.getOverflowEventsSection();
    return (await el.count()) > 0 && (await el.isVisible());
  }

  /**
   * Check if communities section is visible.
   */
  async isCommunitiesVisible(): Promise<boolean> {
    const el = this.getCommunitiesSection();
    return (await el.count()) > 0 && (await el.isVisible());
  }

  /**
   * Get the main heading text.
   */
  async getHeadingText(): Promise<string | null> {
    const h1 = this.page.getByRole('heading', { level: 1 });
    if ((await h1.count()) === 0) return null;
    return h1.textContent();
  }

  /**
   * Find an event card by its title text.
   */
  findEventByTitle(title: string | RegExp): Locator {
    // Events can be in featured or overflow sections
    return this.page
      .getByTestId('landing-featured-event')
      .or(this.page.getByTestId('landing-overflow-events'))
      .getByText(title);
  }

  /**
   * Check if an event with the given title is visible.
   */
  async isEventVisible(title: string | RegExp): Promise<boolean> {
    const event = this.findEventByTitle(title);
    return (await event.count()) > 0 && (await event.isVisible());
  }

  /**
   * Click on an event to navigate to its detail page.
   */
  async clickEvent(title: string | RegExp): Promise<void> {
    const event = this.findEventByTitle(title);
    await event.click();
  }

  /**
   * Get all visible event titles.
   */
  async getVisibleEventTitles(): Promise<string[]> {
    const titles: string[] = [];

    // Check featured event
    const featured = this.getFeaturedEventSection();
    if ((await featured.count()) > 0) {
      const title = featured.locator('h2');
      if ((await title.count()) > 0) {
        const text = await title.textContent();
        if (text) titles.push(text.trim());
      }
    }

    // Check overflow events
    const overflow = this.getOverflowEventsSection();
    if ((await overflow.count()) > 0) {
      const eventTitles = overflow.locator('h3');
      const count = await eventTitles.count();
      for (let i = 0; i < count; i++) {
        const text = await eventTitles.nth(i).textContent();
        if (text) titles.push(text.trim());
      }
    }

    return titles;
  }

  /**
   * Check if "Browse All" events link is visible.
   */
  async isBrowseAllVisible(): Promise<boolean> {
    const link = this.page.getByTestId('browse-all-events');
    return (await link.count()) > 0 && (await link.isVisible());
  }

  /**
   * Click the "Browse All" events link.
   */
  async clickBrowseAll(): Promise<void> {
    await this.page.getByTestId('browse-all-events').click();
  }

  /**
   * Get the login/signup button.
   */
  getAuthButton(): Locator {
    return this.page.locator('button', { hasText: /Log In|Sign Up/i });
  }

  /**
   * Click the login button.
   */
  async clickLogin(): Promise<void> {
    await this.getAuthButton().click();
  }

  /**
   * Assert that the page shows the expected event.
   */
  async expectEventVisible(title: string | RegExp): Promise<void> {
    await expect(this.findEventByTitle(title)).toBeVisible({ timeout: 30000 });
  }

  /**
   * Assert that the page does NOT show the given text.
   */
  async expectTextNotPresent(text: string | RegExp): Promise<void> {
    await expect(this.page.getByText(text)).toHaveCount(0);
  }
}
