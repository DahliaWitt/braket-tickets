import {ComponentHarness} from '@angular/cdk/testing';

export class UnsubscribeHarness extends ComponentHarness {
  static hostSelector = 'app-unsubscribe';

  async isConfirmationVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="unsub-confirmation"]',
    )();
    return el !== null;
  }

  async getPreferencesIntroText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="unsub-preferences-intro"]',
    )();
    return el ? el.text() : null;
  }

  async isErrorVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('[data-testid="unsub-error"]')();
    return el !== null;
  }

  async getErrorText(): Promise<string | null> {
    const el = await this.locatorForOptional('[data-testid="unsub-error"]')();
    return el ? el.text() : null;
  }

  async getSupportHref(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="unsub-support-link"]',
    )();
    return el ? el.getAttribute('href') : null;
  }

  async getOrganizationName(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="unsub-org-name"]',
    )();
    return el ? el.text() : null;
  }

  async isGlobalOptOutBannerVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="global-optout-banner"]',
    )();
    return el !== null;
  }

  async clickUnsubscribeAll(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="unsub-all-btn"]')();
    await btn.click();
  }
}
