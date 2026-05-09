import {ComponentHarness} from '@angular/cdk/testing';

export class BraDatePickerComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-date-picker, [bra-date-picker]';

  private getTriggerButton = this.locatorFor('button[type="button"]');

  /** Returns the display text shown on the trigger button (date or placeholder). */
  async getDisplayText(): Promise<string> {
    const btn = await this.getTriggerButton();
    const span = await btn.text();
    return span.trim();
  }

  /** Returns true if the trigger button is disabled. */
  async isDisabled(): Promise<boolean> {
    const btn = await this.getTriggerButton();
    return (await btn.getAttribute('disabled')) !== null;
  }

  /** Returns the trigger button's accessible label. */
  async getAriaLabel(): Promise<string | null> {
    const btn = await this.getTriggerButton();
    return btn.getAttribute('aria-label');
  }

  /** Returns true if the popover trigger is currently marked as expanded. */
  async isOpen(): Promise<boolean> {
    const btn = await this.getTriggerButton();
    return (await btn.getAttribute('aria-expanded')) === 'true';
  }

  /** Opens the date picker popover by clicking the trigger button. */
  async open(): Promise<void> {
    if (await this.isOpen()) {
      return;
    }
    await (await this.getTriggerButton()).click();
  }

  /** Closes the date picker popover by clicking the trigger button again. */
  async close(): Promise<void> {
    if (!(await this.isOpen())) {
      return;
    }
    await (await this.getTriggerButton()).click();
  }

  /** Clicks the trigger button to toggle the popover. */
  async toggle(): Promise<void> {
    await (await this.getTriggerButton()).click();
  }
}
