import {
  ComponentHarness,
  type TestElement,
  TestKey,
} from '@angular/cdk/testing';
import {CommunitySelectorHarness} from '@/features/admin/components/community-selector/community-selector.harness';
import {AuditLogTableHarness} from '../../components/audit-log-table/audit-log-table.harness';

export class CommunityAdminHarness extends ComponentHarness {
  static hostSelector = 'app-community-admin';

  private getTabLinksAll = this.locatorForAll('[data-testid="tab-link"]');
  private getMobileSectionSelectEl = this.locatorForOptional(
    '[data-testid="mobile-section-select"]',
  );
  private getCommunitySelectorEl = this.locatorForOptional(
    CommunitySelectorHarness,
  );
  private getLoadingStateEl = this.locatorForOptional(
    '[data-testid="loading-state"]',
  );
  private getEmptyStateEl = this.locatorForOptional(
    '[data-testid="empty-state"]',
  );
  private getEmptyStateTextEl = this.locatorForOptional(
    '[data-testid="empty-state-text"]',
  );
  private getApplicationsTableEl = this.locatorForOptional(
    'app-admin-applications-table',
  );
  private getMembersTableEl = this.locatorForOptional(
    'app-admin-members-table',
  );
  private getEventsTableEl = this.locatorForOptional('app-admin-events-table');
  private getCreateLinkButtonEl = this.locatorForOptional(
    '[data-testid="create-link-button"]',
  );
  private getMagicLinksEmptyStateEl = this.locatorForOptional(
    '[data-testid="magic-links-empty-state"]',
  );
  private getEmptyCreateLinkButtonEl = this.locatorForOptional(
    '[data-testid="empty-create-link-button"]',
  );
  private getCustomHeaderEl = this.locatorForOptional(
    '[data-testid="dashboard-custom-header"]',
  );
  private getSettingsComponentEl = this.locatorForOptional(
    'app-community-admin-settings',
  );
  private getOverrideBannerEl = this.locatorForOptional(
    '[data-testid="admin-override-banner"]',
  );
  private getCommunityLogoEl = this.locatorForOptional(
    '[data-testid="community-logo"]',
  );
  private getSkeletonsAll = this.locatorForAll('z-skeleton');

  /** Returns all tab link elements from the dashboard shell. */
  getTabLinks(): Promise<TestElement[]> {
    return this.getTabLinksAll();
  }

  /** Returns the text labels of all tab links. */
  async getTabLabels(): Promise<string[]> {
    const tabs = await this.getTabLinksAll();
    return Promise.all(tabs.map((tab) => tab.text())).then((texts) =>
      texts.map((text) => text.trim()),
    );
  }

  /** Returns the section selected by the shell's mobile/tablet nav. */
  async getSelectedMobileSectionValue(): Promise<string | null> {
    const select = await this.getMobileSectionSelectEl();
    if (!select) return null;
    const value: unknown = await select.getProperty('value');
    return typeof value === 'string' ? value : null;
  }

  /** Returns the CommunitySelectorHarness, or null if not present. */
  getCommunitySelector(): Promise<CommunitySelectorHarness | null> {
    return this.getCommunitySelectorEl();
  }

  /** Returns true when app-community-selector is present in the DOM. */
  async hasCommunitySelector(): Promise<boolean> {
    return (await this.getCommunitySelectorEl()) !== null;
  }

  /** Returns all z-skeleton elements currently in the DOM. */
  getSkeletons(): Promise<TestElement[]> {
    return this.getSkeletonsAll();
  }

  /** Returns true when at least one z-skeleton is present. */
  async hasSkeletons(): Promise<boolean> {
    return (await this.getSkeletonsAll()).length > 0;
  }

  /** Returns the text of the empty-state label, or null if not present. */
  async getEmptyStateText(): Promise<string | null> {
    const el = await this.getEmptyStateTextEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Returns true when the empty state container is present. */
  async hasEmptyState(): Promise<boolean> {
    return (await this.getEmptyStateEl()) !== null;
  }

  /** Returns the applications table element, or null if not rendered. */
  getApplicationsTable(): Promise<TestElement | null> {
    return this.getApplicationsTableEl();
  }

  /** Returns true when app-admin-applications-table is present. */
  async hasApplicationsTable(): Promise<boolean> {
    return (await this.getApplicationsTableEl()) !== null;
  }

  /** Returns the members table element, or null if not rendered. */
  getMembersTable(): Promise<TestElement | null> {
    return this.getMembersTableEl();
  }

  /** Returns true when app-admin-members-table is present. */
  async hasMembersTable(): Promise<boolean> {
    return (await this.getMembersTableEl()) !== null;
  }

  /** Returns the events table element, or null if not rendered. */
  getEventsTable(): Promise<TestElement | null> {
    return this.getEventsTableEl();
  }

  /** Returns true when app-admin-events-table is present. */
  async hasEventsTable(): Promise<boolean> {
    return (await this.getEventsTableEl()) !== null;
  }

  /** Returns the CREATE LINK button element, or null if not rendered. */
  getCreateLinkButton(): Promise<TestElement | null> {
    return this.getCreateLinkButtonEl();
  }

  /** Returns true when the CREATE LINK button is present. */
  async hasCreateLinkButton(): Promise<boolean> {
    return (await this.getCreateLinkButtonEl()) !== null;
  }

  /** Clicks the visible CREATE LINK entry point. */
  async clickCreateLinkButton(): Promise<void> {
    const button = await this.getCreateLinkButtonEl();
    if (!button) throw new Error('Create link button was not rendered');
    await button.click();
  }

  /** Returns true when the no-link magic-links empty state is present. */
  async hasMagicLinksEmptyState(): Promise<boolean> {
    return (await this.getMagicLinksEmptyStateEl()) !== null;
  }

  /** Clicks the CREATE YOUR FIRST LINK empty-state entry point. */
  async clickEmptyCreateLinkButton(): Promise<void> {
    const button = await this.getEmptyCreateLinkButtonEl();
    if (!button)
      throw new Error('Empty-state create link button was not rendered');
    await button.click();
  }

  /** Returns true when app-community-admin-settings is present. */
  async hasSettingsComponent(): Promise<boolean> {
    return (await this.getSettingsComponentEl()) !== null;
  }

  /** Returns true when the admin override banner is visible. */
  async hasOverrideBanner(): Promise<boolean> {
    return (await this.getOverrideBannerEl()) !== null;
  }

  /** Returns true when the community logo image is visible. */
  async hasCommunityLogo(): Promise<boolean> {
    return (await this.getCommunityLogoEl()) !== null;
  }

  /** Returns the community admin custom header text, or null if not present. */
  async getCustomHeaderText(): Promise<string | null> {
    const el = await this.getCustomHeaderEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Returns true when the community logo image lazy-loads. */
  async communityLogoLazyLoads(): Promise<boolean> {
    const logo = await this.getCommunityLogoEl();
    if (!logo) return false;
    return (await logo.getAttribute('loading')) === 'lazy';
  }

  private getMagicLinksInfoEl = this.locatorForOptional(
    '[data-testid="magic-links-info"]',
  );

  /** Returns true when the magic links info card is present. */
  async hasMagicLinksInfo(): Promise<boolean> {
    return (await this.getMagicLinksInfoEl()) !== null;
  }

  /** Returns the text content of the magic links info card, or null if not present. */
  async getMagicLinksInfoText(): Promise<string | null> {
    const el = await this.getMagicLinksInfoEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  private getMagicLinkDesktopLabelEl = this.locatorForOptional(
    '[data-testid="magic-link-label"]',
  );

  /** Returns the CSS class string of the first desktop label span, or null if not present. */
  async getMagicLinkDesktopLabelClass(): Promise<string | null> {
    const el = await this.getMagicLinkDesktopLabelEl();
    if (!el) return null;
    return el.getAttribute('class');
  }

  private getMagicLinkActionButtonsAll = this.locatorForAll(
    '[data-testid="magic-link-actions"] button',
  );
  private getMagicLinkTokenPrefixesAll = this.locatorForAll(
    '[data-testid="magic-link-token-prefix"]',
  );
  private getMagicLinkCopyUnavailableNotesAll = this.locatorForAll(
    '[data-testid="magic-link-copy-unavailable-note"]',
  );
  private getMagicLinkCopyStatusEl = this.locatorForOptional(
    '[data-testid="magic-link-copy-status"]',
  );
  private getMagicLinkMobileHeadingsAll = this.locatorForAll(
    'h2[data-testid="magic-link-label"], h2[data-testid="magic-link-mobile-heading"]',
  );
  private getActiveRowsAll = this.locatorForAll(
    '[data-testid="magic-link-active-row"]',
  );

  /** Returns aria-label values for all magic-link action buttons. */
  async getMagicLinkActionAriaLabels(): Promise<(string | null)[]> {
    const buttons = await this.getMagicLinkActionButtonsAll();
    return Promise.all(buttons.map((btn) => btn.getAttribute('aria-label')));
  }

  /** Clicks the first magic-link action button with the exact aria-label. */
  async clickMagicLinkAction(ariaLabel: string): Promise<void> {
    const buttons = await this.getMagicLinkActionButtonsAll();
    for (const button of buttons) {
      if ((await button.getAttribute('aria-label')) === ariaLabel) {
        await button.click();
        return;
      }
    }
    throw new Error(`Magic-link action not found: ${ariaLabel}`);
  }

  async getMagicLinkTokenPrefixes(): Promise<string[]> {
    const prefixes = await this.getMagicLinkTokenPrefixesAll();
    return Promise.all(
      prefixes.map(async (prefix) => (await prefix.text()).trim()),
    );
  }

  /** Returns visible mobile notes explaining why a stored magic link cannot be copied. */
  async getMagicLinkCopyUnavailableNotes(): Promise<string[]> {
    const notes = await this.getMagicLinkCopyUnavailableNotesAll();
    return Promise.all(notes.map(async (note) => (await note.text()).trim()));
  }

  /** Returns the visible magic-link copy status text, or null if absent. */
  async getMagicLinkCopyStatus(): Promise<string | null> {
    const el = await this.getMagicLinkCopyStatusEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Returns the tag names used by rendered mobile magic-link card headings. */
  async getMagicLinkMobileHeadingTags(): Promise<string[]> {
    const headings = await this.getMagicLinkMobileHeadingsAll();
    return Promise.all(
      headings.map((heading) => heading.getProperty<string>('tagName')),
    );
  }

  /** Returns the count of active-link desktop rows. */
  async getActiveMagicLinkCount(): Promise<number> {
    return (await this.getActiveRowsAll()).length;
  }

  /** Returns the text of each active-link desktop row. */
  async getActiveMagicLinkRowTexts(): Promise<string[]> {
    const rows = await this.getActiveRowsAll();
    return Promise.all(rows.map((row) => row.text()));
  }

  private getCreateDialogEl = this.locatorForOptional('[role="dialog"]');
  private getCreateDialogFocusTrapEl = this.locatorForOptional(
    '[role="dialog"] [cdkTrapFocus]',
  );
  private getCreateDialogBackdropEl = this.locatorForOptional(
    '[data-testid="create-link-backdrop"]',
  );

  /** Returns true when the create link dialog is open. */
  async hasCreateDialog(): Promise<boolean> {
    return (await this.getCreateDialogEl()) !== null;
  }

  /** Returns true when the dialog contains a focus trap element. */
  async hasDialogFocusTrap(): Promise<boolean> {
    return (await this.getCreateDialogFocusTrapEl()) !== null;
  }

  /** Sends Escape key to the dialog element. */
  async sendEscapeToDialog(): Promise<void> {
    const dialog = await this.getCreateDialogEl();
    if (dialog) {
      await dialog.sendKeys(TestKey.ESCAPE);
    }
  }

  /** Returns the aria-hidden attribute of the create-dialog backdrop, or null. */
  async getDialogBackdropAriaHidden(): Promise<string | null> {
    const backdrop = await this.getCreateDialogBackdropEl();
    return backdrop ? backdrop.getAttribute('aria-hidden') : null;
  }

  /** Returns the tabindex attribute of the create-dialog backdrop, or null when absent. */
  async getDialogBackdropTabIndex(): Promise<string | null> {
    const backdrop = await this.getCreateDialogBackdropEl();
    return backdrop ? backdrop.getAttribute('tabindex') : null;
  }

  /** Clicks the create-dialog backdrop (dismisses the dialog). */
  async clickDialogBackdrop(): Promise<void> {
    const backdrop = await this.getCreateDialogBackdropEl();
    await backdrop?.click();
  }

  private getAuditLogTableEl = this.locatorForOptional(AuditLogTableHarness);

  getAuditLogTable(): Promise<AuditLogTableHarness | null> {
    return this.getAuditLogTableEl();
  }

  async hasAuditLogTable(): Promise<boolean> {
    return (await this.getAuditLogTableEl()) !== null;
  }

  private getMaxUnlimitedAll = this.locatorForAll(
    '[data-testid="max-unlimited"]',
  );

  /** Returns true when at least one "Unlimited" cap indicator is visible in the links table. */
  async hasUnlimitedCapDisplay(): Promise<boolean> {
    return (await this.getMaxUnlimitedAll()).length > 0;
  }

  private getMaxRedemptionsHintEl = this.locatorForOptional(
    '[data-testid="max-redemptions-hint"]',
  );

  /** Returns true when the "Leave empty for unlimited" helper text is visible in the create dialog. */
  async hasMaxRedemptionsHint(): Promise<boolean> {
    return (await this.getMaxRedemptionsHintEl()) !== null;
  }

  private getFilterActiveEl = this.locatorForOptional(
    '[data-testid="magic-links-filter-active"]',
  );
  private getFilterPastEl = this.locatorForOptional(
    '[data-testid="magic-links-filter-past"]',
  );
  private getPastRowsAll = this.locatorForAll(
    '[data-testid="magic-link-past-row"]',
  );
  private getPastCardsAll = this.locatorForAll(
    '[data-testid="magic-link-past-card"]',
  );

  /** Clicks the Active or Past filter pill. */
  async setMagicLinksFilter(filter: 'active' | 'past'): Promise<void> {
    const el =
      filter === 'active'
        ? await this.getFilterActiveEl()
        : await this.getFilterPastEl();
    if (el) await el.click();
  }

  /** Returns the count of past-link rows visible in the desktop table, or 0 if not rendered. */
  async getPastMagicLinkCount(): Promise<number> {
    return (await this.getPastRowsAll()).length;
  }

  /** Returns the label text of each past link from the desktop table rows. */
  async getPastMagicLinkLabels(): Promise<string[]> {
    const rows = await this.getPastRowsAll();
    return Promise.all(
      rows.map(async (row) => {
        const cells = await row.text();
        return cells.trim().split('\n')[0]?.trim() ?? '';
      }),
    );
  }

  /** Returns the deleted-at cell text for a given past link row index (desktop table). */
  async getPastLinkDeletedAt(index: number): Promise<string | null> {
    const rows = await this.getPastRowsAll();
    const row = rows[index];
    if (!row) return null;
    // Past row has 7 columns: Label / Token / Redeemed / Created / Last Used / Expires / Deleted
    // Get all td text values and return the last one (Deleted)
    const fullText = await row.text();
    const parts = fullText
      .trim()
      .split(/\s{2,}|\n/)
      .filter((s) => s.trim().length > 0);
    return parts[parts.length - 1]?.trim() ?? null;
  }

  private getUnresolvedCommunityErrorEl = this.locatorForOptional(
    '[data-testid="unresolved-community-error"]',
  );
  private getUnresolvedCommunityPickButtonsAll = this.locatorForAll(
    '[data-testid="unresolved-community-pick"]',
  );

  /** Returns the text content of the unresolved community error card, or null if not visible. */
  async getUnresolvedCommunityError(): Promise<string | null> {
    const el = await this.getUnresolvedCommunityErrorEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Clicks the pick button at the given index. */
  async pickUnresolvedCommunity(index: number): Promise<void> {
    const buttons = await this.getUnresolvedCommunityPickButtonsAll();
    await buttons[index].click();
  }
}
