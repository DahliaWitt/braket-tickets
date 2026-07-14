import {ComponentHarness} from '@angular/cdk/testing';

export class PrivacyPolicyHarness extends ComponentHarness {
  static hostSelector = 'app-privacy-policy';

  private readonly getNoticeTableRegion = this.locatorFor(
    '[data-testid="privacy-notice-table-region"]',
  );

  async getNoticeTableRegionAttributes(): Promise<{
    role: string | null;
    ariaLabel: string | null;
    tabIndex: string | null;
    className: string | null;
  }> {
    const region = await this.getNoticeTableRegion();
    return {
      role: await region.getAttribute('role'),
      ariaLabel: await region.getAttribute('aria-label'),
      tabIndex: await region.getAttribute('tabindex'),
      className: await region.getAttribute('class'),
    };
  }
}
