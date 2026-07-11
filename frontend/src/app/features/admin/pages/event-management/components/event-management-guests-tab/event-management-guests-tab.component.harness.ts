import {ComponentHarness} from '@angular/cdk/testing';
import {ZardButtonComponentHarness} from '@ui/components/primitives/button/button.component.harness';
// Direct harness import (not the feature barrel): the barrel re-exports the
// ImportSurfaceComponent, dragging @angular/common injectables into the
// Playwright/Node graph and triggering JIT compilation the E2E runtime lacks.
import {ImportSurfaceComponentHarness} from '@/features/admin/import/import-surface.component.harness';

export class EventManagementGuestsTabHarness extends ComponentHarness {
  static hostSelector = 'app-event-management-guests-tab';

  private readonly getAddGuestButton = this.locatorFor(
    ZardButtonComponentHarness.with({
      selector: '[data-testid="add-guest-button"]',
    }),
  );
  private readonly getImportButton = this.locatorFor(
    '[data-testid="import-guests-button"]',
  );
  private readonly getImportPanel = this.locatorForOptional(
    '[data-testid="guest-import-panel"]',
  );
  private readonly getImportClose = this.locatorForOptional(
    '[data-testid="guest-import-close"]',
  );
  private readonly getImportSurface = this.locatorForOptional(
    ImportSurfaceComponentHarness,
  );
  private readonly getDownloadButtons = this.locatorForAll(
    'button[aria-label^="Download ticket for "]',
  );
  private readonly getSendButtonHarnesses = this.locatorForAll(
    ZardButtonComponentHarness.with({
      selector: '[data-testid="send-guest-ticket"]',
    }),
  );
  private readonly getSendAllButton = this.locatorFor(
    ZardButtonComponentHarness.with({
      selector: '[data-testid="send-all-tickets"]',
    }),
  );
  private readonly getRemoveButtons = this.locatorForAll(
    '[data-testid="remove-guest"]',
  );
  private readonly getGuestRows = this.locatorForAll(
    '[data-testid="guest-row"]',
  );
  private readonly getEditButtons = this.locatorForAll(
    '[data-testid="edit-guest"]',
  );

  async clickAddGuestButton(): Promise<void> {
    const button = await this.getAddGuestButton();
    await button.click();
  }

  async clickImportButton(): Promise<void> {
    await (await this.getImportButton()).click();
  }

  async isImportPanelOpen(): Promise<boolean> {
    return (await this.getImportPanel()) !== null;
  }

  async clickImportClose(): Promise<void> {
    const button = await this.getImportClose();
    if (button) await button.click();
  }

  /** The lazily-rendered import surface harness (null until the panel opens). */
  async getImportSurfaceHarness(): Promise<ImportSurfaceComponentHarness | null> {
    return this.getImportSurface();
  }

  async getDownloadButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getDownloadButtons();
    return Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  }

  async clickSendAllButton(): Promise<void> {
    const button = await this.getSendAllButton();
    await button.click();
  }

  async getSendAllButtonText(): Promise<string> {
    const button = await this.getSendAllButton();
    return button.getText();
  }

  async isSendAllButtonDisabled(): Promise<boolean> {
    const button = await this.getSendAllButton();
    return button.isDisabled();
  }

  async isSendAllButtonMuted(): Promise<boolean> {
    const button = await this.getSendAllButton();
    return button.hasClass('text-muted-foreground/60');
  }

  async getSendButtonTexts(): Promise<string[]> {
    const buttons = await this.getSendButtonHarnesses();
    return Promise.all(buttons.map((button) => button.getText()));
  }

  async getSendButtonAriaBusyStates(): Promise<(string | null)[]> {
    const buttons = await this.getSendButtonHarnesses();
    return Promise.all(buttons.map((button) => button.getAriaBusy()));
  }

  async getSendButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getSendButtonHarnesses();
    return Promise.all(buttons.map((button) => button.getAriaLabel()));
  }

  async getRemoveButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getRemoveButtons();
    return Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  }

  /**
   * Text of every guest row. Returns both the desktop and mobile responsive
   * variants, so callers assert with `.some(...)` rather than a single-match
   * locator (which would trip strict mode across the split).
   */
  async getGuestRowTexts(): Promise<string[]> {
    const rows = await this.getGuestRows();
    return Promise.all(rows.map(async (row) => (await row.text()).trim()));
  }

  async hasGuestRowWithText(text: string): Promise<boolean> {
    return (await this.getGuestRowTexts()).some((t) => t.includes(text));
  }

  async getEditButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getEditButtons();
    return Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  }

  async clickEditGuestButton(index: number): Promise<void> {
    const buttons = await this.getEditButtons();
    const button = buttons[index];
    if (!button) {
      throw new Error(`No edit-guest button found at index ${index}`);
    }
    await button.click();
  }
}
