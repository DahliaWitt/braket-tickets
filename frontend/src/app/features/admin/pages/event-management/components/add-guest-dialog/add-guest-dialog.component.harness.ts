import {ComponentHarness} from '@angular/cdk/testing';

export class AddGuestDialogComponentHarness extends ComponentHarness {
  static hostSelector = 'app-add-guest-dialog';

  private getNameInput = this.locatorFor('#guest-name');
  private getEmailInput = this.locatorFor('#guest-email');
  private getNotesTextarea = this.locatorFor('#guest-notes');
  private getTypeTrigger = this.locatorFor('#guest-type button');
  private getSubmitButton = this.locatorFor('[data-testid="add-guest-submit"]');

  async setName(value: string): Promise<void> {
    const input = await this.getNameInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getNameValue(): Promise<string> {
    const input = await this.getNameInput();
    return input.getProperty<string>('value');
  }

  async setEmail(value: string): Promise<void> {
    const input = await this.getEmailInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getEmailValue(): Promise<string> {
    const input = await this.getEmailInput();
    return input.getProperty<string>('value');
  }

  async setNotes(value: string): Promise<void> {
    const textarea = await this.getNotesTextarea();
    await textarea.clear();
    await textarea.sendKeys(value);
  }

  async getNotesValue(): Promise<string> {
    const textarea = await this.getNotesTextarea();
    return textarea.getProperty<string>('value');
  }

  async isSubmitButtonDisabled(): Promise<boolean> {
    const button = await this.getSubmitButton();
    return button.getProperty<boolean>('disabled');
  }

  async clickSubmit(): Promise<void> {
    const button = await this.getSubmitButton();
    await button.click();
  }

  async getSubmitButtonLabel(): Promise<string> {
    const button = await this.getSubmitButton();
    return (await button.text()).trim();
  }

  /** Returns the visible label of the currently selected guest type (e.g. "Staff"). */
  async getSelectedTypeLabel(): Promise<string> {
    const trigger = await this.getTypeTrigger();
    return (await trigger.text()).trim();
  }
}
