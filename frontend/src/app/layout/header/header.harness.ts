import {ComponentHarness} from '@angular/cdk/testing';

export class HeaderHarness extends ComponentHarness {
  static hostSelector = 'app-header';

  private readonly getSkipLinkEl = this.locatorForOptional(
    'a[href="#main-content"]',
  );
  private readonly getMobileNavEl = this.locatorForOptional('nav.mobile-menu');
  private readonly getMenuToggleBtnEl = this.locatorForOptional(
    '[data-testid="mobile-menu-toggle"]',
  );
  private readonly getLogoEl = this.locatorForOptional(
    '[data-testid="header-logo"]',
  );

  async getSkipLinkText(): Promise<string | null> {
    const link = await this.getSkipLinkEl();
    return link ? link.text() : null;
  }

  async getMobileNavTabindex(): Promise<string | null> {
    const nav = await this.getMobileNavEl();
    return nav ? nav.getAttribute('tabindex') : null;
  }

  async isMobileNavInert(): Promise<boolean> {
    const nav = await this.getMobileNavEl();
    if (!nav) return false;
    return (await nav.getAttribute('inert')) !== null;
  }

  async focusMenuToggle(): Promise<void> {
    const btn = await this.getMenuToggleBtnEl();
    if (!btn) throw new Error('Mobile menu toggle button not found');
    await btn.focus();
  }

  async isMenuToggleFocused(): Promise<boolean> {
    const btn = await this.getMenuToggleBtnEl();
    if (!btn) return false;
    return btn.isFocused();
  }

  async getLogoClass(): Promise<string | null> {
    const logo = await this.getLogoEl();
    return logo ? logo.getAttribute('class') : null;
  }
}
