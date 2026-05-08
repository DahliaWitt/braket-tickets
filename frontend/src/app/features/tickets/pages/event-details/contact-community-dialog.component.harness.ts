import { ComponentHarness } from '@angular/cdk/testing';

export class ContactCommunityDialogHarness extends ComponentHarness {
  static hostSelector = 'app-contact-community-dialog';

  private readonly getEmailSection = this.locatorForOptional(
    '[data-testid="contact-dialog-email-section"]',
  );
  private readonly getEmailValue = this.locatorForOptional(
    '[data-testid="contact-dialog-email-value"]',
  );
  private readonly getContactInfoSection = this.locatorForOptional(
    '[data-testid="contact-dialog-contact-info-section"]',
  );
  private readonly getContactInfoValue = this.locatorForOptional(
    '[data-testid="contact-dialog-contact-info-value"]',
  );
  private readonly getFallback = this.locatorForOptional('[data-testid="contact-dialog-fallback"]');
  private readonly getCopyEmailButton = this.locatorForOptional(
    '[data-testid="contact-dialog-copy-email"]',
  );
  private readonly getDraftEmailButton = this.locatorForOptional(
    '[data-testid="contact-dialog-draft-email"]',
  );
  private readonly getCopyContactInfoButton = this.locatorForOptional(
    '[data-testid="contact-dialog-copy-contact-info"]',
  );
  private readonly getCloseButton = this.locatorFor('[data-testid="contact-dialog-close"]');

  async hasEmailSection(): Promise<boolean> {
    return (await this.getEmailSection()) !== null;
  }

  async getEmailText(): Promise<string | null> {
    const element = await this.getEmailValue();
    return element ? (await element.text()).trim() : null;
  }

  async hasContactInfoSection(): Promise<boolean> {
    return (await this.getContactInfoSection()) !== null;
  }

  async getContactInfoText(): Promise<string | null> {
    const element = await this.getContactInfoValue();
    return element ? (await element.text()).trim() : null;
  }

  async getFallbackText(): Promise<string | null> {
    const element = await this.getFallback();
    return element ? (await element.text()).trim() : null;
  }

  async clickCopyEmail(): Promise<void> {
    const button = await this.getCopyEmailButton();
    if (!button) throw new Error('Copy email button not found');
    await button.click();
  }

  async clickDraftEmail(): Promise<void> {
    const button = await this.getDraftEmailButton();
    if (!button) throw new Error('Draft email button not found');
    await button.click();
  }

  async clickCopyContactInfo(): Promise<void> {
    const button = await this.getCopyContactInfoButton();
    if (!button) throw new Error('Copy contact info button not found');
    await button.click();
  }

  async clickClose(): Promise<void> {
    await (await this.getCloseButton()).click();
  }
}
