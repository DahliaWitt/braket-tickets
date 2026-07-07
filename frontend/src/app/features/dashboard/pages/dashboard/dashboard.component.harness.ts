import {ComponentHarness} from '@angular/cdk/testing';

export class DashboardComponentHarness extends ComponentHarness {
  static hostSelector = 'app-dashboard';

  private readonly eventTitles = this.locatorForAll(
    '[data-testid="dashboard-event-title"]',
  );

  /** Count elements carrying the given data-testid. */
  private async countByTestId(testId: string): Promise<number> {
    const els = await this.locatorForAll(`[data-testid="${testId}"]`)();
    return els.length;
  }

  /** Get all community cell elements from the community grid. */
  async getCommunityCells(): Promise<number> {
    return this.countByTestId('dashboard-community-cell');
  }

  /** Get community cell text by index. */
  async getCommunityCellText(index: number): Promise<string | null> {
    const cells = await this.locatorForAll(
      '[data-testid="dashboard-community-cell"]',
    )();
    if (index >= cells.length) return null;
    return (await cells[index].text()).trim();
  }

  /** Check whether the events section is rendered. */
  async hasEventsSection(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-events"]',
    )();
    return !!el;
  }

  /** Get the number of aspect-ratio poster frames in the events section. */
  async getPosterFrameCount(): Promise<number> {
    return this.countByTestId('dashboard-poster-frame');
  }

  /** Get the number of event poster images in the events section. */
  async getPosterCount(): Promise<number> {
    return this.countByTestId('dashboard-poster');
  }

  /** Get the number of ambient-fill poster backdrops in the events section. */
  async getPosterBackdropCount(): Promise<number> {
    return this.countByTestId('dashboard-poster-backdrop');
  }

  /**
   * Check that every poster backdrop is decorative: hidden from assistive
   * tech (aria-hidden) with an empty alt. Vacuously true when no backdrops
   * exist — assert presence separately via getPosterBackdropCount().
   */
  async posterBackdropsAreDecorative(): Promise<boolean> {
    const els = await this.locatorForAll(
      '[data-testid="dashboard-poster-backdrop"]',
    )();
    for (const el of els) {
      const ariaHidden = await el.getAttribute('aria-hidden');
      const alt = await el.getAttribute('alt');
      if (ariaHidden !== 'true' || alt !== '') return false;
    }
    return true;
  }

  /** Get all "Get Tickets" CTA hrefs. */
  async getGetTicketsHrefs(): Promise<string[]> {
    const els = await this.locatorForAll(
      '[data-testid="dashboard-get-tickets"]',
    )();
    const hrefs: string[] = [];
    for (const el of els) {
      const href = await el.getAttribute('href');
      if (href) hrefs.push(href);
    }
    return hrefs;
  }

  async getVisibleEventTitles(): Promise<string[]> {
    const titles = await this.eventTitles();
    return Promise.all(
      titles.map(async (title) => {
        const textContent = await title.getProperty<unknown>('textContent');
        return typeof textContent === 'string' ? textContent.trim() : '';
      }),
    );
  }

  /** Check whether the "Get Tickets" CTA is visible on the featured event. */
  async hasGetTicketsCta(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-get-tickets"]',
    )();
    return !!el;
  }

  /** Get the "find your people" heading text (new user state). */
  async getNewUserHeading(): Promise<string | null> {
    const headings = await this.locatorForAll('h1')();
    for (const h of headings) {
      const text = await h.text();
      if (text.toLowerCase().includes('find your people')) {
        return text.trim();
      }
    }
    return null;
  }

  /** Check whether the error state block is rendered. */
  async hasErrorState(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-error-state"]',
    )();
    return !!el;
  }

  /** Get the error state heading text. */
  async getErrorStateHeading(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-error-state"] h2',
    )();
    return el ? (await el.text()).trim() : null;
  }

  /** Check whether the "Try Again" button is present in the error state. */
  async hasTryAgainButton(): Promise<boolean> {
    const errorState = await this.locatorForOptional(
      '[data-testid="dashboard-error-state"]',
    )();
    if (!errorState) return false;
    const btn = await this.locatorForOptional(
      '[data-testid="dashboard-error-state"] button',
    )();
    return !!btn;
  }

  async getApplyLinkCount(): Promise<number> {
    const links = await this.locatorForAll(
      '[data-testid="dashboard-apply-link"]',
    )();
    return links.length;
  }

  async hasDiscoverSection(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-discover-section"]',
    )();
    return !!el;
  }

  async getDiscoverCommunityCount(): Promise<number> {
    const rows = await this.locatorForAll(
      '[data-testid="dashboard-discover-apply"]',
    )();
    return rows.length;
  }

  async getDiscoverCommunityText(index: number): Promise<string | null> {
    const rows = await this.locatorForAll(
      '[data-testid="dashboard-discover-apply"]',
    )();
    if (index >= rows.length) return null;
    return (await rows[index].text()).trim();
  }

  async getResubmitStripText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-resubmit-strip"]',
    )();
    return el ? (await el.text()).trim() : null;
  }

  async getResubmitCtaHref(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="dashboard-resubmit-cta"]',
    )();
    return el ? el.getAttribute('href') : null;
  }

  async getCommunityResubmitHrefs(): Promise<string[]> {
    const links = await this.locatorForAll(
      '[data-testid="dashboard-community-resubmit"]',
    )();
    const hrefs: string[] = [];
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href) hrefs.push(href);
    }
    return hrefs;
  }

  /** Check whether the application status element is present. */
  async isApplicationStatusVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="application-status"]',
    )();
    return el !== null;
  }

  /** Get the text content of the application status element. */
  async getApplicationStatusText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="application-status"]',
    )();
    return el ? (await el.text()).trim() : null;
  }

  /** Check whether the page-level loading skeleton is rendered. */
  async hasLoadingSkeleton(): Promise<boolean> {
    const el = await this.locatorForOptional('z-skeleton')();
    return el !== null;
  }
}
