import {ComponentHarness} from '@angular/cdk/testing';

export class PlatformContactDialogHarness extends ComponentHarness {
  static hostSelector = 'app-platform-contact-dialog';

  private readonly getEmailValue = this.locatorFor(
    '[data-testid="platform-contact-email"]',
  );
  private readonly getOpenMailLink = this.locatorFor(
    '[data-testid="platform-contact-open-mail"]',
  );
  private readonly getCopyEmailButton = this.locatorFor(
    '[data-testid="platform-contact-copy-email"]',
  );
  private readonly getCloseButton = this.locatorFor(
    '[data-testid="platform-contact-close"]',
  );

  async getEmailText(): Promise<string> {
    return (await (await this.getEmailValue()).text()).trim();
  }

  async getOpenMailHref(): Promise<string | null> {
    return (await this.getOpenMailLink()).getAttribute('href');
  }

  /** Resolved z-button variant of the open-mail anchor (data-type attr). */
  async getOpenMailButtonType(): Promise<string | null> {
    return (await this.getOpenMailLink()).getAttribute('data-type');
  }

  async clickOpenMailClient(): Promise<void> {
    await (await this.getOpenMailLink()).click();
  }

  async clickCopyEmail(): Promise<void> {
    await (await this.getCopyEmailButton()).click();
  }

  async clickClose(): Promise<void> {
    await (await this.getCloseButton()).click();
  }
}
