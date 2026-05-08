import {ComponentHarness} from '@angular/cdk/testing';

export class InviteAdminDialogHarness extends ComponentHarness {
  static hostSelector = 'app-invite-admin-dialog';

  protected getCommunityNameInput = this.locatorFor(
    '[data-testid="community-name-input"]',
  );
  protected getEmailInput = this.locatorFor(
    '[data-testid="invite-email-input"]',
  );
  protected getSubmitBtn = this.locatorFor('[data-testid="invite-submit-btn"]');
  protected getCancelBtn = this.locatorFor('[data-testid="invite-cancel-btn"]');
  protected getSuccessState = this.locatorForOptional(
    '[data-testid="invite-success-state"]',
  );
  protected getDoneBtn = this.locatorForOptional(
    '[data-testid="invite-done-btn"]',
  );

  async setCommunityName(value: string): Promise<void> {
    const input = await this.getCommunityNameInput();
    await input.setInputValue(value);
    await input.dispatchEvent('input');
    await input.blur();
  }

  async setEmail(value: string): Promise<void> {
    const input = await this.getEmailInput();
    await input.setInputValue(value);
    await input.dispatchEvent('input');
    await input.blur();
  }

  async getCommunityNameValue(): Promise<string> {
    const input = await this.getCommunityNameInput();
    return input.getProperty<string>('value');
  }

  async getEmailValue(): Promise<string> {
    const input = await this.getEmailInput();
    return input.getProperty<string>('value');
  }

  async clickSubmit(): Promise<void> {
    const btn = await this.getSubmitBtn();
    await btn.click();
  }

  async clickCancel(): Promise<void> {
    const btn = await this.getCancelBtn();
    await btn.click();
  }

  async isCancelInitialFocus(): Promise<boolean> {
    const btn = await this.getCancelBtn();
    return (await btn.getAttribute('cdkFocusInitial')) !== null;
  }

  async clickDone(): Promise<void> {
    const btn = await this.getDoneBtn();
    if (!btn)
      throw new Error('Done button not visible — success state not reached');
    await btn.click();
  }

  async isSubmitDisabled(): Promise<boolean> {
    const btn = await this.getSubmitBtn();
    return btn.getProperty<boolean>('disabled');
  }

  async isSuccessStateVisible(): Promise<boolean> {
    return (await this.getSuccessState()) !== null;
  }
}
