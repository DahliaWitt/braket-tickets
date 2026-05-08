import { ComponentHarness } from '@angular/cdk/testing';

export class ConfirmSocialSigninComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirm-social-signin';

  private getLoadingState = this.locatorForOptional(
    'app-confirmation-state[variant="loading"]',
  );
  private getSuccessState = this.locatorForOptional(
    'app-confirmation-state[variant="success"]',
  );
  private getErrorState = this.locatorForOptional(
    'app-confirmation-state[variant="error"]',
  );
  private getHeadInsideButton = this.locatorForOptional(
    'button[type="button"]',
  );
  private getBackToAuthLink = this.locatorForOptional('a[routerLink="/login"]');

  /** Whether the loading state is active (OAuth callback in progress). */
  async isLoading(): Promise<boolean> {
    return (await this.getLoadingState()) !== null;
  }

  /** Whether the success state is shown (sign-in completed). */
  async isSuccess(): Promise<boolean> {
    return (await this.getSuccessState()) !== null;
  }

  /** Whether the error state is shown (sign-in failed or blocked). */
  async isError(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  /** Whether the "Head Inside" continue button is visible (success state only). */
  async isHeadInsideButtonVisible(): Promise<boolean> {
    return (await this.getHeadInsideButton()) !== null;
  }

  /** Clicks the "Head Inside" button to proceed into the app. */
  async clickHeadInside(): Promise<void> {
    const btn = await this.getHeadInsideButton();
    if (btn) {
      await btn.click();
    }
  }

  /** Whether the "Back to Auth" link is visible (error state only). */
  async isBackToAuthVisible(): Promise<boolean> {
    return (await this.getBackToAuthLink()) !== null;
  }

  /** Clicks the "Back to Auth" link. */
  async clickBackToAuth(): Promise<void> {
    const link = await this.getBackToAuthLink();
    if (link) {
      await link.click();
    }
  }
}
