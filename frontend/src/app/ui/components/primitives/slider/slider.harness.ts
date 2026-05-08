import { ComponentHarness } from '@angular/cdk/testing';

export class ZardSliderComponentHarness extends ComponentHarness {
  static hostSelector = 'z-slider';

  private readonly thumbEl = this.locatorFor('[data-slot="slider-thumb"]');
  private readonly trackEl = this.locatorFor('[data-slot="slider-track"]');

  async getValue(): Promise<number> {
    const thumb = await this.thumbEl();
    const raw = await thumb.getAttribute('aria-valuenow');
    return raw !== null ? Number(raw) : NaN;
  }

  async getMin(): Promise<number> {
    const thumb = await this.thumbEl();
    const raw = await thumb.getAttribute('aria-valuemin');
    return raw !== null ? Number(raw) : 0;
  }

  async getMax(): Promise<number> {
    const thumb = await this.thumbEl();
    const raw = await thumb.getAttribute('aria-valuemax');
    return raw !== null ? Number(raw) : 100;
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }

  async getOrientation(): Promise<string> {
    const host = await this.host();
    return (await host.getAttribute('data-orientation')) ?? 'horizontal';
  }

  /** Focus the thumb to enable keyboard interaction. */
  async focusThumb(): Promise<void> {
    const thumb = await this.thumbEl();
    return thumb.focus();
  }

  /** Send a keyboard key to the focused thumb element. */
  async sendKeys(...keys: string[]): Promise<void> {
    const thumb = await this.thumbEl();
    return thumb.sendKeys(...keys);
  }

  async isThumbFocused(): Promise<boolean> {
    const thumb = await this.thumbEl();
    return thumb.isFocused();
  }

  /** Returns the rendered percentage of the slider range (0–100). */
  async getPercent(): Promise<number> {
    const min = await this.getMin();
    const max = await this.getMax();
    const value = await this.getValue();
    if (max === min) return 0;
    return ((value - min) / (max - min)) * 100;
  }
}
