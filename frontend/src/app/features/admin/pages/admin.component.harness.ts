import { ComponentHarness } from '@angular/cdk/testing';
import { DashboardShellHarness } from '@ui/components/composites/dashboard-shell/dashboard-shell.component.harness';

export class AdminComponentHarness extends ComponentHarness {
  static hostSelector = 'app-admin';

  private getShell = this.locatorFor(DashboardShellHarness);
  private getCommunityList = this.locatorForOptional('app-admin-community-list');
  private getTableRows = this.locatorForAll('tbody tr');
  private getApproveButtons = this.locatorForAll('button[z-button][zType="default"]');

  getShellHarness(): Promise<DashboardShellHarness> {
    return this.getShell();
  }

  async getTabLabels(): Promise<string[]> {
    const shell = await this.getShell();
    return shell.getTabLabels();
  }

  async hasCommunityList(): Promise<boolean> {
    return (await this.getCommunityList()) !== null;
  }

  async getApplicationCount(): Promise<number> {
    const rows = await this.getTableRows();
    if (rows.length === 1) {
      const text = await rows[0].text();
      if (
        text.includes('NO PENDING APPLICATIONS') ||
        text.includes('NO HISTORY APPLICATIONS') ||
        text.includes('NO MEMBERS FOUND')
      ) {
        return 0;
      }
    }
    return rows.length;
  }

  async hasApproveButton(): Promise<boolean> {
    const buttons = await this.getApproveButtons();
    return buttons.length > 0;
  }

  async hasHomeLink(): Promise<boolean> {
    const links = await this.locatorForAll('a')();
    for (const link of links) {
      const label = (await link.text()).trim().toUpperCase();
      const href = await link.getAttribute('href');
      if (label.includes('HOME') || href === '/') {
        return true;
      }
    }
    return false;
  }

  async clickLogout(): Promise<void> {
    const buttons = await this.locatorForAll('button')();
    for (const button of buttons) {
      const text = await button.text();
      if (text.trim().toLowerCase() === 'logout') {
        await button.click();
        return;
      }
    }
    throw new Error('Logout button not found');
  }
}
