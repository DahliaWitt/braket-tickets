import { ComponentHarness } from '@angular/cdk/testing';

export class ConfirmPasswordResetComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirm-password-reset';

  private getPasswordInput = this.locatorForOptional('input#password');
  private getPasswordConfirmInput = this.locatorForOptional('input#passwordConfirm');
  private getSubmitButton = this.locatorForOptional('#submit-button');
  private getSuccessIcon = this.locatorForOptional('#success-icon');
  private getErrorIcon = this.locatorForOptional('#error-icon');
  private getErrorMessage = this.locatorForOptional('#error-message');
  private getFormError = this.locatorForOptional('#form-error');
  private getPasswordError = this.locatorForOptional('#password-error');
  private getPasswordConfirmError = this.locatorForOptional('#passwordConfirm-error');
  private getLoginLink = this.locatorForOptional('#login-link');

  async setPassword(value: string): Promise<void> {
    const input = await this.getPasswordInput();
    if (input) {
      await input.clear();
      await input.sendKeys(value);
      await input.blur();
    }
  }

  async setPasswordConfirm(value: string): Promise<void> {
    const input = await this.getPasswordConfirmInput();
    if (input) {
      await input.clear();
      await input.sendKeys(value);
      await input.blur();
    }
  }

  async submit(): Promise<void> {
    const btn = await this.getSubmitButton();
    if (btn) await btn.click();
  }

  async isSuccess(): Promise<boolean> {
    const icon = await this.getSuccessIcon();
    return icon !== null;
  }

  async isError(): Promise<boolean> {
    const icon = await this.getErrorIcon();
    return icon !== null;
  }

  async getErrorText(): Promise<string | null> {
    const el = await this.getErrorMessage();
    return el ? el.text() : null;
  }

  async getFormErrorText(): Promise<string | null> {
    const el = await this.getFormError();
    return el ? el.text() : null;
  }

  async getPasswordErrorText(): Promise<string | null> {
    const el = await this.getPasswordError();
    return el ? el.text() : null;
  }

  async getPasswordConfirmErrorText(): Promise<string | null> {
    const el = await this.getPasswordConfirmError();
    return el ? el.text() : null;
  }

  async hasLoginLink(): Promise<boolean> {
    const link = await this.getLoginLink();
    return link !== null;
  }

  async clickLoginLink(): Promise<void> {
    const link = await this.getLoginLink();
    if (link) await link.click();
  }

  async hasSubmitButton(): Promise<boolean> {
    const btn = await this.getSubmitButton();
    return btn !== null;
  }

  async isVisible(): Promise<boolean> {
    const host = await this.host();
    return host !== null;
  }
}
