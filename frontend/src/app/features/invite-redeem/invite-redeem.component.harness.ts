import {ComponentHarness} from '@angular/cdk/testing';

export class InviteRedeemComponentHarness extends ComponentHarness {
  static hostSelector = 'app-invite-redeem';

  // ─── Loading State ─────────────────────────────────
  async isLoadingVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="redeem-loading"]',
    )();
    return el !== null;
  }

  // ─── Success State ─────────────────────────────────
  async isSuccessVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="redeem-success"]',
    )();
    return el !== null;
  }

  async clickGoToDashboard(): Promise<void> {
    const success = await this.locatorForOptional(
      '[data-testid="redeem-success"]',
    )();
    if (!success) throw new Error('Success state not visible');
    const link = await this.locatorFor('[data-testid="redeem-success"] a')();
    await link.click();
  }

  // ─── Needs-Login State ─────────────────────────────
  async isNeedsLoginVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="redeem-needs-login"]',
    )();
    return el !== null;
  }

  async clickSignIn(): Promise<void> {
    const needsLogin = await this.locatorForOptional(
      '[data-testid="redeem-needs-login"]',
    )();
    if (!needsLogin) throw new Error('Needs-login state not visible');
    const link = await this.locatorFor(
      '[data-testid="redeem-needs-login"] a',
    )();
    await link.click();
  }

  async getSignInHref(): Promise<string | null> {
    const needsLogin = await this.locatorForOptional(
      '[data-testid="redeem-needs-login"]',
    )();
    if (!needsLogin) throw new Error('Needs-login state not visible');
    const link = await this.locatorFor(
      '[data-testid="redeem-needs-login"] a',
    )();
    return link.getAttribute('href');
  }

  // ─── Error State ───────────────────────────────────
  async isErrorVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('[data-testid="redeem-error"]')();
    return el !== null;
  }

  async getErrorText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="redeem-error"] p',
    )();
    return el ? (await el.text()).trim() : null;
  }

  async clickGoHome(): Promise<void> {
    const error = await this.locatorForOptional(
      '[data-testid="redeem-error"]',
    )();
    if (!error) throw new Error('Error state not visible');
    const link = await this.locatorFor('[data-testid="redeem-error"] a')();
    await link.click();
  }
}
