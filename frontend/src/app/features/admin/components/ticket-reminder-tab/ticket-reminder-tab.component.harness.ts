import { ComponentHarness } from '@angular/cdk/testing';

export class TicketReminderTabHarness extends ComponentHarness {
  static hostSelector = 'app-ticket-reminder-tab';

  private readonly getRecipientCount = this.locatorFor(
    '[data-testid="ticket-reminder-recipient-count"]',
  );
  private readonly getSendButton = this.locatorFor('[data-testid="send-ticket-reminder"]');
  private readonly getSubjectInput = this.locatorFor('[data-testid="ticket-reminder-subject"]');
  private readonly getMessageInput = this.locatorFor('[data-testid="ticket-reminder-message"]');
  private readonly getAudienceError = this.locatorForOptional(
    '[data-testid="ticket-reminder-audience-error"]',
  );

  async getRecipientCountText(): Promise<string> {
    const element = await this.getRecipientCount();
    return (await element.text()).trim();
  }

  async getAudienceErrorText(): Promise<string | null> {
    const element = await this.getAudienceError();
    if (!element) return null;
    return (await element.text()).trim();
  }

  async isSendDisabled(): Promise<boolean> {
    const button = await this.getSendButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async setSubject(value: string): Promise<void> {
    const input = await this.getSubjectInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async setMessage(value: string): Promise<void> {
    const input = await this.getMessageInput();
    await input.clear();
    await input.sendKeys(value);
  }

}
