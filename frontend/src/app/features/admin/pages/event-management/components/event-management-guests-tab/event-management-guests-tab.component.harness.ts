import {ComponentHarness} from '@angular/cdk/testing';
import {ZardButtonComponentHarness} from '@ui/components/primitives/button/button.component.harness';

export class EventManagementGuestsTabHarness extends ComponentHarness {
  static hostSelector = 'app-event-management-guests-tab';

  private readonly getAddGuestButton = this.locatorFor(
    ZardButtonComponentHarness.with({text: /Add Guest/}),
  );
  private readonly getDownloadButtons = this.locatorForAll(
    'button[aria-label^="Download ticket for "]',
  );
  private readonly getSendButtons = this.locatorForAll(
    '[data-testid="send-guest-ticket"]',
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
  private readonly getEditButtons = this.locatorForAll(
    '[data-testid="edit-guest"]',
  );

  async clickAddGuestButton(): Promise<void> {
    const button = await this.getAddGuestButton();
    await button.click();
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

  async getSendButtonTexts(): Promise<string[]> {
    const buttons = await this.getSendButtonHarnesses();
    return Promise.all(buttons.map((button) => button.getText()));
  }

  async getSendButtonAriaBusyStates(): Promise<(string | null)[]> {
    const buttons = await this.getSendButtonHarnesses();
    return Promise.all(buttons.map((button) => button.getAriaBusy()));
  }

  async getSendButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getSendButtons();
    return Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  }

  async getRemoveButtonAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getRemoveButtons();
    return Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
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
