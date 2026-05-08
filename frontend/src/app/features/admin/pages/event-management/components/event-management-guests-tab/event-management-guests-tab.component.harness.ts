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
  private readonly getRemoveButtons = this.locatorForAll(
    '[data-testid="remove-guest"]',
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
}
