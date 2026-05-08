import { ComponentHarness } from '@angular/cdk/testing';

export class CompleteSocialSignupComponentHarness extends ComponentHarness {
  static hostSelector = 'app-complete-social-signup';

  private getTermsCheckbox = this.locatorForOptional(
    'input[type="checkbox"]',
  );
  private getFinishButton = this.locatorForOptional('button[type="button"]');
  private getInlineError = this.locatorForOptional(
    '[data-testid="social-signup-inline-error"]',
  );
  private getErrorState = this.locatorForOptional('app-confirmation-state[variant="error"]');
  private getBackToLoginLink = this.locatorForOptional('a[routerLink="/login"]');

  /** Whether the error card state is visible (session expired or submit failure). */
  async isErrorState(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  /** Whether the ready/submitting form state is visible. */
  async isFormState(): Promise<boolean> {
    return (await this.getTermsCheckbox()) !== null;
  }

  /** Returns the inline validation error text, or null if not shown. */
  async getInlineErrorText(): Promise<string | null> {
    const el = await this.getInlineError();
    return el ? el.text() : null;
  }

  /** Whether the terms-of-service checkbox is currently checked. */
  async isTermsAccepted(): Promise<boolean> {
    const checkbox = await this.getTermsCheckbox();
    if (!checkbox) return false;
    return (await checkbox.getProperty<boolean>('checked')) ?? false;
  }

  /** Toggles the terms-of-service checkbox. */
  async toggleTerms(): Promise<void> {
    const checkbox = await this.getTermsCheckbox();
    if (checkbox) {
      await checkbox.click();
    }
  }

  /** Whether the "Finish Setup" button is present (form state only). */
  async isFinishButtonPresent(): Promise<boolean> {
    return (await this.getFinishButton()) !== null;
  }

  /** Whether the "Finish Setup" button is disabled. */
  async isFinishButtonDisabled(): Promise<boolean> {
    const btn = await this.getFinishButton();
    if (!btn) return true;
    return (await btn.getProperty<boolean>('disabled')) ?? false;
  }

  /** Clicks the "Finish Setup" button. */
  async clickFinish(): Promise<void> {
    const btn = await this.getFinishButton();
    if (btn) {
      await btn.click();
    }
  }

  /** Whether the "Back to Login" link is visible (error state only). */
  async isBackToLoginVisible(): Promise<boolean> {
    return (await this.getBackToLoginLink()) !== null;
  }
}
