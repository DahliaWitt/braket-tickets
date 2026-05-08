import { ComponentHarness } from '@angular/cdk/testing';

export class ThemeToggleButtonHarness extends ComponentHarness {
  static hostSelector = '[data-testid="theme-toggle-root"]';

  private readonly primaryBtn = this.locatorFor('[data-testid="theme-primary-btn"]');
  private readonly chevronBtn = this.locatorFor('[data-testid="theme-chevron-btn"]');

  async clickPrimary(): Promise<void> {
    await (await this.primaryBtn()).click();
  }

  async openMenu(): Promise<void> {
    await (await this.chevronBtn()).click();
  }

  async getPrimaryAriaLabel(): Promise<string | null> {
    return (await this.primaryBtn()).getAttribute('aria-label');
  }

  /** Legacy: returns the primary button's aria-label (previously "Toggle theme"). */
  async getAriaLabel(): Promise<string | null> {
    return this.getPrimaryAriaLabel();
  }
}
