import {ComponentHarness} from '@angular/cdk/testing';

interface OutgoingLinkInfo {
  name: string;
}

interface IncomingLinkInfo {
  name: string;
}

export class SharedVettingTableHarness extends ComponentHarness {
  static hostSelector = 'app-shared-vetting-table';

  private getOrganizerSelectContainer = this.locatorForOptional(
    '[data-testid="organizer-select-container"]',
  );

  /** Returns true if the internal organizer selector is rendered (hidden when organizerId input is set) */
  async hasOrganizerSelect(): Promise<boolean> {
    return (await this.getOrganizerSelectContainer()) !== null;
  }

  private getOutgoingRows = this.locatorForAll('[data-testid="outgoing-row"]');
  private getOutgoingCards = this.locatorForAll(
    '[data-testid="outgoing-card"]',
  );
  private getIncomingLinkElements = this.locatorForAll(
    '[data-testid="incoming-link"]',
  );
  private getIncomingLinkActionButtons = this.locatorForAll(
    '[data-testid="incoming-link"] button',
  );
  private getCreateButton = this.locatorForOptional(
    '[data-testid="create-trust-link"]',
  );
  private getOutgoingEmpty = this.locatorForOptional(
    '[data-testid="outgoing-empty"]',
  );
  private getIncomingEmpty = this.locatorForOptional(
    '[data-testid="incoming-empty"]',
  );
  private getNoOrganizersEmpty = this.locatorForOptional(
    '[data-testid="no-organizers-empty"]',
  );
  private getRemoveButtons = this.locatorForAll(
    '[data-testid="remove-button"]',
  );

  /** Returns outgoing link data from the desktop table rows (falls back to mobile cards) */
  async getOutgoingLinks(): Promise<OutgoingLinkInfo[]> {
    let rows = await this.getOutgoingRows();
    if (rows.length === 0) {
      rows = await this.getOutgoingCards();
    }
    const links: OutgoingLinkInfo[] = [];

    for (const row of rows) {
      const name = (await row.getAttribute('data-org-name')) ?? '';
      links.push({name});
    }

    return links;
  }

  /** Returns incoming link data */
  async getIncomingLinks(): Promise<IncomingLinkInfo[]> {
    const elements = await this.getIncomingLinkElements();
    const links: IncomingLinkInfo[] = [];

    for (const el of elements) {
      const name = (await el.getAttribute('data-org-name')) ?? '';
      links.push({name});
    }

    return links;
  }

  async hasIncomingLinkActionButtons(): Promise<boolean> {
    return (await this.getIncomingLinkActionButtons()).length > 0;
  }

  async getRemoveActionLabels(): Promise<string[]> {
    const buttons = await this.getRemoveButtons();
    return Promise.all(
      buttons.map(
        async (button) => (await button.getAttribute('aria-label')) ?? '',
      ),
    );
  }

  /** Clicks the remove button for an outgoing link by organizer name */
  async clickRemove(orgName: string): Promise<void> {
    const index = await this.findOutgoingRowIndex(orgName);
    const buttons = await this.getRemoveButtons();
    if (index >= buttons.length) {
      throw new Error(`Remove button not found for organizer "${orgName}"`);
    }
    await buttons[index].click();
  }

  /** Clicks the Create Trust Link button */
  async clickCreateTrustLink(): Promise<void> {
    const btn = await this.getCreateButton();
    if (!btn) {
      throw new Error('Create Trust Link button not found');
    }
    await btn.click();
  }

  /** Returns the empty state message text, or null if no empty state is shown */
  async getEmptyStateText(): Promise<string | null> {
    const outgoingEmpty = await this.getOutgoingEmpty();
    if (outgoingEmpty) {
      return (await outgoingEmpty.text()).trim();
    }
    const incomingEmpty = await this.getIncomingEmpty();
    if (incomingEmpty) {
      return (await incomingEmpty.text()).trim();
    }
    const noOrgs = await this.getNoOrganizersEmpty();
    if (noOrgs) {
      return (await noOrgs.text()).trim();
    }
    return null;
  }

  /** Finds the index of an outgoing row by organizer name */
  private async findOutgoingRowIndex(orgName: string): Promise<number> {
    let rows = await this.getOutgoingRows();
    if (rows.length === 0) {
      rows = await this.getOutgoingCards();
    }
    for (let i = 0; i < rows.length; i++) {
      const name = await rows[i].getAttribute('data-org-name');
      if (name === orgName) {
        return i;
      }
    }
    throw new Error(`Outgoing link row for organizer "${orgName}" not found`);
  }
}
