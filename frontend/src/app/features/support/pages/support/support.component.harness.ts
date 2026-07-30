import {ComponentHarness} from '@angular/cdk/testing';

export class SupportComponentHarness extends ComponentHarness {
  static hostSelector = 'app-support';

  private getEmailSupportButton = this.locatorForOptional(
    '[data-testid="email-support-button"]',
  );
  private getEventSupportSection = this.locatorForOptional(
    'h2:has(z-icon[zType="calendar"])',
  );
  private getPlatformSupportSection = this.locatorForOptional(
    'h2 + p + [data-testid="email-support-button"]',
  );
  private getMainHeading = this.locatorForOptional('h1');
  private getAllH2s = this.locatorForAll('h2');
  private getFadeInContainer = this.locatorForOptional('.fade-in');
  private getCardSections = this.locatorForAll('.border-border');

  /** Whether the "EMAIL SUPPORT" button is present. */
  async isEmailSupportButtonVisible(): Promise<boolean> {
    return (await this.getEmailSupportButton()) !== null;
  }

  /** Clicks the "EMAIL SUPPORT" button. */
  async clickEmailSupport(): Promise<void> {
    const btn = await this.getEmailSupportButton();
    if (btn) {
      await btn.click();
    }
  }

  /** Whether the "Event Questions?" section is visible. */
  async isEventSupportSectionVisible(): Promise<boolean> {
    return (await this.getEventSupportSection()) !== null;
  }

  /** Whether the "Platform Support" section (with the email button) is visible. */
  async isPlatformSupportSectionVisible(): Promise<boolean> {
    return (await this.getPlatformSupportSection()) !== null;
  }

  async getMainHeadingText(): Promise<string | null> {
    const el = await this.getMainHeading();
    return el ? el.text() : null;
  }

  async getH2Count(): Promise<number> {
    return (await this.getAllH2s()).length;
  }

  async hasFadeInContainer(): Promise<boolean> {
    return (await this.getFadeInContainer()) !== null;
  }

  async getCardSectionCount(): Promise<number> {
    return (await this.getCardSections()).length;
  }

  async getHostText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }
}
