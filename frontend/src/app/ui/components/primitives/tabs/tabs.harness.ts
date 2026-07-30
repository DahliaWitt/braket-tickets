import {ComponentHarness} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class ZardTabGroupHarness extends ComponentHarness {
  static hostSelector = 'z-tab-group';

  private getTabs = this.locatorForAll('button[role="tab"]');

  async getTabLabels(): Promise<string[]> {
    const tabs = await this.getTabs();
    return Promise.all(tabs.map((t) => t.text()));
  }

  async getActiveTabIndex(): Promise<number> {
    const tabs = await this.getTabs();
    for (let i = 0; i < tabs.length; i++) {
      if ((await tabs[i].getAttribute('aria-selected')) === 'true') return i;
    }
    return -1;
  }

  async selectTab(index: number): Promise<void> {
    const tabs = await this.getTabs();
    if (index < tabs.length) {
      await tabs[index].click();
      await waitForHarnessCondition(
        async () =>
          (await tabs[index].getAttribute('aria-selected')) === 'true',
        {description: `tab ${index} selection`},
      );
    }
  }

  async getTabCount(): Promise<number> {
    return (await this.getTabs()).length;
  }

  /**
   * Whether every tab button opts into a pointer cursor. Tailwind v4 preflight
   * resets buttons to `cursor: default`, so tab buttons must explicitly re-add
   * `cursor-pointer`.
   */
  async tabButtonsHavePointerCursor(): Promise<boolean> {
    const tabs = await this.getTabs();
    if (tabs.length === 0) return false;
    const flags = await Promise.all(
      tabs.map((tab) => tab.hasClass('cursor-pointer')),
    );
    return flags.every(Boolean);
  }
}
