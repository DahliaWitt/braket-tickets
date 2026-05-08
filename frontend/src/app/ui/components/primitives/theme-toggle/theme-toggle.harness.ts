import { ComponentHarness } from '@angular/cdk/testing';

export type ThemeOption = 'light' | 'dark' | 'system';

export class ThemeToggleComponentHarness extends ComponentHarness {
  static hostSelector = 'app-theme-toggle';

  private readonly primaryButton = this.locatorFor('[data-testid="theme-primary-btn"]');
  private readonly chevronButton = this.locatorFor('[data-testid="theme-chevron-btn"]');
  private readonly menuItems = this.locatorForAll('button[role="menuitemradio"]');

  /** Click the primary icon button to quick-toggle the theme. */
  async clickPrimary(): Promise<void> {
    await (await this.primaryButton()).click();
  }

  /** Click the chevron button to open the theme dropdown. */
  async openMenu(): Promise<void> {
    await (await this.chevronButton()).click();
  }

  /** Returns the aria-label of the primary icon button. */
  async getPrimaryAriaLabel(): Promise<string | null> {
    return (await this.primaryButton()).getAttribute('aria-label');
  }

  /**
   * Select a theme option from the dropdown menu.
   * Callers must ensure the menu is open before calling this.
   */
  async selectTheme(theme: ThemeOption): Promise<void> {
    const labelMap: Record<ThemeOption, string> = {
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    };
    const label = labelMap[theme];
    const buttons = await this.menuItems();
    for (const btn of buttons) {
      const text = await btn.text();
      if (text.includes(label)) {
        await btn.click();
        return;
      }
    }
  }

  /**
   * Returns the currently active theme by checking which menu item has data-active set.
   * Callers must ensure the menu is open before calling this.
   */
  async getActiveTheme(): Promise<ThemeOption | null> {
    const buttons = await this.menuItems();
    for (const btn of buttons) {
      const active = await btn.getAttribute('data-active');
      if (active === 'true' || active === '') {
        const text = await btn.text();
        if (text.includes('Light')) return 'light';
        if (text.includes('Dark')) return 'dark';
        if (text.includes('System')) return 'system';
      }
    }
    return null;
  }
}
