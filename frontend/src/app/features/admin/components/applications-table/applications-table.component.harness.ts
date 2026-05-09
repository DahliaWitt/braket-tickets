import {ComponentHarness} from '@angular/cdk/testing';

export class AdminApplicationsTableHarness extends ComponentHarness {
  static hostSelector = 'app-admin-applications-table';

  private getRows = this.locatorForAll('[data-testid="application-row"]');
  private getApproveButtons = this.locatorForAll(
    '[data-testid="approve-application"]',
  );
  private getRejectButtons = this.locatorForAll(
    '[data-testid="reject-application"]',
  );
  private getStatusBadges = this.locatorForAll(
    '[data-testid="application-status"]',
  );
  private getLoadingIndicator = this.locatorForOptional('[aria-busy="true"]');
  private getNoAnswersIndicators = this.locatorForAll(
    '[data-testid="no-vetting-answers"]',
  );
  private getSearchInput = this.locatorForOptional(
    'input[data-testid="applications-search"]',
  );

  async setSearchValue(value: string): Promise<void> {
    const input = await this.getSearchInput();
    if (!input) throw new Error('Search input not found');
    await input.clear();
    if (value) {
      await input.sendKeys(value);
    }
  }

  async getSearchValue(): Promise<string> {
    const input = await this.getSearchInput();
    if (!input) return '';
    return (await input.getProperty<string>('value')) ?? '';
  }

  async hasSearchInput(): Promise<boolean> {
    return (await this.getSearchInput()) !== null;
  }

  async getRowCount(): Promise<number> {
    return (await this.getRows()).length;
  }

  async isLoading(): Promise<boolean> {
    return (await this.getLoadingIndicator()) !== null;
  }

  async getRowTexts(): Promise<string[]> {
    const rows = await this.getRows();
    return Promise.all(rows.map((row) => row.text()));
  }

  async clickApproveAtIndex(index: number): Promise<void> {
    const buttons = await this.getApproveButtons();
    await buttons[index]?.click();
  }

  async clickRejectAtIndex(index: number): Promise<void> {
    const buttons = await this.getRejectButtons();
    await buttons[index]?.click();
  }

  async getStatusTextAtIndex(index: number): Promise<string> {
    const badges = await this.getStatusBadges();
    return ((await badges[index]?.text()) ?? '').trim();
  }

  async getApproveButtonCount(): Promise<number> {
    return (await this.getApproveButtons()).length;
  }

  async getNoAnswersCount(): Promise<number> {
    return (await this.getNoAnswersIndicators()).length;
  }
}
