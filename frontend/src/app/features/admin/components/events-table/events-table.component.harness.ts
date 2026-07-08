import {ComponentHarness} from '@angular/cdk/testing';

export class AdminEventsTableHarness extends ComponentHarness {
  static hostSelector = 'app-admin-events-table';

  private getEntries = this.locatorForAll('[data-testid="event-entry"]');
  private getCreateEventButton = this.locatorFor(
    '[data-testid="create-event"]',
  );
  private getManageButtons = this.locatorForAll('[data-testid="manage-event"]');
  private getEditButtons = this.locatorForAll('[data-testid="edit-event"]');
  private getDeleteButtons = this.locatorForAll('[data-testid="delete-event"]');
  private getStatusBadges = this.locatorForAll('[data-testid="event-status"]');
  private getMobileContent = this.locatorForAll(
    '[data-testid="event-mobile-content"]',
  );

  async getEntryCount(): Promise<number> {
    return (await this.getEntries()).length;
  }

  async getEntryTexts(): Promise<string[]> {
    const entries = await this.getEntries();
    return Promise.all(entries.map((entry) => entry.text()));
  }

  async getMobileContentTextAtIndex(index: number): Promise<string> {
    const contents = await this.getMobileContent();
    return (await contents[index]?.text()) ?? '';
  }

  async clickCreateEvent(): Promise<void> {
    const button = await this.getCreateEventButton();
    await button.click();
  }

  async clickManageAtIndex(index: number): Promise<void> {
    const buttons = await this.getManageButtons();
    await buttons[index]?.click();
  }

  async getManageHrefAtIndex(index: number): Promise<string | null> {
    const buttons = await this.getManageButtons();
    return (await buttons[index]?.getAttribute('href')) ?? null;
  }

  async clickEditAtIndex(index: number): Promise<void> {
    const buttons = await this.getEditButtons();
    await buttons[index]?.click();
  }

  async getEditHrefAtIndex(index: number): Promise<string | null> {
    const buttons = await this.getEditButtons();
    return (await buttons[index]?.getAttribute('href')) ?? null;
  }

  async clickDeleteAtIndex(index: number): Promise<void> {
    const buttons = await this.getDeleteButtons();
    await buttons[index]?.click();
  }

  async getDeleteAriaLabelAtIndex(index: number): Promise<string | null> {
    const buttons = await this.getDeleteButtons();
    return (await buttons[index]?.getAttribute('aria-label')) ?? null;
  }

  async getStatusTextAtIndex(index: number): Promise<string> {
    const badges = await this.getStatusBadges();
    return ((await badges[index]?.text()) ?? '').trim();
  }

  /**
   * All status badge texts in DOM order: desktop table rows first, then
   * mobile cards (both variants carry the same test id).
   */
  async getStatusTexts(): Promise<string[]> {
    const badges = await this.getStatusBadges();
    const texts = await Promise.all(badges.map((badge) => badge.text()));
    return texts.map((text) => text.trim());
  }

  async getStatusVariantAtIndex(index: number): Promise<string | null> {
    const badges = await this.getStatusBadges();
    return (await badges[index]?.getAttribute('data-status')) ?? null;
  }
}
