import { ComponentHarness } from '@angular/cdk/testing';

export class ZardSliderHarness extends ComponentHarness {
  static hostSelector = 'z-slider';

  private readonly thumb = this.locatorFor('[data-slot="slider-thumb"]');

  async getValue(): Promise<number> {
    const thumb = await this.thumb();
    return Number(await thumb.getAttribute('aria-valuenow'));
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('aria-disabled')) === 'true';
  }
}
