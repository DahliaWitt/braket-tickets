import { ComponentHarness } from '@angular/cdk/testing';

export class OfflineBannerComponentHarness extends ComponentHarness {
  static hostSelector = 'app-offline-banner';

  private readonly bannerEl = this.locatorForOptional('[role="alert"]');

  async isVisible(): Promise<boolean> {
    const banner = await this.bannerEl();
    return banner !== null;
  }

  async getText(): Promise<string> {
    const banner = await this.bannerEl();
    return banner ? banner.text() : '';
  }
}
