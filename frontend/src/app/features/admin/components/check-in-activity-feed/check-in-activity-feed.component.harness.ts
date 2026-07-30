import {ComponentHarness} from '@angular/cdk/testing';

export class CheckInActivityFeedHarness extends ComponentHarness {
  static hostSelector = 'app-check-in-activity-feed';

  private readonly getEntries = this.locatorForAll(
    '[data-testid="feed-entry"]',
  );
  private readonly getEmptyState = this.locatorForOptional(
    '[data-testid="feed-empty-state"]',
  );
  private readonly getNameEls = this.locatorForAll(
    '[data-testid="feed-entry-name"]',
  );
  private readonly getTimestampEls = this.locatorForAll(
    '[data-testid="feed-entry-timestamp"]',
  );

  async getFeedEntryCount(): Promise<number> {
    return (await this.getEntries()).length;
  }

  /** Returns the attendee name from the most recent (topmost) entry, or null if empty. */
  async getMostRecentEntryName(): Promise<string | null> {
    const names = await this.getNameEls();
    if (names.length === 0) return null;
    return (await names[0].text()).trim();
  }

  async getMostRecentEntryTimestamp(): Promise<string | null> {
    const timestamps = await this.getTimestampEls();
    if (timestamps.length === 0) return null;
    return (await timestamps[0].text()).trim();
  }

  async getMostRecentEntryClasses(): Promise<string[]> {
    const entries = await this.getEntries();
    if (entries.length === 0) return [];
    return ((await entries[0].getAttribute('class')) ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  async getMostRecentEntryTimestampClasses(): Promise<string[]> {
    const timestamps = await this.getTimestampEls();
    if (timestamps.length === 0) return [];
    return ((await timestamps[0].getAttribute('class')) ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  async isEmptyStateVisible(): Promise<boolean> {
    return (await this.getEmptyState()) !== null;
  }
}
