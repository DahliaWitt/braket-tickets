import { ComponentHarness } from '@angular/cdk/testing';

export class ConfirmVerificationComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirm-verification';

  private getSuccessIcon = this.locatorForOptional('#success-icon');
  private getErrorIcon = this.locatorForOptional('#error-icon');
  private getErrorMessage = this.locatorForOptional('#error-message');
  private getLoginLink = this.locatorForOptional('#login-link');

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

  async hasLoginLink(): Promise<boolean> {
    const link = await this.getLoginLink();
    return link !== null;
  }

  async clickLoginLink(): Promise<void> {
    const link = await this.getLoginLink();
    if (link) await link.click();
  }
}
