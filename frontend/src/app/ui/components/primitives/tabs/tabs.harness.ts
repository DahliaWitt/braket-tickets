import { ComponentHarness } from '@angular/cdk/testing';
import { waitForHarnessCondition } from '@/testing/harness-wait';

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
        async () => (await tabs[index].getAttribute('aria-selected')) === 'true',
        { description: `tab ${index} selection` },
      );
    }
  }

  async getTabCount(): Promise<number> {
    return (await this.getTabs()).length;
  }
}
