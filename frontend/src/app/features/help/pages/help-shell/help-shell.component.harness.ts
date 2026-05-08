import { ComponentHarness } from '@angular/cdk/testing';

export class HelpShellComponentHarness extends ComponentHarness {
  static hostSelector = 'app-help-shell';

  private getSidebarNav = this.locatorForOptional('[data-testid="help-sidebar-nav"]');
  private getMobileMenuButton = this.locatorForOptional('button[aria-label="Toggle sidebar"]');
  private getErrorState = this.locatorForOptional('[data-testid="help-shell-error-state"]');
  private getMainContent = this.locatorForOptional('main');
  private getSidebarOverlay = this.locatorForOptional(
    'div.fixed.inset-0.z-30',
  );

  async isSidebarNavVisible(): Promise<boolean> {
    return (await this.getSidebarNav()) !== null;
  }

  async isMobileMenuButtonVisible(): Promise<boolean> {
    return (await this.getMobileMenuButton()) !== null;
  }

  async clickMobileMenuButton(): Promise<void> {
    const btn = await this.getMobileMenuButton();
    if (!btn) throw new Error('Mobile menu button is not visible');
    await btn.click();
  }

  async isSidebarOpen(): Promise<boolean> {
    const btn = await this.getMobileMenuButton();
    if (!btn) return false;
    const expanded = await btn.getAttribute('aria-expanded');
    return expanded === 'true';
  }

  async closeOverlay(): Promise<void> {
    const overlay = await this.getSidebarOverlay();
    if (!overlay) throw new Error('Sidebar overlay is not visible');
    await overlay.click();
  }

  async isOverlayVisible(): Promise<boolean> {
    return (await this.getSidebarOverlay()) !== null;
  }

  async isErrorStateVisible(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  async getErrorText(): Promise<string> {
    const el = await this.getErrorState();
    if (!el) return '';
    return (await el.text()).trim();
  }

  async isMainContentVisible(): Promise<boolean> {
    return (await this.getMainContent()) !== null;
  }

  async isMainContentInert(): Promise<boolean> {
    const main = await this.getMainContent();
    if (!main) return false;
    const inert = await main.getAttribute('inert');
    return inert !== null;
  }

  async getMobileHeaderText(): Promise<string> {
    const header = await this.locatorForOptional('div.md\\:hidden span')();
    if (!header) return '';
    return (await header.text()).trim();
  }
}
