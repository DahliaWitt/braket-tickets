import {ComponentHarness} from '@angular/cdk/testing';

export class AdminRemindersHarness extends ComponentHarness {
  static hostSelector = 'app-admin-reminders';

  private getSubjectInput = this.locatorFor(
    '[data-testid="vetting-reminder-subject"]',
  );
  private getMessageInput = this.locatorFor(
    '[data-testid="vetting-reminder-message"]',
  );
  private getSendButton = this.locatorFor(
    '[data-testid="send-vetting-reminder"]',
  );
  private getRecipientCount = this.locatorForOptional(
    '[data-testid="vetting-reminder-recipient-count"]',
  );
  private getAudienceLoading = this.locatorForOptional(
    '[data-testid="vetting-reminder-audience-loading"]',
  );
  private getAudienceError = this.locatorForOptional(
    '[data-testid="vetting-reminder-audience-error"]',
  );
  private getLengthError = this.locatorForOptional(
    '[data-testid="vetting-reminder-length-error"]',
  );

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

  async isSendDisabled(): Promise<boolean> {
    const button = await this.getSendButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async clickSend(): Promise<void> {
    const button = await this.getSendButton();
    await button.click();
  }

  async getRecipientCountText(): Promise<string | null> {
    const el = await this.getRecipientCount();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async isAudienceLoading(): Promise<boolean> {
    const el = await this.getAudienceLoading();
    return el !== null;
  }

  async getAudienceErrorText(): Promise<string | null> {
    const el = await this.getAudienceError();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async hasLengthError(): Promise<boolean> {
    const el = await this.getLengthError();
    return el !== null;
  }

}
