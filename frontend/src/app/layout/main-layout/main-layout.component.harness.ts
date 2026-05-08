import { ComponentHarness } from '@angular/cdk/testing';

export class MainLayoutComponentHarness extends ComponentHarness {
  static hostSelector = 'app-main-layout';

  private getHeader = this.locatorForOptional('app-header');
  private getFooter = this.locatorForOptional('app-footer');
  private getOutletContainer = this.locatorForOptional('.flex-outlet');
  private getRouterOutlet = this.locatorForOptional('router-outlet');

  /** Returns true when the header component is rendered. */
  async isHeaderPresent(): Promise<boolean> {
    return (await this.getHeader()) !== null;
  }

  /** Returns true when the footer component is rendered. */
  async isFooterPresent(): Promise<boolean> {
    return (await this.getFooter()) !== null;
  }

  /** Returns true when the main outlet container div is present. */
  async isContentAreaPresent(): Promise<boolean> {
    return (await this.getOutletContainer()) !== null;
  }

  /** Returns true when the router-outlet element is present. */
  async isRouterOutletPresent(): Promise<boolean> {
    return (await this.getRouterOutlet()) !== null;
  }
}
