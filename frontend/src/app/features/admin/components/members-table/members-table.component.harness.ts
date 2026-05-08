import {ComponentHarness, type TestElement} from '@angular/cdk/testing';

export interface MemberRowInfo {
  name: string;
  email: string;
  status: string;
  trustSource: string | null;
  actions: string[];
}

export class AdminMembersTableHarness extends ComponentHarness {
  static hostSelector = 'app-admin-members-table';

  // Desktop table rows
  private getRowEls = this.locatorForAll('[data-testid="member-row"]');
  getRows(): Promise<TestElement[]> {
    return this.getRowEls();
  }
  async getRowCount(): Promise<number> {
    return (await this.getRows()).length;
  }

  // Desktop empty state
  private getEmptyStateEl = this.locatorForOptional(
    '[data-testid="empty-state"]',
  );
  async hasEmptyState(): Promise<boolean> {
    return (await this.getEmptyStateEl()) !== null;
  }
  async getEmptyStateText(): Promise<string> {
    const el = await this.getEmptyStateEl();
    return el ? (await el.text()).trim() : '';
  }

  // Per-row accessors (desktop table)
  private getNameEls = this.locatorForAll('[data-testid="member-name"]');
  private getEmailEls = this.locatorForAll('[data-testid="member-email"]');
  private getStatusEls = this.locatorForAll('[data-testid="member-status"]');

  /** Returns the trust source label (e.g. "via Lot 45") if present, or null. */
  async getTrustSourceAt(index: number): Promise<string | null> {
    const statusText = await this.getStatusAt(index);
    const match = statusText.match(/via\s+.+/i);
    return match ? match[0].trim() : null;
  }

  async getNameAt(index: number): Promise<string> {
    const els = await this.getNameEls();
    return els[index] ? (await els[index].text()).trim() : '';
  }

  async getEmailAt(index: number): Promise<string> {
    const els = await this.getEmailEls();
    return els[index] ? (await els[index].text()).trim() : '';
  }

  async getStatusAt(index: number): Promise<string> {
    const els = await this.getStatusEls();
    return els[index] ? (await els[index].text()).trim() : '';
  }

  async getActionLabelsAt(index: number): Promise<string[]> {
    const rows = await this.getRows();
    if (!rows[index]) return [];

    const buttonLocator = this.locatorForAll(
      `[data-testid="member-row"]:nth-of-type(${index + 1}) button`,
    );
    const buttons = await buttonLocator();
    const labels = await Promise.all(buttons.map((button) => button.text()));
    return labels
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
  }

  async getActionAriaLabelsAt(index: number): Promise<string[]> {
    const rows = await this.getRows();
    if (!rows[index]) return [];

    const buttonLocator = this.locatorForAll(
      `[data-testid="member-row"]:nth-of-type(${index + 1}) button`,
    );
    const buttons = await buttonLocator();
    const labels = await Promise.all(
      buttons.map((button) => button.getAttribute('aria-label')),
    );
    return labels.filter((label): label is string => label !== null);
  }

  async getSharedManagedViaAt(index: number): Promise<string | null> {
    const rows = await this.getRows();
    if (!rows[index]) return null;

    const label = await this.locatorForOptional(
      `[data-testid="member-row"]:nth-of-type(${index + 1}) [data-testid="shared-managed-via"]`,
    )();
    return label ? (await label.text()).trim().replace(/\s+/g, ' ') : null;
  }

  /** Returns true if the REVOKE MEMBERSHIP button is absent for the row at the given index. */
  async isRevokeMembershipHiddenAt(index: number): Promise<boolean> {
    const labels = await this.getActionLabelsAt(index);
    return !labels.some((l) => l.includes('REVOKE MEMBERSHIP'));
  }

  private getFilterButtonEls = this.locatorForAll(
    '[data-testid="member-filter"] button',
  );
  async getFilterLabels(): Promise<string[]> {
    const buttons = await this.getFilterButtonEls();
    return Promise.all(
      buttons.map(async (button) => (await button.text()).trim()),
    );
  }

  /** Returns structured info for all desktop rows. */
  async getAllRows(): Promise<MemberRowInfo[]> {
    const names = await this.getNameEls();
    const emails = await this.getEmailEls();
    const statuses = await this.getStatusEls();
    const count = names.length;
    const rows: MemberRowInfo[] = [];
    for (let i = 0; i < count; i++) {
      const statusText = (await statuses[i].text()).trim();
      const trustMatch = statusText.match(/via\s+.+/i);
      rows.push({
        name: (await names[i].text()).trim(),
        email: (await emails[i].text()).trim(),
        status: statusText,
        trustSource: trustMatch ? trustMatch[0].trim() : null,
        actions: await this.getActionLabelsAt(i),
      });
    }
    return rows;
  }
}
