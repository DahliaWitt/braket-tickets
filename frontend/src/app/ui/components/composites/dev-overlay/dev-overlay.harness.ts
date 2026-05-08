import { ComponentHarness } from '@angular/cdk/testing';

export class DevOverlayComponentHarness extends ComponentHarness {
  static hostSelector = 'app-dev-overlay';

  private getOverlayDiv = this.locatorForOptional('[data-testid="dev-overlay"]');
  private getLabelSpan = this.locatorForOptional('[data-testid="dev-overlay"] span.font-semibold');

  /** Returns true if the overlay badge is present in the DOM (i.e. not in production mode). */
  async isVisible(): Promise<boolean> {
    return (await this.getOverlayDiv()) !== null;
  }

  /** Clicks the overlay badge to toggle expanded state. */
  async toggle(): Promise<void> {
    const div = await this.getOverlayDiv();
    if (!div) throw new Error('Dev overlay is not visible (production mode or hidden)');
    await div.click();
  }

  /**
   * Returns the label text displayed in the badge (e.g. "LOCAL" or "DEV").
   * Returns null if the overlay is not visible.
   */
  async getLabelText(): Promise<string | null> {
    const span = await this.getLabelSpan();
    return span ? (await span.text()).trim() : null;
  }

  /**
   * Returns true if the expanded detail (branch + commit hash) is currently shown.
   * Detects expansion by checking for the separator "|" span inside the overlay.
   */
  async isExpanded(): Promise<boolean> {
    const div = await this.getOverlayDiv();
    if (!div) return false;
    const text = await div.text();
    // When expanded, the branch/commit info is appended after the separator character
    return text.includes('|');
  }

  /**
   * Returns the full text content of the overlay badge.
   * Returns null if the overlay is not visible.
   */
  async getBadgeText(): Promise<string | null> {
    const div = await this.getOverlayDiv();
    return div ? (await div.text()).trim() : null;
  }
}
