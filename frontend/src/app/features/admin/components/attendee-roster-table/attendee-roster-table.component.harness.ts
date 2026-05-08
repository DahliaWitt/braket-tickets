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

  /** Returns the row element for a given email, or null if not visible. */
  async getRowByEmail(email: string): Promise<TestElement | null> {
    const rows = await this.getRows();
    for (const row of rows) {
      const rowEmail = await row.getAttribute('data-email');
      if (rowEmail === email) return row;
    }
    return null;
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
