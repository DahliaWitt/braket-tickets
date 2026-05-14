/**
 * Landing Page Object for E2E tests
 *
 * Provides a stable API for interacting with the landing page.
 * Mirrors the structure of component harnesses for consistency.
 */

import {Locator, Page, expect} from '@playwright/test';

export class LandingPage {
  constructor(private page: Page) {}

  // Section locators
  private getHeroSection(): Locator {
    return this.page.getByTestId('landing-hero');
  }

  private getEventsSection(): Locator {
    return this.page.getByTestId('landing-events');
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
    await expect(this.getHeroSection()).toBeVisible({timeout});
  }

  /**
   * Check if hero section is visible.
   */
  async isHeroVisible(): Promise<boolean> {
    const el = this.getHeroSection();
    return (await el.count()) > 0 && (await el.isVisible());
  }

  /**
   * Check if events section is visible.
   */
  async isEventsVisible(): Promise<boolean> {
    const el = this.getEventsSection();
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
    const h1 = this.page.getByRole('heading', {level: 1});
    if ((await h1.count()) === 0) return null;
    return h1.textContent();
  }

  /**
   * Find an event card by its title text.
   */
  findEventByTitle(title: string | RegExp): Locator {
    return this.getEventsSection().getByText(title);
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
    const section = this.getEventsSection();
    if ((await section.count()) === 0) return [];

    return (await section.locator('h2').allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
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
    return this.page.locator('button', {hasText: /Log In|Sign Up/i});
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
    await expect(this.findEventByTitle(title)).toBeVisible({timeout: 30000});
  }

  /**
   * Assert that the page does NOT show the given text.
   */
  async expectTextNotPresent(text: string | RegExp): Promise<void> {
    await expect(this.page.getByText(text)).toHaveCount(0);
  }
}
