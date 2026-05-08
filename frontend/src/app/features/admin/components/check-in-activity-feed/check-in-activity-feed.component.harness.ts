import { ComponentHarness } from '@angular/cdk/testing';

export class CheckInActivityFeedHarness extends ComponentHarness {
  static hostSelector = 'app-check-in-activity-feed';

  private readonly getEntries = this.locatorForAll('[data-testid="feed-entry"]');
  private readonly getEmptyState = this.locatorForOptional('[data-testid="feed-empty-state"]');
  private readonly getNameEls = this.locatorForAll('[data-testid="feed-entry-name"]');

  async getFeedEntryCount(): Promise<number> {
    return (await this.getEntries()).length;
  }

  /** Returns the attendee name from the most recent (topmost) entry, or null if empty. */
  async getMostRecentEntryName(): Promise<string | null> {
    const names = await this.getNameEls();
    if (names.length === 0) return null;
    return (await names[0].text()).trim();
  }

  async isEmptyStateVisible(): Promise<boolean> {
    return (await this.getEmptyState()) !== null;
  }
}
