import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import {SalesChartComponentHarness} from '@/features/admin/pages/event-management/components/sales-chart/sales-chart.component.harness';
import {CheckInChartComponentHarness} from '@/features/admin/pages/event-management/components/check-in-chart/check-in-chart.component.harness';

/**
 * CDK test harness for `app-event-analytics-tab`.
 *
 * All component state worth asserting is exposed through explicit methods so
 * specs never reach in with raw selectors or `fixture.nativeElement`. When a
 * new `data-testid` is added to the template, add a matching method here.
 */
export class EventAnalyticsTabHarness extends ComponentHarness {
  static hostSelector = 'app-event-analytics-tab';

  // ── Revenue section ─────────────────────────────────────────────────
  private getRevenueRefundsEl = this.locatorForOptional(
    '[data-testid="revenue-refunds"]',
  );
  private getRevenueTierRegularEl = this.locatorForOptional(
    '[data-testid="revenue-tier-regular"]',
  );
  private getRevenueTierNotaflofEl = this.locatorForOptional(
    '[data-testid="revenue-tier-notaflof"]',
  );
  private getRevenueTierSupporterEl = this.locatorForOptional(
    '[data-testid="revenue-tier-supporter"]',
  );
  private getPauseSalesButtonEl = this.locatorForOptional(
    '[data-testid="pause-sales-button"]',
  );
  private getEndSalesButtonEl = this.locatorForOptional(
    '[data-testid="end-sales-button"]',
  );
  private getTicketSalesUnavailableMessageEl = this.locatorForOptional(
    '[data-testid="ticket-sales-unavailable-message"]',
  );
  async isRevenueRefundsVisible(): Promise<boolean> {
    return (await this.getRevenueRefundsEl()) !== null;
  }

  async getRevenueRefundsText(): Promise<string | null> {
    const el = await this.getRevenueRefundsEl();
    return el ? (await el.text()).trim() : null;
  }

  async getRevenueTierTexts(): Promise<{
    regular: string | null;
    notaflof: string | null;
    supporter: string | null;
  }> {
    const [regular, notaflof, supporter] = await Promise.all([
      this.readTrimmed(this.getRevenueTierRegularEl),
      this.readTrimmed(this.getRevenueTierNotaflofEl),
      this.readTrimmed(this.getRevenueTierSupporterEl),
    ]);
    return {regular, notaflof, supporter};
  }

  async clickSettlementReport(): Promise<void> {
    const settlementButton = await this.getSettlementReportButton();
    await settlementButton.click();
  }

  async isSettlementReportDisabled(): Promise<boolean> {
    const settlementButton = await this.getSettlementReportButton();
    return (await settlementButton.getAttribute('disabled')) !== null;
  }

  private async getSettlementReportButton(): Promise<TestElement> {
    const buttons = await this.locatorForAll('button')();
    const settlementButton = await this.findButtonByText(
      buttons,
      'Settlement Report',
    );
    if (!settlementButton) {
      throw new Error('Settlement Report button not found');
    }
    return settlementButton;
  }

  // ── Ticket sales controls ──────────────────────────────────────────
  async hasPauseSalesButton(): Promise<boolean> {
    return (await this.getPauseSalesButtonEl()) !== null;
  }

  async hasEndSalesButton(): Promise<boolean> {
    return (await this.getEndSalesButtonEl()) !== null;
  }

  async getTicketSalesUnavailableMessageText(): Promise<string | null> {
    return this.readTrimmed(this.getTicketSalesUnavailableMessageEl);
  }

  // ── Tier pricing cards ──────────────────────────────────────────────
  private getTierPricingCardEls = this.locatorForAll(
    '[data-testid="tier-pricing-card"]',
  );
  private getTierPricingErrorEl = this.locatorForOptional(
    '[data-testid="tier-pricing-stats-error"]',
  );
  private getTierStatMinEls = this.locatorForAll(
    '[data-testid="tier-stat-min"]',
  );
  private getTierStatMaxEls = this.locatorForAll(
    '[data-testid="tier-stat-max"]',
  );
  private getTierStatMeanEls = this.locatorForAll(
    '[data-testid="tier-stat-mean"]',
  );
  private getTierStatMedianEls = this.locatorForAll(
    '[data-testid="tier-stat-median"]',
  );
  private getTierStatModeEls = this.locatorForAll(
    '[data-testid="tier-stat-mode"]',
  );

  async getTierPricingCardCount(): Promise<number> {
    return (await this.getTierPricingCardEls()).length;
  }

  async getTierPricingErrorText(): Promise<string | null> {
    const el = await this.getTierPricingErrorEl();
    return el ? (await el.text()).trim() : null;
  }

  async getTierStatTexts(): Promise<{
    min: string[];
    max: string[];
    mean: string[];
    median: string[];
    mode: string[];
  }> {
    const [min, max, mean, median, mode] = await Promise.all([
      this.collectText(this.getTierStatMinEls),
      this.collectText(this.getTierStatMaxEls),
      this.collectText(this.getTierStatMeanEls),
      this.collectText(this.getTierStatMedianEls),
      this.collectText(this.getTierStatModeEls),
    ]);
    return {min, max, mean, median, mode};
  }

  // ── Deferred charts ─────────────────────────────────────────────────
  private getSalesChartHarness = this.locatorForOptional(
    SalesChartComponentHarness,
  );
  private getCheckInChartHarness = this.locatorForOptional(
    CheckInChartComponentHarness,
  );

  /** null until the sales-chart defer block resolves. */
  async getSalesChart(): Promise<SalesChartComponentHarness | null> {
    return this.getSalesChartHarness();
  }

  /** null until the check-in-chart defer block resolves. */
  async getCheckInChart(): Promise<CheckInChartComponentHarness | null> {
    return this.getCheckInChartHarness();
  }

  private getSalesEmptyStateEl = this.locatorForOptional(
    '[data-testid="sales-empty-state"]',
  );

  async getSalesEmptyStateText(): Promise<string | null> {
    return this.readTrimmed(this.getSalesEmptyStateEl);
  }

  // ── Check-in analytics ──────────────────────────────────────────────
  private getCheckInChartCardEl = this.locatorForOptional(
    '[data-testid="check-in-chart-card"]',
  );
  private getCheckInAnalyticsSectionEl = this.locatorForOptional(
    '[data-testid="checkin-analytics-section"]',
  );
  private getCheckInPreEventStateEl = this.locatorForOptional(
    '[data-testid="checkin-pre-event-state"]',
  );
  private getFeedSectionEl = this.locatorForOptional(
    '[data-testid="feed-section"]',
  );
  private getRosterSectionEl = this.locatorForOptional(
    '[data-testid="roster-section"]',
  );

  async isCheckInChartCardPresent(): Promise<boolean> {
    return (await this.getCheckInChartCardEl()) !== null;
  }

  async isCheckInAnalyticsSectionPresent(): Promise<boolean> {
    return (await this.getCheckInAnalyticsSectionEl()) !== null;
  }

  async isCheckInPreEventStatePresent(): Promise<boolean> {
    return (await this.getCheckInPreEventStateEl()) !== null;
  }

  async isFeedSectionPresent(): Promise<boolean> {
    return (await this.getFeedSectionEl()) !== null;
  }

  async isRosterSectionPresent(): Promise<boolean> {
    return (await this.getRosterSectionEl()) !== null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  private async readTrimmed(
    locator: () => Promise<TestElement | null>,
  ): Promise<string | null> {
    const el = await locator();
    return el ? (await el.text()).trim() : null;
  }

  private async collectText(
    locator: () => Promise<TestElement[]>,
  ): Promise<string[]> {
    const els = await locator();
    return Promise.all(els.map(async (el) => (await el.text()).trim()));
  }

  private async findButtonByText(
    buttons: TestElement[],
    text: string,
  ): Promise<TestElement | null> {
    for (const button of buttons) {
      if ((await button.text()).includes(text)) {
        return button;
      }
    }
    return null;
  }
}
