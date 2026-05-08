import {ComponentHarness} from '@angular/cdk/testing';
import {ZardSkeletonComponentHarness} from '@ui/components/primitives/skeleton/skeleton.component.harness';

export class AdminCommunityListComponentHarness extends ComponentHarness {
  static hostSelector = 'app-admin-community-list';

  private readonly getCommunityEntries = this.locatorForAll(
    '[data-testid="community-entry"]',
  );
  private readonly getEditActions = this.locatorForAll(
    '[data-testid="community-entry"] a[z-button]',
  );
  private readonly getEditCommunityActions = this.locatorForAll(
    '[data-testid="edit-community-btn"]',
  );
  private readonly getManageActions = this.locatorForAll(
    '[data-testid="manage-community-btn"]',
  );
  private readonly getInviteAdminButton = this.locatorFor(
    '[data-testid="invite-admin-btn"]',
  );
  private readonly getStatusBadges = this.locatorForAll(
    '[data-testid="community-status-badge"]',
  );

  async getCommunityEntryCount(): Promise<number> {
    return (await this.getCommunityEntries()).length;
  }

  async getEditActionCount(): Promise<number> {
    return (await this.getEditActions()).length;
  }

  async getManageActionCount(): Promise<number> {
    return (await this.getManageActions()).length;
  }

  async clickInviteAdmin(): Promise<void> {
    const button = await this.getInviteAdminButton();
    await button.click();
  }

  /** Returns the text content of all status badges (one per layout per community). */
  async getStatusBadgeTexts(): Promise<string[]> {
    const badges = await this.getStatusBadges();
    return Promise.all(badges.map((b) => b.text()));
  }

  async isShowingSkeleton(): Promise<boolean> {
    const desktopRows = await this.locatorForAll(
      '[data-testid="desktop-skeleton-row"]',
    )();
    const mobileCards = await this.locatorForAll(
      '[data-testid="mobile-skeleton-card"]',
    )();
    return desktopRows.length > 0 || mobileCards.length > 0;
  }

  async getDesktopSkeletonRowCount(): Promise<number> {
    const rows = await this.locatorForAll(
      '[data-testid="desktop-skeleton-row"]',
    )();
    return rows.length;
  }

  async getMobileSkeletonCardCount(): Promise<number> {
    const cards = await this.locatorForAll(
      '[data-testid="mobile-skeleton-card"]',
    )();
    return cards.length;
  }

  async getSkeletonHarnesses(): Promise<ZardSkeletonComponentHarness[]> {
    return this.locatorForAll(ZardSkeletonComponentHarness)();
  }

  async getManageLinkHrefs(): Promise<(string | null)[]> {
    const buttons = await this.getManageActions();
    return Promise.all(buttons.map((b) => b.getAttribute('href')));
  }

  async clickFirstManageAction(): Promise<void> {
    const buttons = await this.getManageActions();
    if (!buttons[0]) throw new Error('Manage action not found');
    await buttons[0].click();
  }

  async clickFirstEditAction(): Promise<void> {
    const buttons = await this.getEditCommunityActions();
    if (!buttons[0]) throw new Error('Edit action not found');
    await buttons[0].click();
  }
}
