import {ComponentHarness, TestKey} from '@angular/cdk/testing';

export class TicketTransferControlsComponentHarness extends ComponentHarness {
  static hostSelector = 'app-ticket-transfer-controls';

  async hasTransferButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="ticket-transfer-open"]',
    )();
    return btn !== null;
  }

  async clickTransferButton(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="ticket-transfer-open"]')();
    await btn.click();
  }

  async isTransferButtonFocused(): Promise<boolean> {
    const btn = await this.locatorFor('[data-testid="ticket-transfer-open"]')();
    return btn.isFocused();
  }

  async hasTransferPanel(): Promise<boolean> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-panel"]',
    )();
    return panel !== null;
  }

  async enterTransferEmail(email: string): Promise<void> {
    const input = await this.locatorFor(
      '[data-testid="transfer-email-input"]',
    )();
    await input.clear();
    await input.sendKeys(email);
  }

  async isTransferEmailFocused(): Promise<boolean> {
    const input = await this.locatorFor(
      '[data-testid="transfer-email-input"]',
    )();
    return input.isFocused();
  }

  async pressEnterInTransferEmail(): Promise<void> {
    const input = await this.locatorFor(
      '[data-testid="transfer-email-input"]',
    )();
    await input.sendKeys(TestKey.ENTER);
  }

  async clickValidateTransferRecipient(): Promise<void> {
    const btn = await this.locatorFor(
      '[data-testid="transfer-validate-button"]',
    )();
    await btn.click();
  }

  async hasValidateTransferRecipientButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="transfer-validate-button"]',
    )();
    return btn !== null;
  }

  async getTransferErrorText(): Promise<string | null> {
    const error = await this.locatorForOptional(
      '[data-testid="transfer-error"]',
    )();
    return error ? (await error.text()).trim() : null;
  }

  async hasTransferConfirmationPanel(): Promise<boolean> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-confirmation-panel"]',
    )();
    return panel !== null;
  }

  async getTransferConfirmationText(): Promise<string | null> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-confirmation-panel"]',
    )();
    return panel ? (await panel.text()).trim() : null;
  }

  async clickConfirmTransfer(): Promise<void> {
    const btn = await this.locatorFor(
      '[data-testid="transfer-confirm-button"]',
    )();
    await btn.click();
  }

  async clickCancelTransferFlow(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="transfer-cancel-flow"]')();
    await btn.click();
  }

  async hasCancelTransferFlowButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="transfer-cancel-flow"]',
    )();
    return btn !== null;
  }
}
