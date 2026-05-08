import {ComponentHarness} from '@angular/cdk/testing';

export class ConfirmEmailChangeComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirm-email-change';

  private readonly successIcon = this.locatorForOptional('#success-icon');
  private readonly pendingIcon = this.locatorForOptional('#pending-icon');
  private readonly errorIcon = this.locatorForOptional('#error-icon');
  private readonly accountLink = this.locatorForOptional('#account-link');
  private readonly backLink = this.locatorForOptional(
    'a[routerLink="/account"]',
  );

  async isSuccess(): Promise<boolean> {
    return (await this.successIcon()) !== null;
  }

  async isPending(): Promise<boolean> {
    return (await this.pendingIcon()) !== null;
  }

  async isError(): Promise<boolean> {
    return (await this.errorIcon()) !== null;
  }

  async hasPendingIcon(): Promise<boolean> {
    return this.isPending();
  }

  async hasErrorIcon(): Promise<boolean> {
    return this.isError();
  }

  async hasAccountLink(): Promise<boolean> {
    return (await this.accountLink()) !== null;
  }

  async hasBackLink(): Promise<boolean> {
    return (await this.backLink()) !== null;
  }

  async getErrorText(): Promise<string | null> {
    const error = await this.errorIcon();
    if (!error) {
      return null;
    }

    const description = await this.locatorForOptional('#error-message')();
    return description ? description.text() : null;
  }

  async getPendingText(): Promise<string | null> {
    const pending = await this.pendingIcon();
    if (!pending) {
      return null;
    }

    const description = await this.locatorForOptional('#pending-message')();
    return description ? description.text() : null;
  }
}
