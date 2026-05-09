import {
  ComponentHarness,
  TestKey,
  type TestElement,
} from '@angular/cdk/testing';

export class AuditLogTableHarness extends ComponentHarness {
  static hostSelector = 'app-audit-log-table';

  // Rows
  private getRowEls = this.locatorForAll('[data-testid="audit-log-row"]');
  getRows(): Promise<TestElement[]> {
    return this.getRowEls();
  }
  async getRowCount(): Promise<number> {
    return (await this.getRows()).length;
  }

  // Column headers
  private getHeaderEls = this.locatorForAll(
    '[data-testid="audit-log-header"] th',
  );
  async getColumnHeaders(): Promise<string[]> {
    const headers = await this.getHeaderEls();
    return Promise.all(headers.map((h) => h.text()));
  }

  // Filters
  private getCategorySelect = this.locatorFor(
    '[data-testid="filter-category"]',
  );
  private getTimeSelect = this.locatorFor('[data-testid="filter-time-window"]');

  async getFilterCategory(): Promise<string> {
    const el = await this.getCategorySelect();
    return (await el.getProperty<string>('value')) ?? '';
  }
  async getFilterCategoryClass(): Promise<string> {
    const el = await this.getCategorySelect();
    return (await el.getAttribute('class')) ?? '';
  }
  async setFilterCategory(value: string): Promise<void> {
    const el = await this.getCategorySelect();
    await el.setInputValue(value);
    await el.dispatchEvent('change');
  }
  async getFilterTimeWindow(): Promise<string> {
    const el = await this.getTimeSelect();
    return (await el.getProperty<string>('value')) ?? '';
  }
  async getFilterTimeWindowClass(): Promise<string> {
    const el = await this.getTimeSelect();
    return (await el.getAttribute('class')) ?? '';
  }
  async setFilterTimeWindow(value: string): Promise<void> {
    const el = await this.getTimeSelect();
    await el.setInputValue(value);
    await el.dispatchEvent('change');
  }

  // Load more
  private getLoadMoreEl = this.locatorForOptional(
    '[data-testid="load-more-button"]',
  );
  getLoadMoreButton(): Promise<TestElement | null> {
    return this.getLoadMoreEl();
  }
  async hasLoadMoreButton(): Promise<boolean> {
    return (await this.getLoadMoreEl()) !== null;
  }

  // Empty state
  private getEmptyEl = this.locatorForOptional('[data-testid="empty-state"]');
  async hasEmptyState(): Promise<boolean> {
    return (await this.getEmptyEl()) !== null;
  }
  async getEmptyStateText(): Promise<string> {
    const el = await this.getEmptyEl();
    return el ? (await el.text()).trim() : '';
  }

  // Skeletons
  private getSkeletonEls = this.locatorForAll('[data-testid="skeleton-row"]');
  async hasSkeletons(): Promise<boolean> {
    return (await this.getSkeletonEls()).length > 0;
  }

  // Detail triggers — the desktop buttons inside each row's Details cell
  private getDetailTriggerEls = this.locatorForAll(
    '[data-testid="audit-log-detail-trigger"]',
  );

  /** Returns an attribute from the desktop detail trigger at the given index. */
  async getDetailTriggerAttribute(
    index: number,
    name: string,
  ): Promise<string | null> {
    const triggers = await this.getDetailTriggerEls();
    return triggers[index] ? triggers[index].getAttribute(name) : null;
  }

  /** Returns the title attribute of the admin name span in a desktop row. */
  async getDesktopAdminTitle(index: number): Promise<string | null> {
    const spans = await this.locatorForAll(
      'table [data-testid="audit-log-row"] [title]',
    )();
    return spans[index] ? spans[index].getAttribute('title') : null;
  }

  private getDesktopRowEls = this.locatorForAll(
    'table [data-testid="audit-log-row"]',
  );

  /** Returns an attribute from a desktop table row at the given index. */
  async getDesktopRowAttribute(
    index: number,
    name: string,
  ): Promise<string | null> {
    const rows = await this.getDesktopRowEls();
    return rows[index] ? rows[index].getAttribute(name) : null;
  }

  // Mobile toggle buttons
  private getMobileToggleButtons = this.locatorForAll(
    '.md\\:hidden [data-testid="audit-log-row"] button',
  );

  /** Returns the aria-label of a mobile toggle button at the given index. */
  async getMobileToggleAriaLabel(index: number): Promise<string | null> {
    const buttons = await this.getMobileToggleButtons();
    return buttons[index] ? buttons[index].getAttribute('aria-label') : null;
  }

  /** Returns the aria-expanded attribute of a mobile toggle button at the given index. */
  async getMobileToggleAriaExpanded(index: number): Promise<string | null> {
    const buttons = await this.getMobileToggleButtons();
    return buttons[index] ? buttons[index].getAttribute('aria-expanded') : null;
  }

  /** Returns the text content of the deleted-event element in the expanded detail at the given index. */
  async getDeletedEventText(index = 0): Promise<string | null> {
    const els = await this.locatorForAll(
      '[data-testid="expanded-deleted-event"]',
    )();
    return els[index] ? (await els[index].text()).trim() : null;
  }

  /** Returns the text content of the target-user element in the expanded detail at the given index. */
  async getTargetUserText(index = 0): Promise<string | null> {
    const els = await this.locatorForAll(
      '[data-testid="expanded-target-user"]',
    )();
    return els[index] ? (await els[index].text()).trim() : null;
  }

  /** Clicks a desktop detail trigger to toggle its expanded detail view. */
  async clickDesktopDetailTrigger(index: number): Promise<void> {
    const triggers = await this.getDetailTriggerEls();
    if (triggers[index]) await triggers[index].click();
  }

  /** Presses Enter on a desktop detail trigger. */
  async pressEnterOnDesktopDetailTrigger(index: number): Promise<void> {
    const triggers = await this.getDetailTriggerEls();
    if (!triggers[index]) return;
    await triggers[index].focus();
    await triggers[index].sendKeys(TestKey.ENTER);
  }

  /** Presses Space on a desktop detail trigger. */
  async pressSpaceOnDesktopDetailTrigger(index: number): Promise<void> {
    const triggers = await this.getDetailTriggerEls();
    if (!triggers[index]) return;
    await triggers[index].focus();
    await triggers[index].sendKeys(' ');
  }

  /** Returns the number of expanded detail rows (desktop only — uses @if so reliable for counting). */
  private getExpandedRowEls = this.locatorForAll(
    '[data-testid="audit-log-expanded-row"]',
  );
  async getExpandedDetailCount(): Promise<number> {
    return (await this.getExpandedRowEls()).length;
  }

  private getExpandedRegionEls = this.locatorForAll(
    '[data-testid="audit-log-expanded-row"] [role="region"]',
  );
  async getExpandedRegionAttribute(name: string): Promise<string | null> {
    const els = await this.getExpandedRegionEls();
    return els[0] ? els[0].getAttribute(name) : null;
  }

  /** Returns the text content of the first expanded detail row. */
  async getExpandedDetailText(): Promise<string> {
    const els = await this.getExpandedRowEls();
    if (els.length === 0) return '';
    return (await els[0].text()).trim();
  }
}
