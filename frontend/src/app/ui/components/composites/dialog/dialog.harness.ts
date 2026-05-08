import { ComponentHarness } from '@angular/cdk/testing';

export class BraDialogComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-dialog';

  private getCloseButton = this.locatorForOptional('[data-testid="z-close-header-button"]');
  private getCancelButton = this.locatorForOptional('[data-testid="z-cancel-button"]');
  private getOkButton = this.locatorForOptional('[data-testid="z-ok-button"]');
  private getTitleEl = this.locatorForOptional('[data-testid="z-title"]');
  private getDescriptionEl = this.locatorForOptional('[data-testid="z-description"]');
  private getContentEl = this.locatorForOptional('[data-testid="z-content"]');

  /** Returns the dialog title text, or null if no title is rendered. */
  async getTitleText(): Promise<string | null> {
    const el = await this.getTitleEl();
    return el ? (await el.text()).trim() : null;
  }

  /** Returns the dialog description text, or null if no description is rendered. */
  async getDescriptionText(): Promise<string | null> {
    const el = await this.getDescriptionEl();
    return el ? (await el.text()).trim() : null;
  }

  /** Returns the string content text, or null if no string content is rendered. */
  async getContentText(): Promise<string | null> {
    const el = await this.getContentEl();
    return el ? (await el.text()).trim() : null;
  }

  /** Returns true if the close (X) button is present. */
  async hasCloseButton(): Promise<boolean> {
    return (await this.getCloseButton()) !== null;
  }

  /** Returns true if the cancel button is present. */
  async hasCancelButton(): Promise<boolean> {
    return (await this.getCancelButton()) !== null;
  }

  /** Returns true if the OK button is present. */
  async hasOkButton(): Promise<boolean> {
    return (await this.getOkButton()) !== null;
  }

  /** Returns the text label of the cancel button, or null if absent. */
  async getCancelButtonText(): Promise<string | null> {
    const btn = await this.getCancelButton();
    return btn ? (await btn.text()).trim() : null;
  }

  /** Returns the text label of the OK button, or null if absent. */
  async getOkButtonText(): Promise<string | null> {
    const btn = await this.getOkButton();
    return btn ? (await btn.text()).trim() : null;
  }

  /** Returns true if the OK button is disabled. */
  async isOkDisabled(): Promise<boolean> {
    const btn = await this.getOkButton();
    if (!btn) return false;
    return (await btn.getAttribute('disabled')) !== null;
  }

  /** Clicks the close (X) button. Throws if the button is not present. */
  async clickClose(): Promise<void> {
    const btn = await this.getCloseButton();
    if (!btn) throw new Error('Close button is not present in the dialog');
    await btn.click();
  }

  /** Clicks the cancel button. Throws if the button is not present. */
  async clickCancel(): Promise<void> {
    const btn = await this.getCancelButton();
    if (!btn) throw new Error('Cancel button is not present in the dialog');
    await btn.click();
  }

  /** Clicks the OK button. Throws if the button is not present. */
  async clickOk(): Promise<void> {
    const btn = await this.getOkButton();
    if (!btn) throw new Error('OK button is not present in the dialog');
    await btn.click();
  }
}
