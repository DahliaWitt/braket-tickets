import {ComponentHarness} from '@angular/cdk/testing';

/**
 * Harness for the embedded Stripe Connect wrapper.
 *
 * The component mounts Stripe's own Web Components (`stripe-connect-*`)
 * inside its host div, so the harness asserts on the Angular surface
 * only: loading skeleton, error paragraph, and which Stripe components
 * were asked to mount. Anything that lives INSIDE the Stripe custom
 * element is the SDK's contract, not ours.
 */
export class StripeConnectEmbedComponentHarness extends ComponentHarness {
  static hostSelector = 'app-stripe-connect-embed';

  private getHost = this.locatorForOptional(
    '[data-testid="stripe-connect-embed-host"]',
  );
  private getError = this.locatorForOptional(
    '[data-testid="stripe-connect-embed-error"]',
  );
  private getAccountOnboarding = this.locatorForOptional(
    '[data-testid="stripe-connect-account-onboarding"]',
  );
  private getAccountManagement = this.locatorForOptional(
    '[data-testid="stripe-connect-account-management"]',
  );
  private getPayments = this.locatorForOptional(
    '[data-testid="stripe-connect-payments"]',
  );
  private getBalances = this.locatorForOptional(
    '[data-testid="stripe-connect-balances"]',
  );
  private getNotificationBanner = this.locatorForOptional(
    '[data-testid="stripe-connect-notification-banner"]',
  );
  private getDocuments = this.locatorForOptional(
    '[data-testid="stripe-connect-documents"]',
  );

  async isHostVisible(): Promise<boolean> {
    const host = await this.getHost();
    if (!host) return false;
    const classes = (await host.getAttribute('class')) ?? '';
    return !classes.includes('hidden');
  }

  async getErrorText(): Promise<string | null> {
    const el = await this.getError();
    return el ? (await el.text()).trim() : null;
  }

  async hasAccountOnboarding(): Promise<boolean> {
    return (await this.getAccountOnboarding()) !== null;
  }

  async hasAccountManagement(): Promise<boolean> {
    return (await this.getAccountManagement()) !== null;
  }

  async hasPayments(): Promise<boolean> {
    return (await this.getPayments()) !== null;
  }

  async hasBalances(): Promise<boolean> {
    return (await this.getBalances()) !== null;
  }

  async hasNotificationBanner(): Promise<boolean> {
    return (await this.getNotificationBanner()) !== null;
  }

  async hasDocuments(): Promise<boolean> {
    return (await this.getDocuments()) !== null;
  }
}
