import {ComponentHarness} from '@angular/cdk/testing';

export class ConfirmSocialLinkComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirm-social-link';

  private getLoadingState = this.locatorForOptional(
    'app-confirmation-state[variant="loading"]',
  );
  private getSuccessState = this.locatorForOptional(
    'app-confirmation-state[variant="success"]',
  );
  private getErrorState = this.locatorForOptional(
    'app-confirmation-state[variant="error"]',
  );
  private getBackToAccountLink = this.locatorForOptional(
    'a[routerLink="/account"]',
  );
  private getActiveState = this.locatorForOptional('app-confirmation-state');

  /** Whether the loading state is active (auth bootstrap or link confirmation in progress). */
  async isLoading(): Promise<boolean> {
    return (await this.getLoadingState()) !== null;
  }

  /** Text of the currently rendered confirmation state (title + description). */
  async getStateText(): Promise<string | null> {
    const state = await this.getActiveState();
    return state ? state.text() : null;
  }

  /** Whether the success state is shown (provider linked successfully). */
  async isSuccess(): Promise<boolean> {
    return (await this.getSuccessState()) !== null;
  }

  /** Whether the error state is shown (linking failed). */
  async isError(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  /** Whether the "Back to Account" navigation link is present. */
  async isBackToAccountVisible(): Promise<boolean> {
    return (await this.getBackToAccountLink()) !== null;
  }

  /** Clicks the "Back to Account" link (present in both success and error states). */
  async clickBackToAccount(): Promise<void> {
    const link = await this.getBackToAccountLink();
    if (link) {
      await link.click();
    }
  }
}
