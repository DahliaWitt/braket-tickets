import {ComponentHarness, TestKey} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

/** Sub-harness for individual ticket cards */
class TicketCardHarness extends ComponentHarness {
  static hostSelector = 'z-card';

  async getStatusBadgeText(): Promise<string | null> {
    const badge = await this.locatorForOptional(
      '[data-testid="ticket-status-badge"]',
    )();
    if (!badge) return null;
    return (await badge.text()).trim();
  }

  async getTierText(): Promise<string | null> {
    const tierEl = await this.locatorForOptional(
      '[data-testid="ticket-tier"]',
    )();
    if (!tierEl) return null;
    return (await tierEl.text()).trim();
  }

  async hasListForResaleButton(): Promise<boolean> {
    const button = await this.locatorForOptional(
      'button[aria-label="List this ticket for resale"]',
    )();
    return button !== null;
  }

  async clickListForResale(): Promise<void> {
    const button = await this.locatorFor(
      'button[aria-label="List this ticket for resale"]',
    )();
    await button.click();
  }

  async isListForResaleDisabled(): Promise<boolean> {
    const button = await this.locatorFor(
      'button[aria-label="List this ticket for resale"]',
    )();
    return (await button.getAttribute('disabled')) !== null;
  }

  async hasResaleConfirmationPanel(): Promise<boolean> {
    const panel = await this.locatorForOptional(
      '[data-testid="resale-confirmation-panel"]',
    )();
    return panel !== null;
  }

  async getResaleSellerDisclosureText(): Promise<string | null> {
    const panel = await this.locatorForOptional(
      '[data-testid="resale-seller-disclosure"]',
    )();
    return panel ? (await panel.text()).trim() : null;
  }

  async getResaleSellerDisclosureUnavailableText(): Promise<string | null> {
    const panel = await this.locatorForOptional(
      '[data-testid="resale-seller-disclosure-unavailable"]',
    )();
    return panel ? (await panel.text()).trim() : null;
  }

  async getResaleSellerDisclosureNoteText(): Promise<string | null> {
    const note = await this.locatorForOptional(
      '[data-testid="resale-seller-disclosure-note"]',
    )();
    return note ? (await note.text()).trim() : null;
  }

  async isConfirmResaleListingDisabled(): Promise<boolean> {
    const button = await this.locatorFor(
      '[data-testid="ticket-confirm-resale"]',
    )();
    return (await button.getAttribute('disabled')) !== null;
  }

  async isConfirmResaleListingFocused(): Promise<boolean> {
    const button = await this.locatorFor(
      '[data-testid="ticket-confirm-resale"]',
    )();
    return button.isFocused();
  }

  async waitForConfirmResaleListingFocus(): Promise<void> {
    await waitForHarnessCondition(
      async () => this.isConfirmResaleListingFocused(),
      {
        description: 'confirm resale listing focus',
      },
    );
  }

  async clickConfirmResaleListing(): Promise<void> {
    const button = await this.locatorFor(
      '[data-testid="ticket-confirm-resale"]',
    )();
    await button.click();
  }

  async clickCancelResaleFlow(): Promise<void> {
    const button = await this.locatorFor(
      '[data-testid="ticket-cancel-resale-flow"]',
    )();
    await button.click();
  }

  async hasCancelListingButton(): Promise<boolean> {
    const button = await this.locatorForOptional(
      'button[aria-label="Cancel resale listing"]',
    )();
    return button !== null;
  }

  async clickCancelListing(): Promise<void> {
    const button = await this.locatorFor(
      'button[aria-label="Cancel resale listing"]',
    )();
    await button.click();
  }

  async hasQueuedBanner(): Promise<boolean> {
    const banner = await this.locatorForOptional(
      '[data-testid="queued-banner"]',
    )();
    return banner !== null;
  }

  async hasAvailableBanner(): Promise<boolean> {
    const banner = await this.locatorForOptional(
      '[data-testid="available-banner"]',
    )();
    return banner !== null;
  }

  async hasPendingBanner(): Promise<boolean> {
    const banner = await this.locatorForOptional('.border-accent/20')();
    return banner !== null;
  }

  async getEventTitle(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="ticket-event-title"]',
    )();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Returns true if the QR code image is present and has a loaded src (data URL). */
  async hasQrRendered(): Promise<boolean> {
    const img = await this.locatorForOptional('app-qr img')();
    if (!img) return false;
    const src = await img.getAttribute('src');
    return src !== null && src.length > 0;
  }

  async hasDownloadPdfButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="ticket-download-pdf"]',
    )();
    return btn !== null;
  }

  async clickDownloadPdf(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="ticket-download-pdf"]')();
    await btn.click();
  }

  async hasTransferButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="ticket-transfer-open"]',
    )();
    return btn !== null;
  }

  async clickTransferButton(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="ticket-transfer-open"]')();
    await btn.click();
  }

  async hasTransferPanel(): Promise<boolean> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-panel"]',
    )();
    return panel !== null;
  }

  async enterTransferEmail(email: string): Promise<void> {
    const input = await this.locatorFor(
      '[data-testid="transfer-email-input"]',
    )();
    await input.clear();
    await input.sendKeys(email);
  }

  async pressEnterInTransferEmail(): Promise<void> {
    const input = await this.locatorFor(
      '[data-testid="transfer-email-input"]',
    )();
    await input.sendKeys(TestKey.ENTER);
  }

  async clickValidateTransferRecipient(): Promise<void> {
    const btn = await this.locatorFor(
      '[data-testid="transfer-validate-button"]',
    )();
    await btn.click();
  }

  async hasValidateTransferRecipientButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="transfer-validate-button"]',
    )();
    return btn !== null;
  }

  async getTransferErrorText(): Promise<string | null> {
    const error = await this.locatorForOptional(
      '[data-testid="transfer-error"]',
    )();
    return error ? (await error.text()).trim() : null;
  }

  async hasTransferConfirmationPanel(): Promise<boolean> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-confirmation-panel"]',
    )();
    return panel !== null;
  }

  async getTransferConfirmationText(): Promise<string | null> {
    const panel = await this.locatorForOptional(
      '[data-testid="transfer-confirmation-panel"]',
    )();
    return panel ? (await panel.text()).trim() : null;
  }

  async clickConfirmTransfer(): Promise<void> {
    const btn = await this.locatorFor(
      '[data-testid="transfer-confirm-button"]',
    )();
    await btn.click();
  }

  async clickCancelTransferFlow(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="transfer-cancel-flow"]')();
    await btn.click();
  }

  async hasCancelTransferFlowButton(): Promise<boolean> {
    const btn = await this.locatorForOptional(
      '[data-testid="transfer-cancel-flow"]',
    )();
    return btn !== null;
  }
}

export class ZardTicketsHarness extends ComponentHarness {
  static hostSelector = 'app-tickets';

  private _ticketCards = this.locatorForAll(TicketCardHarness);
  private _emptyState = this.locatorForOptional('app-empty-state');
  private _errorState = this.locatorForOptional(
    '[data-testid="tickets-error-state"]',
  );
  private _header = this.locatorForOptional('h1');
  private _footer = this.locatorForOptional('app-footer');

  async getTicketCount(): Promise<number> {
    return (await this._ticketCards()).length;
  }

  async hasEmptyState(): Promise<boolean> {
    const empty = await this._emptyState();
    return empty !== null;
  }

  async hasErrorState(): Promise<boolean> {
    const error = await this._errorState();
    return error !== null;
  }

  async hasHeader(): Promise<boolean> {
    return (await this._header()) !== null;
  }

  async hasFooter(): Promise<boolean> {
    return (await this._footer()) !== null;
  }

  async getTicketCard(index: number): Promise<TicketCardHarness> {
    const cards = await this._ticketCards();
    if (index >= cards.length)
      throw new Error(
        `Ticket index ${index} out of range (${cards.length} cards)`,
      );
    return cards[index];
  }

  async getTicketCards(): Promise<TicketCardHarness[]> {
    return this._ticketCards();
  }

  /** Find a ticket card whose event title contains the given string (case-insensitive). */
  async getTicketCardByEventTitle(
    title: string,
  ): Promise<TicketCardHarness | null> {
    const cards = await this._ticketCards();
    for (const card of cards) {
      const cardTitle = await card.getEventTitle();
      if (
        cardTitle !== null &&
        cardTitle.toLowerCase().includes(title.toLowerCase())
      ) {
        return card;
      }
    }
    return null;
  }
}
