import { ComponentHarness, HarnessPredicate } from '@angular/cdk/testing';

export class InviteHarness extends ComponentHarness {
  static hostSelector = 'app-invite';

  static with(
    options: { selector?: string } = {},
  ): HarnessPredicate<InviteHarness> {
    return new HarnessPredicate(InviteHarness, options);
  }

  // --- View States ---
  private _loading = this.locatorForOptional('[data-testid="invite-loading"]');
  private _error = this.locatorForOptional('[data-testid="invite-error"]');
  private _errorMessage = this.locatorForOptional('[data-testid="invite-error-message"]');
  private _options = this.locatorForOptional('[data-testid="invite-options"]');
  private _redeeming = this.locatorForOptional('[data-testid="invite-redeeming"]');
  private _success = this.locatorForOptional('[data-testid="invite-success"]');

  async isLoading(): Promise<boolean> {
    const el = await this._loading();
    return el !== null;
  }

  async isError(): Promise<boolean> {
    const el = await this._error();
    return el !== null;
  }

  async getErrorMessage(): Promise<string | null> {
    const el = await this._errorMessage();
    return el ? (await el.text()).trim() : null;
  }

  async isOptionsVisible(): Promise<boolean> {
    const el = await this._options();
    return el !== null;
  }

  async isRedeeming(): Promise<boolean> {
    const el = await this._redeeming();
    return el !== null;
  }

  async isSuccess(): Promise<boolean> {
    const el = await this._success();
    return el !== null;
  }

  async getViewState(): Promise<'loading' | 'error' | 'options' | 'redeeming' | 'success' | 'unknown'> {
    if (await this.isLoading()) return 'loading';
    if (await this.isError()) return 'error';
    if (await this.isOptionsVisible()) return 'options';
    if (await this.isRedeeming()) return 'redeeming';
    if (await this.isSuccess()) return 'success';
    return 'unknown';
  }

  // --- Options State ---
  private _communityName = this.locatorForOptional('[data-testid="invite-community-name"]');
  private _signInLink = this.locatorForOptional('[data-testid="invite-sign-in"]');
  private _createAccountLink = this.locatorForOptional('[data-testid="invite-create-account"]');

  async getCommunityName(): Promise<string | null> {
    const el = await this._communityName();
    return el ? (await el.text()).trim() : null;
  }

  async clickSignIn(): Promise<void> {
    const link = await this._signInLink();
    if (!link) throw new Error('Sign in link not found');
    await link.click();
  }

  async clickCreateAccount(): Promise<void> {
    const link = await this._createAccountLink();
    if (!link) throw new Error('Create account link not found');
    await link.click();
  }
}
