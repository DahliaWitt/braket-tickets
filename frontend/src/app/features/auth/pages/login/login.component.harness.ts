import {ComponentHarness, type TestElement} from '@angular/cdk/testing';

export class LoginComponentHarness extends ComponentHarness {
  static hostSelector = 'app-login';

  private getRegisterTab = this.locatorFor('#tab-register');
  private getLoginTab = this.locatorFor('#tab-login');
  private getLoginEmail = this.locatorFor('input#login-email');
  private getLoginPassword = this.locatorFor('input#login-password');
  private getLoginSubmit = this.locatorFor('button#login-submit');
  private getLoginEmailError = this.locatorForOptional('#login-email-error');
  private getLoginPasswordError = this.locatorForOptional(
    '#login-password-error',
  );
  private getAuthError = this.locatorForOptional('#auth-error');

  private getRegisterNameInput = this.locatorFor('input#register-name');
  private getRegisterEmailInput = this.locatorFor('input#register-email');
  private getRegisterPasswordInput = this.locatorFor('input#register-password');
  private getRegisterPasswordConfirmInput = this.locatorFor(
    'input#register-password-confirm',
  );
  private getRegisterTermsInput = this.locatorFor('input#register-terms');
  private getForgotPasswordButton = this.locatorForOptional(
    '[data-testid="forgot-password-btn"]',
  );
  private getResetEmailInput = this.locatorFor('input#reset-email');
  private getResetSubmitButton = this.locatorFor('button#reset-submit');
  private getResetEmailError = this.locatorForOptional('#reset-email-error');
  private getResetSuccessState = this.locatorForOptional(
    '[data-testid="reset-success-state"]',
  );

  private getRegisterSubmit = this.locatorFor('button#register-submit');

  /**
   * Polls for an optional element until it appears or timeout elapses.
   * Needed because @ngx-playwright/test's locatorFor() does a single snapshot
   * DOM query with no retry, and forceStabilize() is a no-op in zoneless Angular.
   */
  private async awaitRendered(
    locator: () => Promise<TestElement | null>,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await locator()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  private getRegisterNameError = this.locatorForOptional(
    '#register-name-error',
  );
  private getRegisterEmailError = this.locatorForOptional(
    '#register-email-error',
  );
  private getRegisterPasswordError = this.locatorForOptional(
    '#register-password-error',
  );
  private getRegisterPasswordConfirmError = this.locatorForOptional(
    '#register-password-confirm-error',
  );
  private getRegisterTermsError = this.locatorForOptional(
    '#register-terms-error',
  );

  async switchToRegister(): Promise<void> {
    const tab = await this.getRegisterTab();
    await tab.click();
    // Wait for zoneless CD to render the register panel
    await this.awaitRendered(this.locatorForOptional('input#register-name'));
  }

  async setLoginEmail(value: string) {
    const input = await this.getLoginEmail();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setLoginPassword(value: string) {
    const input = await this.getLoginPassword();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async submitLogin() {
    const btn = await this.getLoginSubmit();
    await btn.click();
  }

  async submitRegister() {
    const btn = await this.getRegisterSubmit();
    await btn.click();
  }

  async isRegisterSubmitDisabled(): Promise<boolean> {
    const btn = await this.getRegisterSubmit();
    return (
      (await btn.getAttribute('disabled')) !== null ||
      (await btn.getAttribute('aria-disabled')) === 'true'
    );
  }

  async getRegisterNameErrorText() {
    const el = await this.getRegisterNameError();
    return el ? el.text() : null;
  }

  async getRegisterEmailErrorText() {
    const el = await this.getRegisterEmailError();
    return el ? el.text() : null;
  }

  async getRegisterPasswordErrorText() {
    const el = await this.getRegisterPasswordError();
    return el ? el.text() : null;
  }

  async getRegisterPasswordConfirmErrorText() {
    const el = await this.getRegisterPasswordConfirmError();
    return el ? el.text() : null;
  }

  async getRegisterTermsErrorText() {
    const el = await this.getRegisterTermsError();
    return el ? el.text() : null;
  }

  async getLoginEmailErrorText(): Promise<string | null> {
    const el = await this.getLoginEmailError();
    return el ? el.text() : null;
  }

  async getLoginPasswordErrorText(): Promise<string | null> {
    const el = await this.getLoginPasswordError();
    return el ? el.text() : null;
  }

  async getAuthErrorText() {
    const el = await this.getAuthError();
    return el ? el.text() : null;
  }

  // Verification gate testing methods
  private getResendVerificationButton = this.locatorForOptional(
    'button:text-matches("Resend verification", "i")',
  );
  private getAuthMessage = this.locatorForOptional('#auth-message');

  private getLoginSocialGuidance = this.locatorForOptional(
    '[data-testid="login-social-guidance"]',
  );
  private getRegisterSocialGuidance = this.locatorForOptional(
    '[data-testid="register-social-guidance"]',
  );

  async isResendButtonVisible(): Promise<boolean> {
    const btn = await this.getResendVerificationButton();
    return btn !== null;
  }

  async clickResendVerification(): Promise<void> {
    const btn = await this.getResendVerificationButton();
    if (btn) await btn.click();
  }

  async getSuccessMessageText(): Promise<string | null> {
    const el = await this.getAuthMessage();
    return el ? el.text() : null;
  }

  async getLoginSocialGuidanceText(): Promise<string | null> {
    const el = await this.getLoginSocialGuidance();
    return el ? el.text() : null;
  }

  async getRegisterSocialGuidanceText(): Promise<string | null> {
    const el = await this.getRegisterSocialGuidance();
    return el ? el.text() : null;
  }

  async switchToLogin(): Promise<void> {
    const tab = await this.getLoginTab();
    await tab.click();
    // Wait for zoneless CD to render the login panel
    await this.awaitRendered(this.locatorForOptional('input#login-email'));
  }

  async setRegisterName(value: string): Promise<void> {
    const input = await this.getRegisterNameInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setRegisterEmail(value: string): Promise<void> {
    const input = await this.getRegisterEmailInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setRegisterPassword(value: string): Promise<void> {
    const input = await this.getRegisterPasswordInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setRegisterPasswordConfirm(value: string): Promise<void> {
    const input = await this.getRegisterPasswordConfirmInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async acceptRegisterTerms(): Promise<void> {
    const checkbox = await this.getRegisterTermsInput();
    await checkbox.click();
  }

  async enterResetMode(): Promise<void> {
    const btn = await this.getForgotPasswordButton();
    if (!btn)
      throw new Error(
        'Forgot password button not found — ensure data-testid="forgot-password-btn" is set',
      );
    await btn.click();
    // Wait for zoneless CD to render the reset form
    await this.awaitRendered(this.locatorForOptional('input#reset-email'));
  }

  async setResetEmail(value: string): Promise<void> {
    const input = await this.getResetEmailInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async typeResetEmail(value: string): Promise<void> {
    const input = await this.getResetEmailInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async touchResetEmail(): Promise<void> {
    const input = await this.getResetEmailInput();
    await input.focus();
    await input.blur();
  }

  async submitResetRequest(): Promise<void> {
    const btn = await this.getResetSubmitButton();
    await btn.click();
  }

  async isResetSubmitDisabled(): Promise<boolean> {
    const btn = await this.getResetSubmitButton();
    return (
      (await btn.getAttribute('disabled')) !== null ||
      (await btn.getAttribute('aria-disabled')) === 'true'
    );
  }

  async getResetEmailErrorText(): Promise<string | null> {
    const el = await this.getResetEmailError();
    return el ? el.text() : null;
  }

  async getResetEmailDescribedBy(): Promise<string | null> {
    const input = await this.getResetEmailInput();
    return input.getAttribute('aria-describedby');
  }

  async getResetSuccessText(): Promise<string | null> {
    const el = await this.getResetSuccessState();
    return el ? el.text() : null;
  }

  async isVisible(): Promise<boolean> {
    const host = await this.host();
    return host !== null;
  }
}
