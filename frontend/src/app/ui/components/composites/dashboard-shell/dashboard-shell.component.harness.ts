import {ComponentHarness} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class DashboardShellHarness extends ComponentHarness {
  static hostSelector = 'app-dashboard-shell';

  private getTitlePrefix = this.locatorForOptional(
    '[data-testid="title-prefix"]',
  );
  private getTitleAccent = this.locatorForOptional(
    '[data-testid="title-accent"]',
  );
  private getTabLinks = this.locatorForAll('[data-testid="tab-link"]');
  private getTabIndicators = this.locatorForAll(
    '[data-testid="tab-indicator"]',
  );
  private getTitle = this.locatorForOptional('h1');
  private getDesktopSectionNav = this.locatorForOptional(
    '[data-testid="desktop-section-nav"]',
  );
  private getMobileSectionOptions = this.locatorForAll(
    '[data-testid="mobile-section-select"] option',
  );
  private getMobileSectionNav = this.locatorForOptional(
    '[data-testid="mobile-section-nav"]',
  );
  private getMobileSectionSelect = this.locatorForOptional(
    '[data-testid="mobile-section-select"]',
  );
  private getMainContent = this.locatorForOptional('#main-content');
  private getActionsSlot = this.locatorForOptional(
    '[data-testid="actions-slot"]',
  );
  private getCustomHeader = this.locatorForOptional(
    '[data-testid="dashboard-custom-header"]',
  );

  async getTitlePrefixText(): Promise<string> {
    const el = await this.getTitlePrefix();
    return el ? (await el.text()).trim() : '';
  }

  async getTitleAccentText(): Promise<string> {
    const el = await this.getTitleAccent();
    return el ? (await el.text()).trim() : '';
  }

  async hasCustomHeader(): Promise<boolean> {
    return (await this.getCustomHeader()) !== null;
  }

  async getTitleClass(): Promise<string | null> {
    const el = await this.getTitle();
    return el ? el.getAttribute('class') : null;
  }

  async getTitleAccentClass(): Promise<string | null> {
    const el = await this.getTitleAccent();
    return el ? el.getAttribute('class') : null;
  }

  async getTabLinkClasses(): Promise<(string | null)[]> {
    const tabs = await this.getTabLinks();
    return Promise.all(tabs.map((tab) => tab.getAttribute('class')));
  }

  async getTabIndicatorClasses(): Promise<(string | null)[]> {
    const indicators = await this.getTabIndicators();
    return Promise.all(
      indicators.map((indicator) => indicator.getAttribute('class')),
    );
  }

  async getTabLabels(): Promise<string[]> {
    const tabs = await this.getTabLinks();
    return Promise.all(tabs.map(async (tab) => (await tab.text()).trim()));
  }

  async getTabCount(): Promise<number> {
    const tabs = await this.getTabLinks();
    return tabs.length;
  }

  async getDesktopSectionNavClass(): Promise<string | null> {
    const nav = await this.getDesktopSectionNav();
    return nav ? nav.getAttribute('class') : null;
  }

  async getMainContentClass(): Promise<string | null> {
    const main = await this.getMainContent();
    return main ? main.getAttribute('class') : null;
  }

  async getMobileSectionNavClass(): Promise<string | null> {
    const nav = await this.getMobileSectionNav();
    return nav ? nav.getAttribute('class') : null;
  }

  async clickTab(label: string): Promise<void> {
    const tabs = await this.getTabLinks();
    for (const tab of tabs) {
      if ((await tab.text()).trim() === label) {
        await tab.click();
        // Wait for Angular router + zoneless CD to complete navigation
        await waitForHarnessCondition(
          async () => (await tab.getAttribute('aria-current')) === 'page',
          {description: `tab "${label}" to become current`},
        );
        return;
      }
    }
    throw new Error(`Tab "${label}" not found`);
  }

  async hasActionsContent(): Promise<boolean> {
    const slot = await this.getActionsSlot();
    if (!slot) return false;
    const text = await slot.text();
    return text.trim().length > 0;
  }

  async getFullTitleText(): Promise<string> {
    const el = await this.locatorForOptional('h1')();
    return el ? (await el.text()).trim() : '';
  }

  async getProjectedContentText(): Promise<string> {
    const el = await this.locatorForOptional(
      '[data-testid="projected-content"]',
    )();
    return el ? (await el.text()).trim() : '';
  }

  async getMobileSectionLabels(): Promise<string[]> {
    const options = await this.getMobileSectionOptions();
    return Promise.all(
      options.map(async (option) => (await option.text()).trim()),
    );
  }

  async getMobileSectionCount(): Promise<number> {
    const options = await this.getMobileSectionOptions();
    return options.length;
  }

  async getTabHrefs(): Promise<(string | null)[]> {
    const tabs = await this.getTabLinks();
    return Promise.all(tabs.map((tab) => tab.getAttribute('href')));
  }

  async getMobileSectionOptionValues(): Promise<(string | null)[]> {
    const options = await this.getMobileSectionOptions();
    return Promise.all(
      options.map(async (option) => {
        const value: unknown = await option.getProperty('value');
        return typeof value === 'string' ? value : null;
      }),
    );
  }

  async hasMobileSectionNav(): Promise<boolean> {
    const nav = await this.getMobileSectionNav();
    return nav !== null;
  }

  async getSelectedMobileSectionValue(): Promise<string | null> {
    const select = await this.getMobileSectionSelect();
    if (!select) return null;
    const value: unknown = await select.getProperty('value');
    return typeof value === 'string' ? value : null;
  }

  async getTabAriaCurrentValues(): Promise<(string | null)[]> {
    const tabs = await this.getTabLinks();
    return Promise.all(tabs.map((tab) => tab.getAttribute('aria-current')));
  }

  async clickTabByLabel(label: string): Promise<void> {
    const tabs = await this.getTabLinks();
    for (const tab of tabs) {
      if ((await tab.text()).trim() === label) {
        await tab.click();
        return;
      }
    }
    throw new Error(`Tab "${label}" not found`);
  }

  async selectMobileSectionByLabel(label: string): Promise<void> {
    const select = await this.getMobileSectionSelect();
    if (!select) {
      throw new Error('Mobile section selector not found');
    }

    const options = await this.getMobileSectionOptions();
    for (let index = 0; index < options.length; index++) {
      if ((await options[index].text()).trim() === label) {
        await select.selectOptions(index);
        return;
      }
    }
    throw new Error(`Mobile section "${label}" not found`);
  }
}
