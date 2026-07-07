import {ComponentHarness} from '@angular/cdk/testing';

/**
 * CDK harness for the purchases panel — covers the native buyer list and the
 * merged imported external-ticket section (source badges, per-entry removal,
 * and per-batch removal).
 */
export class EventManagementPurchasesPanelHarness extends ComponentHarness {
  static hostSelector = 'app-event-management-purchases-panel';

  private readonly getImportedSection = this.locatorForOptional(
    '[data-testid="imported-tickets-section"]',
  );
  private readonly getImportedBatches = this.locatorForAll(
    '[data-testid="imported-batch"]',
  );
  private readonly getSourceBadges = this.locatorForAll(
    '[data-testid="imported-source-badge"]',
  );
  private readonly getImportedRows = this.locatorForAll(
    '[data-testid="imported-entry-row"]',
  );

  async isImportedSectionVisible(): Promise<boolean> {
    return (await this.getImportedSection()) !== null;
  }

  async getImportedBatchCount(): Promise<number> {
    return (await this.getImportedBatches()).length;
  }

  async getImportedRowCount(): Promise<number> {
    return (await this.getImportedRows()).length;
  }

  async getSourceBadgeTexts(): Promise<string[]> {
    const badges = await this.getSourceBadges();
    return Promise.all(badges.map(async (b) => (await b.text()).trim()));
  }

  async clickRemoveImportedEntry(entryId: string): Promise<void> {
    const button = await this.locatorFor(
      `[data-testid="remove-imported-entry"][data-entry-id="${entryId}"]`,
    )();
    await button.click();
  }

  async getRemoveImportedEntryAriaLabel(
    entryId: string,
  ): Promise<string | null> {
    const button = await this.locatorFor(
      `[data-testid="remove-imported-entry"][data-entry-id="${entryId}"]`,
    )();
    return button.getAttribute('aria-label');
  }

  async clickRemoveImportedBatch(batchKey: string): Promise<void> {
    const button = await this.locatorFor(
      `[data-testid="remove-imported-batch"][data-batch-key="${batchKey}"]`,
    )();
    await button.click();
  }

  async isEntryCheckedInBadgeVisible(entryId: string): Promise<boolean> {
    const badge = await this.locatorForOptional(
      `[data-testid="imported-entry-row"][data-entry-id="${entryId}"] [data-testid="imported-entry-checked-in"]`,
    )();
    return badge !== null;
  }
}
