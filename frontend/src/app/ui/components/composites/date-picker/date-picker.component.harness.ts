import {ComponentHarness} from '@angular/cdk/testing';

export class BraDatePickerComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-date-picker, [bra-date-picker]';

  private getTriggerButton = this.locatorFor(
    'button[type="button"]:not([data-testid="date-picker-clear"])',
  );
  private getClearButtonIfPresent = this.locatorForOptional(
    '[data-testid="date-picker-clear"]',
  );

  /** Returns the display text shown on the trigger button (date or placeholder). */
  async getDisplayText(): Promise<string> {
    const btn = await this.getTriggerButton();
    const span = await btn.text();
    // Strip leading/trailing whitespace and the calendar icon text
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

  /** Returns true if the trigger button currently holds focus. */
  async isTriggerFocused(): Promise<boolean> {
    const btn = await this.getTriggerButton();
    return btn.matchesSelector(':focus');
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

  /** Returns true if the clear affordance is rendered (clearable + populated). */
  async hasClearButton(): Promise<boolean> {
    return (await this.getClearButtonIfPresent()) !== null;
  }

  /** Returns the clear button's accessible label, or null when hidden. */
  async getClearButtonLabel(): Promise<string | null> {
    const btn = await this.getClearButtonIfPresent();
    return btn ? btn.getAttribute('aria-label') : null;
  }

  /** Clears the selected date via the clear affordance. */
  async clear(): Promise<void> {
    const btn = await this.getClearButtonIfPresent();
    if (!btn) {
      throw new Error(
        'Date picker has no clear button (not clearable or no value selected)',
      );
    }
    await btn.click();
  }
}
