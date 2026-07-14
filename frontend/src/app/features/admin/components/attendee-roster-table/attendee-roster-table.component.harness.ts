import {ComponentHarness, type TestElement} from '@angular/cdk/testing';

export class AttendeeRosterTableHarness extends ComponentHarness {
  static hostSelector = 'app-attendee-roster-table';

  private readonly getRows = this.locatorForAll('[data-testid="roster-row"]');
  private readonly getExportButton = this.locatorForOptional(
    '[data-testid="export-csv-button"]',
  );
  private readonly getLoadMoreButton = this.locatorForOptional(
    '[data-testid="load-more-button"]',
  );
  private readonly getShowRefundedToggle = this.locatorFor(
    '[data-testid="show-refunded-toggle"]',
  );
  private readonly getSearchInput = this.locatorFor(
    '[data-testid="roster-search"]',
  );
  private readonly getColumnHeaders = this.locatorForAll(
    '[data-testid="roster-table"] thead th',
  );
  private readonly getScrollRegion = this.locatorFor(
    '[data-testid="roster-scroll-region"]',
  );

  async getVisibleRowCount(): Promise<number> {
    return (await this.getRows()).length;
  }

  async getColumnHeaderLabels(): Promise<string[]> {
    const headers = await this.getColumnHeaders();
    return Promise.all(
      headers.map(async (header) => (await header.text()).trim()),
    );
  }

  async hasColumnHeader(label: string): Promise<boolean> {
    const headers = await this.getColumnHeaderLabels();
    return headers.includes(label);
  }

  async getScrollRegionAttributes(): Promise<{
    role: string | null;
    label: string | null;
    tabindex: string | null;
  }> {
    const region = await this.getScrollRegion();
    return {
      role: await region.getAttribute('role'),
      label: await region.getAttribute('aria-label'),
      tabindex: await region.getAttribute('tabindex'),
    };
  }

  async focusScrollRegion(): Promise<void> {
    const region = await this.getScrollRegion();
    await region.focus();
  }

  async isScrollRegionFocused(): Promise<boolean> {
    const region = await this.getScrollRegion();
    return region.isFocused();
  }

  /** Returns the row element for a given email, or null if not visible. */
  async getRowByEmail(email: string): Promise<TestElement | null> {
    const rows = await this.getRows();
    for (const row of rows) {
      const rowEmail = await row.getAttribute('data-email');
      if (rowEmail === email) return row;
    }
    return null;
  }

  async getCheckInTimeByEmail(email: string): Promise<string | null> {
    const time = await this.locatorForOptional(
      `[data-testid="roster-row"][data-email="${email}"] [data-testid="row-checkin-time"]`,
    )();
    if (!time) return null;
    return (await time.text()).trim();
  }

  async loadMore(): Promise<void> {
    const btn = await this.getLoadMoreButton();
    if (!btn) throw new Error('Load more button is not visible');
    await btn.click();
  }

  async isExportButtonVisible(): Promise<boolean> {
    return (await this.getExportButton()) !== null;
  }

  async isLoadMoreButtonVisible(): Promise<boolean> {
    return (await this.getLoadMoreButton()) !== null;
  }

  async clickExport(): Promise<void> {
    const btn = await this.getExportButton();
    if (!btn) throw new Error('Export button is not visible');
    await btn.click();
  }

  async toggleShowRefunded(): Promise<void> {
    const toggle = await this.getShowRefundedToggle();
    await toggle.click();
  }

  async searchRoster(query: string): Promise<void> {
    const input = await this.getSearchInput();
    await input.clear();
    await input.sendKeys(query);
    // Dispatch input event to trigger Angular signal update
    await input.dispatchEvent('input');
  }

  async clearSearch(): Promise<void> {
    const input = await this.getSearchInput();
    await input.clear();
    await input.dispatchEvent('input');
  }
}
