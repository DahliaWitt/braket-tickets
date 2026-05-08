import {ComponentHarness} from '@angular/cdk/testing';

export class AdminOverrideBannerHarness extends ComponentHarness {
  static hostSelector = 'app-admin-override-banner';

  private getBanner = this.locatorForOptional('[data-testid="admin-override-banner"]');
  private getCommunityName = this.locatorFor('[data-testid="override-community-name"]');
  private getPortalLink = this.locatorFor('[data-testid="admin-portal-link"]');

  async isVisible(): Promise<boolean> {
    return (await this.getBanner()) !== null;
  }

  async getCommunityNameText(): Promise<string> {
    return (await this.getCommunityName()).text();
  }

  async getPortalLinkHref(): Promise<string | null> {
    return (await this.getPortalLink()).getAttribute('href');
  }
}
