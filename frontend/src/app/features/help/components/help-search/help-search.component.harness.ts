import {ComponentHarness} from '@angular/cdk/testing';

export class HelpSearchComponentHarness extends ComponentHarness {
  static hostSelector = 'app-help-search';

  private getSearchInput = this.locatorFor('[data-testid="help-search-input"]');
  private getResultsContainer = this.locatorForOptional(
    '[data-testid="help-search-results"]',
  );
  private getResultButtons = this.locatorForAll(
    '[data-testid="help-search-results"] button[role="option"]',
  );
  private getBadgeElements = this.locatorForAll(
    '[data-testid="help-search-result-badge"]',
  );

  async typeQuery(value: string): Promise<void> {
    const input = await this.getSearchInput();
    await input.clear();
    await input.sendKeys(value);
    await input.dispatchEvent('input');
  }

  async getQueryValue(): Promise<string> {
    const input = await this.getSearchInput();
    return input.getProperty<string>('value');
  }

  async isResultsDropdownVisible(): Promise<boolean> {
    return (await this.getResultsContainer()) !== null;
  }

  async getResultCount(): Promise<number> {
    const results = await this.getResultButtons();
    return results.length;
  }

  async getResultTitles(): Promise<string[]> {
    const buttons = await this.getResultButtons();
    const titles: string[] = [];
    for (const btn of buttons) {
      const titleEl = await btn.text();
      titles.push(titleEl.trim());
    }
    return titles;
  }

  async clickResult(index: number): Promise<void> {
    const buttons = await this.getResultButtons();
    if (index < 0 || index >= buttons.length) {
      throw new Error(
        `Result index ${index} out of bounds (${buttons.length} results)`,
      );
    }
    await buttons[index].click();
  }

  async getResultBadgeLabels(): Promise<string[]> {
    const badges = await this.getBadgeElements();
    const labels: string[] = [];
    for (const badge of badges) {
      labels.push((await badge.text()).trim());
    }
    return labels;
  }

  async isNoResultsMessageVisible(): Promise<boolean> {
    const noResults = await this.locatorForOptional(
      '[data-testid="help-search-no-results"]',
    )();
    return noResults !== null;
  }

  async getNoResultsMessageText(): Promise<string | null> {
    const noResults = await this.locatorForOptional(
      '[data-testid="help-search-no-results"]',
    )();
    return noResults ? noResults.text() : null;
  }

  async pressArrowDown(): Promise<void> {
    const input = await this.getSearchInput();
    await input.sendKeys('ArrowDown');
  }

  async pressArrowUp(): Promise<void> {
    const input = await this.getSearchInput();
    await input.sendKeys('ArrowUp');
  }

  async pressEnter(): Promise<void> {
    const input = await this.getSearchInput();
    await input.sendKeys('\n');
  }

  async pressEscape(): Promise<void> {
    const input = await this.getSearchInput();
    await input.sendKeys('\u001B');
  }

  async getAriaExpanded(): Promise<string | null> {
    const input = await this.getSearchInput();
    return input.getAttribute('aria-expanded');
  }

  async focus(): Promise<void> {
    const input = await this.getSearchInput();
    await input.focus();
  }

  async blur(): Promise<void> {
    const input = await this.getSearchInput();
    await input.blur();
  }

  /** Simulates focus leaving the component entirely (no relatedTarget). */
  async dispatchFocusOutside(): Promise<void> {
    const hostEl = await this.host();
    await hostEl.dispatchEvent('focusout');
  }

  async dispatchFocus(): Promise<void> {
    const input = await this.getSearchInput();
    await input.dispatchEvent('focus');
  }
}
