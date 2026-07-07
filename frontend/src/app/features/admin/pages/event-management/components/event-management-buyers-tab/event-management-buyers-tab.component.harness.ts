import {ComponentHarness} from '@angular/cdk/testing';
// Import the harness directly (not via the feature barrel): the barrel also
// re-exports ImportSurfaceComponent, which pulls @angular/common injectables
// into the Playwright/Node module graph and triggers JIT compilation that the
// E2E runtime cannot satisfy. Harness-only imports keep the graph component-free.
import {ImportSurfaceComponentHarness} from '@/features/admin/import/import-surface.component.harness';

export class EventManagementBuyersTabHarness extends ComponentHarness {
  static hostSelector = 'app-event-management-buyers-tab';

  private readonly getImportButton = this.locatorFor(
    '[data-testid="import-tickets-button"]',
  );
  private readonly getImportPanel = this.locatorForOptional(
    '[data-testid="ticket-import-panel"]',
  );
  private readonly getImportClose = this.locatorForOptional(
    '[data-testid="ticket-import-close"]',
  );
  private readonly getImportSurface = this.locatorForOptional(
    ImportSurfaceComponentHarness,
  );

  async clickImportButton(): Promise<void> {
    await (await this.getImportButton()).click();
  }

  async isImportPanelOpen(): Promise<boolean> {
    return (await this.getImportPanel()) !== null;
  }

  async clickImportClose(): Promise<void> {
    const button = await this.getImportClose();
    if (button) await button.click();
  }

  /** The lazily-rendered import surface harness (null until the panel opens). */
  async getImportSurfaceHarness(): Promise<ImportSurfaceComponentHarness | null> {
    return this.getImportSurface();
  }

  async clickPurchaseTicketsToggle(purchaseId: string): Promise<void> {
    const toggle = await this.locatorFor(
      `[data-testid="toggle-purchase-tickets-${purchaseId}"]`,
    )();
    await toggle.click();
  }

  async isPurchaseTicketsExpanded(purchaseId: string): Promise<boolean> {
    const expandedRow = await this.locatorForOptional(
      `[data-testid="purchase-tickets-row-${purchaseId}"]`,
    )();
    return expandedRow !== null;
  }

  async clickTicketRefund(ticketId: string): Promise<void> {
    const button = await this.locatorFor(
      `[data-testid="refund-ticket-${ticketId}"]`,
    )();
    await button.click();
  }

  async getTicketStatusText(ticketId: string): Promise<string | null> {
    const status = await this.locatorForOptional(
      `[data-testid="ticket-status-${ticketId}"]`,
    )();
    if (!status) return null;
    return (await status.text()).trim();
  }

  async hasTicketRefundButton(ticketId: string): Promise<boolean> {
    const button = await this.locatorForOptional(
      `[data-testid="refund-ticket-${ticketId}"]`,
    )();
    return button !== null;
  }

  async isTicketRefundDisabled(ticketId: string): Promise<boolean> {
    const button = await this.locatorFor(
      `[data-testid="refund-ticket-${ticketId}"]`,
    )();
    return (await button.getAttribute('disabled')) !== null;
  }

  async clickViewTicketAction(purchaseId: string): Promise<void> {
    const buttons = await this.locatorForAll(
      `[data-testid="view-ticket-action"][data-purchase-id="${purchaseId}"]`,
    )();
    if (buttons.length === 0) {
      throw new Error(
        `Purchase action not found: view-ticket-action for ${purchaseId}`,
      );
    }
    await buttons[0].click();
  }

  async isViewTicketActionDisabled(purchaseId: string): Promise<boolean> {
    const buttons = await this.locatorForAll(
      `[data-testid="view-ticket-action"][data-purchase-id="${purchaseId}"]`,
    )();
    if (buttons.length === 0) {
      throw new Error(
        `Purchase action not found: view-ticket-action for ${purchaseId}`,
      );
    }
    return (await buttons[0].getAttribute('disabled')) !== null;
  }

  private async clickPurchaseAction(
    testId: 'refund-payment-action' | 'force-refund-all-action',
    purchaseId: string,
  ): Promise<void> {
    const buttons = await this.locatorForAll(
      `[data-testid="${testId}"][data-purchase-id="${purchaseId}"]`,
    )();
    if (buttons.length === 0) {
      throw new Error(`Purchase action not found: ${testId} for ${purchaseId}`);
    }
    await buttons[0].click();
  }

  async clickRefundPaymentAction(purchaseId: string): Promise<void> {
    await this.clickPurchaseAction('refund-payment-action', purchaseId);
  }

  async clickForceRefundAllAction(purchaseId: string): Promise<void> {
    await this.clickPurchaseAction('force-refund-all-action', purchaseId);
  }

  async hasForceRefundAllAction(purchaseId: string): Promise<boolean> {
    const buttons = await this.locatorForAll(
      `[data-testid="force-refund-all-action"][data-purchase-id="${purchaseId}"]`,
    )();
    return buttons.length > 0;
  }

  async isRefundPaymentActionDisabled(purchaseId: string): Promise<boolean> {
    const button = await this.locatorFor(
      `[data-testid="refund-payment-action"][data-purchase-id="${purchaseId}"]`,
    )();
    return (await button.getAttribute('disabled')) !== null;
  }

  async getRefundPaymentActionAriaLabel(
    purchaseId: string,
  ): Promise<string | null> {
    const button = await this.locatorFor(
      `[data-testid="refund-payment-action"][data-purchase-id="${purchaseId}"]`,
    )();
    return button.getAttribute('aria-label');
  }

  async getForceRefundAllActionAriaLabel(
    purchaseId: string,
  ): Promise<string | null> {
    const button = await this.locatorFor(
      `[data-testid="force-refund-all-action"][data-purchase-id="${purchaseId}"]`,
    )();
    return button.getAttribute('aria-label');
  }

  async getTicketRefundAriaLabel(ticketId: string): Promise<string | null> {
    const button = await this.locatorFor(
      `[data-testid="refund-ticket-${ticketId}"]`,
    )();
    return button.getAttribute('aria-label');
  }

  async isForceRefundAllActionDisabled(purchaseId: string): Promise<boolean> {
    const button = await this.locatorFor(
      `[data-testid="force-refund-all-action"][data-purchase-id="${purchaseId}"]`,
    )();
    const disabled = await button.getAttribute('disabled');
    const ariaDisabled = await button.getAttribute('aria-disabled');
    return disabled !== null || ariaDisabled === 'true';
  }

  async getPurchaseStatusText(purchaseId: string): Promise<string | null> {
    const els = await this.locatorForAll(
      `[data-testid="purchase-status"][data-purchase-id="${purchaseId}"]`,
    )();
    if (els.length === 0) return null;
    return (await els[0].text()).trim();
  }
}
