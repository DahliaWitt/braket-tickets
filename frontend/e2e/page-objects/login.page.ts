import {Locator, expect} from '@playwright/test';
import {ComponentHarnessAdapter} from '../helpers/harness-environment';
import {fillAndTriggerInput} from '../test-utils/form-helpers';

/**
 * Login Page Object for E2E tests.
 *
 * Mirrors the core interactions from LoginComponentHarness while running in Playwright.
 * Centralizes selector usage so auth-flow tests stay stable when markup shifts.
 */
export class LoginPage extends ComponentHarnessAdapter {
  readonly hostSelector = 'app-login';

  private getLoginPanel(): Locator {
    return this.host().locator('#login-panel');
  }

  private getRegisterPanel(): Locator {
    return this.host().locator('#register-panel');
  }

  private getLoginTab(): Locator {
    return this.host().locator('#tab-login');
  }

  private getRegisterTab(): Locator {
    return this.host().locator('#tab-register');
  }

  private getLoginEmailInput(): Locator {
    return this.host().locator('#login-email');
  }

  private getLoginPasswordInput(): Locator {
    return this.host().locator('#login-password');
  }

  private getLoginSubmitButton(): Locator {
    return this.host().locator('#login-submit');
  }

  private getRegisterNameInput(): Locator {
    return this.host().locator('#register-name');
  }

  private getRegisterEmailInput(): Locator {
    return this.host().locator('#register-email');
  }

  private getRegisterPasswordInput(): Locator {
    return this.host().locator('#register-password');
  }

  private getRegisterPasswordConfirmInput(): Locator {
    return this.host().locator('#register-password-confirm');
  }

  private getRegisterTermsInput(): Locator {
    return this.host().locator('#register-terms');
  }

  private getRegisterSubmitButton(): Locator {
    return this.host().locator('#register-submit');
  }

  private getRegisterEmailError(): Locator {
    return this.host().locator('#register-email-error');
  }

  private getRegisterPasswordError(): Locator {
    return this.host().locator('#register-password-error');
  }

  private getRegisterPasswordConfirmError(): Locator {
    return this.host().locator('#register-password-confirm-error');
  }

  private getRegisterTermsError(): Locator {
    return this.host().locator('#register-terms-error');
  }

  private getResetEmailInput(): Locator {
    return this.host().locator('#reset-email');
  }

  private getResetSubmitButton(): Locator {
    return this.host().locator('#reset-submit');
  }

  private getConfirmPasswordInput(): Locator {
    return this.page.locator('#password');
  }

  private getConfirmPasswordConfirmInput(): Locator {
    return this.page.locator('#passwordConfirm');
  }

  private getConfirmSubmitButton(): Locator {
    return this.page.locator('#submit-button');
  }

  authMessage(): Locator {
    return this.host().locator('#auth-message');
  }

  authError(): Locator {
    return this.host().locator('#auth-error');
  }

  registrationFeedback(): Locator {
    return this.authMessage().or(this.authError());
  }

  registerEmailError(): Locator {
    return this.getRegisterEmailError();
  }

  registerPasswordError(): Locator {
    return this.getRegisterPasswordError();
  }

  registerPasswordConfirmError(): Locator {
    return this.getRegisterPasswordConfirmError();
  }

  registerTermsError(): Locator {
    return this.getRegisterTermsError();
  }

  async goto(returnUrl?: string): Promise<void> {
    const target = returnUrl
      ? `/login?returnUrl=${encodeURIComponent(returnUrl)}`
      : '/login';
    await this.page.goto(target);
  }

  async waitForReady(timeout = 15000): Promise<void> {
    await this.waitForVisible(timeout);
    await expect(this.getLoginTab()).toBeVisible({timeout});
  }

  async switchToLogin(): Promise<void> {
    const tab = this.getLoginTab();
    if ((await tab.count()) === 0) return;
    await tab.click();
    await expect(this.getLoginPanel()).toBeVisible();
  }

  async switchToRegister(): Promise<void> {
    const tab = this.getRegisterTab();
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(this.getRegisterPanel()).toBeVisible();
  }

  async setLoginEmail(value: string): Promise<void> {
    await fillAndTriggerInput(this.getLoginEmailInput(), value);
  }

  async setLoginPassword(value: string): Promise<void> {
    await fillAndTriggerInput(this.getLoginPasswordInput(), value);
  }

  async submitLogin(): Promise<void> {
    const button = this.getLoginSubmitButton();
    await expect(button).toBeEnabled({timeout: 5000});
    await button.click();
  }

  async setRegisterName(value: string): Promise<void> {
    await fillAndTriggerInput(this.getRegisterNameInput(), value);
  }

  async setRegisterEmail(value: string): Promise<void> {
    await fillAndTriggerInput(this.getRegisterEmailInput(), value);
  }

  async setRegisterPassword(value: string): Promise<void> {
    await fillAndTriggerInput(this.getRegisterPasswordInput(), value);
  }

  async setRegisterPasswordConfirm(value: string): Promise<void> {
    await fillAndTriggerInput(this.getRegisterPasswordConfirmInput(), value);
  }

  async acceptRegisterTerms(): Promise<void> {
    await this.getRegisterTermsInput().check();
  }

  async submitRegister(): Promise<void> {
    const button = this.getRegisterSubmitButton();
    await expect(button).toBeEnabled({timeout: 5000});
    await button.click();
  }

  async enterResetMode(): Promise<void> {
    const forgotButton = this.byRole('button', {
      name: /recover forgotten password|forgot/i,
    });
    await expect(forgotButton).toBeVisible();
    await forgotButton.click();
  }

  async setResetEmail(value: string): Promise<void> {
    await fillAndTriggerInput(this.getResetEmailInput(), value);
  }

  async submitResetRequest(): Promise<void> {
    await this.getResetSubmitButton().click();
  }

  async setPasswordResetPassword(value: string): Promise<void> {
    await fillAndTriggerInput(this.getConfirmPasswordInput(), value);
  }

  async setPasswordResetPasswordConfirm(value: string): Promise<void> {
    await fillAndTriggerInput(this.getConfirmPasswordConfirmInput(), value);
  }

  async submitPasswordReset(): Promise<void> {
    await this.getConfirmSubmitButton().click();
  }
}
