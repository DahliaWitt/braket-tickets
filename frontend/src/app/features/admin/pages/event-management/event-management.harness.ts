import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import {EventAnalyticsTabHarness} from '@/features/admin/components/event-analytics-tab/event-analytics-tab.component.harness';
import {TicketReminderTabHarness} from '@/features/admin/components/ticket-reminder-tab/ticket-reminder-tab.component.harness';
import {waitForHarnessCondition} from '@/testing/harness-wait';
import {EventManagementBuyersTabHarness} from './components/event-management-buyers-tab/event-management-buyers-tab.component.harness';
import {GuestListAssignmentsHarness} from './components/guest-list-assignments/guest-list-assignments.component.harness';
import type {TicketTier} from '@shared/domain/ticket-tier';

export class EventManagementHarness extends ComponentHarness {
  static hostSelector = 'app-event-management';

  // The inventory meter component emits data-testid="tickets-sold-main" for the
  // headline "{sold} / {total}" stat. Keep this locator in sync with the
  // `testid` input passed in event-management.html.
  private getTicketsSold = this.locatorForOptional(
    '[data-testid="tickets-sold-main"]',
  );
  private getInventoryStatus = this.locatorForOptional(
    '[data-testid="tickets-sold-status"]',
  );
  private getPurchaseCount = this.locatorForOptional(
    '[data-testid="purchase-count"]',
  );
  private readonly getRevenueTierRow = (tier: TicketTier) =>
    this.locatorForOptional(`[data-testid="revenue-tier-${tier}"]`);
  private readonly getReminderTabHarness = this.locatorFor(
    TicketReminderTabHarness,
  );
  private readonly getBuyersTabHarness = this.locatorFor(
    EventManagementBuyersTabHarness,
  );
  private readonly getAnalyticsTabHarnessLocator = this.locatorForOptional(
    EventAnalyticsTabHarness,
  );
  private readonly getManagementLoadErrorEl = this.locatorForOptional(
    '[data-testid="management-load-error"]',
  );
  private readonly getGuestListUnavailableEl = this.locatorForOptional(
    '[data-testid="guest-list-feature-unavailable"]',
  );
  private readonly getGuestListWorkspaceErrorEl = this.locatorForOptional(
    '[data-testid="guest-list-workspace-error"]',
  );
  private readonly getGuestListAssignmentsHarness = this.locatorForOptional(
    GuestListAssignmentsHarness,
  );
  private readonly getResaleLostProcessingFeesValue = this.locatorForOptional(
    '[data-testid="resale-lost-processing-fees-value"]',
  );

  /**
   * Analytics-tab delegate. Returns null when the analytics tab is not
   * rendered (the component uses `[hidden]` so it stays mounted, but the
   * harness existence gate covers defensive cases).
   */
  async getAnalyticsTabHarness(): Promise<EventAnalyticsTabHarness | null> {
    return this.getAnalyticsTabHarnessLocator();
  }

  /**
   * Error alert that renders when a management dataset load fails. Returns
   * the trimmed text of the alert, or null when the alert is not rendered.
   */
  async getManagementLoadErrorText(): Promise<string | null> {
    const el = await this.getManagementLoadErrorEl();
    return el ? (await el.text()).trim() : null;
  }

  async getGuestListUnavailableText(): Promise<string | null> {
    const el = await this.getGuestListUnavailableEl();
    return el ? (await el.text()).trim() : null;
  }

  async getGuestListWorkspaceErrorText(): Promise<string | null> {
    const el = await this.getGuestListWorkspaceErrorEl();
    return el ? (await el.text()).trim() : null;
  }

  /**
   * The assignment workspace's own harness. Null until the guests tab is open
   * and the rollout gate is enabled.
   */
  async getGuestListWorkspaceHarness(): Promise<GuestListAssignmentsHarness | null> {
    return this.getGuestListAssignmentsHarness();
  }

  async hasGuestListAssignmentsWorkspace(): Promise<boolean> {
    return (await this.getGuestListAssignmentsHarness()) !== null;
  }

  /**
   * Trimmed currency text of the "Lost processing fees" metric inside the
   * resale panel. Returns null when the resale panel is not rendered.
   */
  async getResaleLostProcessingFeesText(): Promise<string | null> {
    const el = await this.getResaleLostProcessingFeesValue();
    return el ? (await el.text()).trim() : null;
  }

  async getTicketsSoldText() {
    const el = await this.getTicketsSold();
    if (!el) return null;
    const textContent = await el.getProperty<unknown>('textContent');
    const raw = typeof textContent === 'string' ? textContent : '';
    // Collapse whitespace so "3 / 10" matches regardless of inline template breaks.
    return raw.replace(/\s+/g, ' ').trim();
  }

  /**
   * Below-meter status line — e.g. "7 remaining", "sold out", "sold out · 3 in checkout".
   * Returns null if the meter isn't rendered (e.g. data not loaded).
   */
  async getInventoryStatusText(): Promise<string | null> {
    const el = await this.getInventoryStatus();
    if (!el) return null;
    return (await el.text()).replace(/\s+/g, ' ').trim();
  }

  async getPurchaseCountText() {
    const el = await this.getPurchaseCount();
    if (!el) return null;
    const textContent = await el.getProperty<unknown>('textContent');
    return typeof textContent === 'string' ? textContent.trim() : '';
  }

  async getRevenueTierText(tier: TicketTier): Promise<string | null> {
    const row = await this.getRevenueTierRow(tier)();
    return row ? (await row.text()).trim() : null;
  }

  async clickPurchaseTicketsToggle(purchaseId: string): Promise<void> {
    const buyersTab = await this.getBuyersTabHarness();
    await buyersTab.clickPurchaseTicketsToggle(purchaseId);
  }

  async isPurchaseTicketsExpanded(purchaseId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.isPurchaseTicketsExpanded(purchaseId);
  }

  async clickTicketRefund(ticketId: string): Promise<void> {
    const buyersTab = await this.getBuyersTabHarness();
    await buyersTab.clickTicketRefund(ticketId);
  }

  async getTicketStatusText(ticketId: string): Promise<string | null> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.getTicketStatusText(ticketId);
  }

  async hasTicketRefundButton(ticketId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.hasTicketRefundButton(ticketId);
  }

  async isTicketRefundDisabled(ticketId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.isTicketRefundDisabled(ticketId);
  }

  async getReminderRecipientCountText(): Promise<string> {
    const reminderTab = await this.getReminderTabHarness();
    return reminderTab.getRecipientCountText();
  }

  async getReminderAudienceErrorText(): Promise<string | null> {
    const reminderTab = await this.getReminderTabHarness();
    return reminderTab.getAudienceErrorText();
  }

  async isReminderSendDisabled(): Promise<boolean> {
    const reminderTab = await this.getReminderTabHarness();
    return reminderTab.isSendDisabled();
  }

  async setReminderSubject(value: string): Promise<void> {
    const reminderTab = await this.getReminderTabHarness();
    await reminderTab.setSubject(value);
  }

  private getResaleToggle = this.locatorForOptional(
    '[data-testid="resale-toggle"]',
  );
  private getResaleFeeInput = this.locatorForOptional(
    '[data-testid="resale-fee-input"]',
  );
  private getResaleQueueCount = this.locatorForOptional(
    '[data-testid="resale-queue-count"]',
  );
  private getResaleCompletedCount = this.locatorForOptional(
    '[data-testid="resale-completed-count"]',
  );
  private getResaleNotificationSubs = this.locatorForOptional(
    '[data-testid="resale-notification-subs"]',
  );
  private getResaleListingRows = this.locatorForAll('[data-resale-listing-id]');
  private getResaleTabCount = this.locatorForOptional(
    '[data-testid="tab-resale-count"]',
  );
  private readonly getTabButton = (
    tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email',
  ) => this.locatorForOptional(`[data-testid="tab-${tab}"]`);

  private async awaitRendered(
    locator: () => Promise<TestElement | null>,
    description: string,
    timeoutMs = 10000,
  ): Promise<void> {
    await waitForHarnessCondition(async () => (await locator()) !== null, {
      description,
      timeoutMs,
    });
  }

  async clickTab(tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email') {
    await this.awaitRendered(this.getTabButton(tab), `${tab} tab button`);
    const button = await this.locatorFor(`[data-testid="tab-${tab}"]`)();
    const panel = this.locatorForOptional(`#panel-${tab}`);
    await button.click();
    await waitForHarnessCondition(
      async () =>
        (await button.getAttribute('aria-selected')) === 'true' &&
        (await panel()) !== null,
      {description: `${tab} tab selection`},
    );
  }

  async getActiveTabAttribute(
    tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email',
  ): Promise<string | null> {
    await this.awaitRendered(this.getTabButton(tab), `${tab} tab button`);
    const button = await this.locatorFor(`[data-testid="tab-${tab}"]`)();
    return button.getAttribute('aria-selected');
  }

  async getTabBadgeText(tab: 'buyers' | 'guests'): Promise<string> {
    const badge = await this.locatorFor(`[data-testid="tab-${tab}-count"]`)();
    return (await badge.text()).trim();
  }

  async getResaleTabBadgeText(): Promise<string | null> {
    const badge = await this.getResaleTabCount();
    if (!badge) return null;
    return (await badge.text()).trim();
  }

  async getTabAriaControls(
    tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email',
  ): Promise<string | null> {
    await this.awaitRendered(this.getTabButton(tab), `${tab} tab button`);
    const button = await this.locatorFor(`[data-testid="tab-${tab}"]`)();
    return button.getAttribute('aria-controls');
  }

  async getTabTabindex(
    tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email',
  ): Promise<string | null> {
    await this.awaitRendered(this.getTabButton(tab), `${tab} tab button`);
    const button = await this.locatorFor(`[data-testid="tab-${tab}"]`)();
    return button.getAttribute('tabindex');
  }

  async clickRefundPaymentAction(purchaseId: string): Promise<void> {
    const buyersTab = await this.getBuyersTabHarness();
    await buyersTab.clickRefundPaymentAction(purchaseId);
  }

  async clickForceRefundAllAction(purchaseId: string): Promise<void> {
    const buyersTab = await this.getBuyersTabHarness();
    await buyersTab.clickForceRefundAllAction(purchaseId);
  }

  async clickViewTicketAction(purchaseId: string): Promise<void> {
    const buyersTab = await this.getBuyersTabHarness();
    await buyersTab.clickViewTicketAction(purchaseId);
  }

  async isViewTicketActionDisabled(purchaseId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.isViewTicketActionDisabled(purchaseId);
  }

  async hasForceRefundAllAction(purchaseId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.hasForceRefundAllAction(purchaseId);
  }

  async isRefundPaymentActionDisabled(purchaseId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.isRefundPaymentActionDisabled(purchaseId);
  }

  async getRefundPaymentActionAriaLabel(
    purchaseId: string,
  ): Promise<string | null> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.getRefundPaymentActionAriaLabel(purchaseId);
  }

  async getForceRefundAllActionAriaLabel(
    purchaseId: string,
  ): Promise<string | null> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.getForceRefundAllActionAriaLabel(purchaseId);
  }

  async getTicketRefundAriaLabel(ticketId: string): Promise<string | null> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.getTicketRefundAriaLabel(ticketId);
  }

  async isForceRefundAllActionDisabled(purchaseId: string): Promise<boolean> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.isForceRefundAllActionDisabled(purchaseId);
  }

  async getPurchaseStatusText(purchaseId: string): Promise<string | null> {
    const buyersTab = await this.getBuyersTabHarness();
    return buyersTab.getPurchaseStatusText(purchaseId);
  }

  async getPanelAttributes(
    tab: 'analytics' | 'buyers' | 'guests' | 'resale' | 'email',
  ): Promise<{
    id: string | null;
    labelledby: string | null;
    tabindex: string | null;
    hidden: string | null;
  }> {
    const panel = await this.locatorFor(`#panel-${tab}`)();
    return {
      id: await panel.getAttribute('id'),
      labelledby: await panel.getAttribute('aria-labelledby'),
      tabindex: await panel.getAttribute('tabindex'),
      hidden: await panel.getAttribute('hidden'),
    };
  }

  async isResaleToggleChecked(): Promise<boolean> {
    const toggle = await this.getResaleToggle();
    if (!toggle) return false;
    return (await toggle.getAttribute('aria-checked')) === 'true';
  }

  async clickResaleToggle(): Promise<void> {
    const toggle = await this.getResaleToggle();
    if (!toggle) throw new Error('Resale toggle not found');
    await toggle.click();
  }

  async getResaleQueueCountText(): Promise<string | null> {
    const el = await this.getResaleQueueCount();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getResaleCompletedCountText(): Promise<string | null> {
    const el = await this.getResaleCompletedCount();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getResaleNotificationSubsText(): Promise<string | null> {
    const el = await this.getResaleNotificationSubs();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getResaleListingRowCount(): Promise<number> {
    const rows = await this.getResaleListingRows();
    const listingIds = new Set<string>();
    for (const row of rows) {
      const listingId = await row.getAttribute('data-resale-listing-id');
      if (listingId) listingIds.add(listingId);
    }
    return listingIds.size;
  }

  async sendTablistKey(key: string): Promise<void> {
    const tablist = await this.locatorFor('[role="tablist"]')();
    await tablist.sendKeys(key);
  }

  // ── Broadcast Email Harness Methods ──────────────────────────────
  private getBroadcastRecipientCount = this.locatorForOptional(
    '[data-testid="broadcast-recipient-count"]',
  );
  private getBroadcastSendButton = this.locatorFor(
    '[data-testid="send-broadcast"]',
  );
  private getBroadcastSubjectInput = this.locatorFor(
    '[data-testid="broadcast-subject"]',
  );
  private getBroadcastAudienceError = this.locatorForOptional(
    '[data-testid="broadcast-audience-error"]',
  );
  private getBroadcastExceedsCap = this.locatorForOptional(
    '[data-testid="broadcast-exceeds-cap"]',
  );
  private getBroadcastHistoryEntries = this.locatorForAll(
    '[data-testid="broadcast-history-entry"]',
  );
  private getBroadcastHistoryEmpty = this.locatorForOptional(
    '[data-testid="broadcast-history-empty"]',
  );
  private getMarketingAnnouncementCard = this.locatorForOptional(
    '[data-testid="marketing-announcement-card"]',
  );
  private getMarketingAnnouncementEmpty = this.locatorForOptional(
    '[data-testid="marketing-announcement-empty"]',
  );

  async isMarketingAnnouncementCardVisible(): Promise<boolean> {
    const el = await this.getMarketingAnnouncementCard();
    return el !== null;
  }

  async getMarketingAnnouncementEmptyText(): Promise<string | null> {
    const el = await this.getMarketingAnnouncementEmpty();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getBroadcastRecipientCountText(): Promise<string | null> {
    const el = await this.getBroadcastRecipientCount();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getBroadcastAudienceErrorText(): Promise<string | null> {
    const el = await this.getBroadcastAudienceError();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getBroadcastExceedsCapText(): Promise<string | null> {
    const el = await this.getBroadcastExceedsCap();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async isBroadcastSendDisabled(): Promise<boolean> {
    const button = await this.getBroadcastSendButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async setBroadcastSubject(value: string): Promise<void> {
    const input = await this.getBroadcastSubjectInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getBroadcastHistoryEntryCount(): Promise<number> {
    const rows = await this.getBroadcastHistoryEntries();
    return rows.length;
  }

  async isBroadcastHistoryEmpty(): Promise<boolean> {
    const el = await this.getBroadcastHistoryEmpty();
    return el !== null;
  }

  async clickBroadcastSend(): Promise<void> {
    const button = await this.getBroadcastSendButton();
    await button.click();
  }

  // ── Check-In Stats Harness Methods ───────────────────────────────
  private getCheckedInCount = this.locatorFor(
    '[data-testid="checked-in-count"]',
  );
  private getCheckInPercentage = this.locatorFor(
    '[data-testid="check-in-percentage"]',
  );
  private getCheckInNotScanned = this.locatorFor(
    '[data-testid="check-in-not-scanned"]',
  );
  private getCheckInChartCard = this.locatorForOptional(
    '[data-testid="check-in-chart-card"]',
  );

  async getCheckedInCountText(): Promise<string> {
    const el = await this.getCheckedInCount();
    return (await el.text()).trim();
  }

  async getCheckInPercentageText(): Promise<string> {
    const el = await this.getCheckInPercentage();
    return (await el.text()).trim();
  }

  async getCheckInNotScannedText(): Promise<string> {
    const el = await this.getCheckInNotScanned();
    return (await el.text()).trim();
  }

  async isCheckInChartCardPresent(): Promise<boolean> {
    const el = await this.getCheckInChartCard();
    return el !== null;
  }

  // ── Tier Pricing Stats Harness Methods ────────────────────────────
  private getTierPricingCards = this.locatorForAll(
    '[data-testid="tier-pricing-card"]',
  );
  private getTierPricingError = this.locatorForOptional(
    '[data-testid="tier-pricing-stats-error"]',
  );

  async getTierPricingCardCount(): Promise<number> {
    const cards = await this.getTierPricingCards();
    return cards.length;
  }

  async getTierPricingErrorText(): Promise<string | null> {
    const el = await this.getTierPricingError();
    if (!el) return null;
    return (await el.text()).replace(/\s+/g, ' ').trim();
  }

  async getTierStatTexts(testId: string): Promise<string[]> {
    const elements = await this.locatorForAll(`[data-testid="${testId}"]`)();
    const texts: string[] = [];
    for (const el of elements) {
      texts.push((await el.text()).trim());
    }
    return texts;
  }
}
