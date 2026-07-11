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

  /** Resolved z-button variant of the unsubscribe-all action. */
  async getUnsubscribeAllButtonType(): Promise<string | null> {
    const btn = await this.locatorForOptional(
      '[data-testid="unsub-all-btn"]',
    )();
    return btn ? btn.getAttribute('data-type') : null;
  }

  async isLoadingVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('[data-testid="unsub-loading"]')();
    return el !== null;
  }

  async getLoadingSkeletonCount(): Promise<number> {
    const skeletons = await this.locatorForAll(
      '[data-testid="unsub-loading"] z-skeleton',
    )();
    return skeletons.length;
  }

  async isLoadErrorVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="unsub-load-error"]',
    )();
    return el !== null;
  }

  async clickRetry(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="unsub-retry-btn"]')();
    await btn.click();
  }

  private prefToggle(organizerId: string) {
    return this.locatorForOptional(
      `[data-testid="pref-toggle-${organizerId}"]`,
    )();
  }

  async togglePreference(organizerId: string): Promise<void> {
    const checkbox = await this.prefToggle(organizerId);
    if (!checkbox) throw new Error(`Toggle for ${organizerId} not found`);
    await checkbox.click();
  }

  async isPreferenceChecked(organizerId: string): Promise<boolean | null> {
    const checkbox = await this.prefToggle(organizerId);
    return checkbox ? checkbox.getProperty<boolean>('checked') : null;
  }

  async isPreferenceDisabled(organizerId: string): Promise<boolean | null> {
    const checkbox = await this.prefToggle(organizerId);
    return checkbox ? checkbox.getProperty<boolean>('disabled') : null;
  }
}
