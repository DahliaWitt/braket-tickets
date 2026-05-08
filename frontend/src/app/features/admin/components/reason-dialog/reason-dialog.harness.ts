import { ComponentHarness } from '@angular/cdk/testing';

export class ReasonDialogHarness extends ComponentHarness {
  static hostSelector = 'app-reason-dialog';

  protected getTextarea = this.locatorFor('[data-testid="reason-textarea"]');
  protected getVisibilityHint = this.locatorFor('[data-testid="reason-visibility-hint"]');

  async getReason(): Promise<string> {
    const textarea = await this.getTextarea();
    return textarea.getProperty<string>('value');
  }

  async setReason(value: string): Promise<void> {
    const textarea = await this.getTextarea();
    await textarea.setInputValue(value);
    await textarea.dispatchEvent('input');
  }

  async getVisibilityLabel(): Promise<string> {
    const hint = await this.getVisibilityHint();
    return (await hint.text()).trim();
  }

  async getLabelText(): Promise<string> {
    const label = await this.locatorFor('label')();
    return (await label.text()).trim();
  }
}
