import { ComponentHarness } from '@angular/cdk/testing';

export class BraInventoryMeterHarness extends ComponentHarness {
  static hostSelector = 'bra-inventory-meter';

  /**
   * Read the "X / Y" headline stat (sold / total).
   * Collapses whitespace so "85 / 100" matches regardless of template line breaks.
   */
  async getHeadline(): Promise<string> {
    const el = await this.locatorFor('[data-testid$="-main"]')();
    const text = await el.text();
    return text.replace(/\s+/g, ' ').trim();
  }

  async getPercentage(): Promise<string> {
    const el = await this.locatorFor('[data-testid$="-percent"]')();
    return (await el.text()).trim();
  }

  async getStatusText(): Promise<string> {
    const el = await this.locatorFor('[data-testid$="-status"]')();
    return (await el.text()).replace(/\s+/g, ' ').trim();
  }

  async hasHeldSegment(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid$="-held-segment"]',
    )();
    return el !== null;
  }

  async hasSoldSegment(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid$="-sold-segment"]',
    )();
    return el !== null;
  }

  async getAriaValueText(): Promise<string | null> {
    const el = await this.locatorFor('[role="progressbar"]')();
    return el.getAttribute('aria-valuetext');
  }

  async getAriaValueNow(): Promise<string | null> {
    const el = await this.locatorFor('[role="progressbar"]')();
    return el.getAttribute('aria-valuenow');
  }

  async getAriaValueMax(): Promise<string | null> {
    const el = await this.locatorFor('[role="progressbar"]')();
    return el.getAttribute('aria-valuemax');
  }
}
