import {
  ComponentHarness,
  HarnessPredicate,
  TestKey,
} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class CheckoutSidebarHarness extends ComponentHarness {
  static hostSelector = 'app-checkout-sidebar';

  static with(
    options: {selector?: string} = {},
  ): HarnessPredicate<CheckoutSidebarHarness> {
    return new HarnessPredicate(CheckoutSidebarHarness, options);
  }

  // --- Locators ---
  private _heading = this.locatorForOptional('#sidebar-checkout-heading');
  private _closeButton = this.locatorFor('[data-testid="checkout-close"]');
  private _decreaseQty = this.locatorForOptional(
    '[data-testid="checkout-decrease-qty"]',
  );
  private _quantity = this.locatorForOptional(
    '[data-testid="checkout-quantity"]',
  );
  private _increaseQty = this.locatorForOptional(
    '[data-testid="checkout-increase-qty"]',
  );
  private _tierRegular = this.locatorForOptional(
    '[data-testid="checkout-tier-regular"]',
  );
  private _tierSupporter = this.locatorForOptional(
    '[data-testid="checkout-tier-supporter"]',
  );
  private _tierNotaflof = this.locatorForOptional(
    '[data-testid="checkout-tier-notaflof"]',
  );
  private _total = this.locatorForOptional('[data-testid="checkout-total"]');
  private _vettingRequired = this.locatorForOptional(
    '[data-testid="checkout-vetting-required"]',
  );
  private _applyForVetting = this.locatorForOptional(
    '[data-testid="checkout-apply-for-vetting"]',
  );
  private _guestSidebarSignIn = this.locatorForOptional(
    '[data-testid="guest-sidebar-sign-in"]',
  );
  private _guestEmailInput = this.locatorForOptional('#guest-sidebar-email');
  private _guestSidebarContinue = this.locatorForOptional(
    '[data-testid="guest-sidebar-continue"]',
  );
  private _checkoutVettingSignIn = this.locatorForOptional(
    '[data-testid="checkout-vetting-sign-in"]',
  );
  private _paymentIncomplete = this.locatorForOptional(
    '[data-testid="payment-setup-incomplete"]',
  );
  private _stripePayment = this.locatorForOptional('app-stripe-payment');
  private _stripePayButton = this.locatorForOptional(
    '[data-testid="stripe-pay-button"]',
  );
  private _freeTicket = this.locatorForOptional(
    '[data-testid="checkout-free-ticket"]',
  );
  private _amountInvalid = this.locatorForOptional(
    '[data-testid="checkout-amount-invalid"]',
  );
  private _amountInvalidCta = this.locatorForOptional(
    '[data-testid="checkout-amount-invalid-cta"]',
  );
  private _amountInvalidMessage = this.locatorForOptional(
    '[data-testid="checkout-amount-invalid-message"]',
  );
  private _termsCheckbox = this.locatorForOptional(
    '[data-testid="checkout-terms-checkbox"]',
  );
  private _termsLink = this.locatorForOptional(
    '[data-testid="checkout-terms-link"]',
  );
  private _privacyLink = this.locatorForOptional(
    '[data-testid="checkout-privacy-link"]',
  );
  private _viewTickets = this.locatorForOptional(
    '[data-testid="checkout-view-tickets"]',
  );
  private _retry = this.locatorForOptional('[data-testid="checkout-retry"]');

  // --- Heading / Close ---
  async getHeadingText(): Promise<string | null> {
    const el = await this._heading();
    if (!el) return null;
    const textContent = await el.getProperty<unknown>('textContent');
    return typeof textContent === 'string' ? textContent.trim() : '';
  }

  async getHostText(): Promise<string> {
    return (await this.host()).text();
  }

  async close(): Promise<void> {
    const btn = await this._closeButton();
    await btn.click();
  }

  async isCloseButtonFocused(): Promise<boolean> {
    const btn = await this._closeButton();
    return btn.isFocused();
  }

  private _focusedInteractive = this.locatorForOptional(
    'button:focus, input:focus, a:focus, [tabindex]:focus',
  );

  async isFocusWithinDialog(): Promise<boolean> {
    const focused = await this._focusedInteractive();
    return focused !== null;
  }

  async waitForFocusWithinDialog(timeoutMs = 5000): Promise<void> {
    await waitForHarnessCondition(async () => this.isFocusWithinDialog(), {
      description: 'focus inside checkout dialog',
      timeoutMs,
    });
  }

  async waitForCloseButtonFocus(timeoutMs = 5000): Promise<void> {
    await waitForHarnessCondition(async () => this.isCloseButtonFocused(), {
      description: 'checkout close button focus',
      timeoutMs,
    });
  }

  async pressEscape(): Promise<void> {
    // Send Escape via the close button (inside the focus-trapped dialog) so the
    // keydown event bubbles up to the dialog container and triggers its handler.
    const btn = await this._closeButton();
    await btn.sendKeys(TestKey.ESCAPE);
  }

  // --- Quantity ---
  async getQuantity(): Promise<string | null> {
    const el = await this._quantity();
    return el ? (await el.text()).trim() : null;
  }

  async decreaseQuantity(): Promise<void> {
    const btn = await this._decreaseQty();
    if (!btn) throw new Error('Decrease quantity button not found');
    await btn.click();
  }

  async increaseQuantity(): Promise<void> {
    const btn = await this._increaseQty();
    if (!btn) throw new Error('Increase quantity button not found');
    await btn.click();
  }

  async isDecreaseDisabled(): Promise<boolean> {
    const btn = await this._decreaseQty();
    return btn ? ((await btn.getProperty<boolean>('disabled')) ?? false) : true;
  }

  async isIncreaseDisabled(): Promise<boolean> {
    const btn = await this._increaseQty();
    return btn ? ((await btn.getProperty<boolean>('disabled')) ?? false) : true;
  }

  // --- Supporter tier price label ---
  private _supporterMinLabel = this.locatorForOptional(
    '[data-testid="supporter-min-label"]',
  );
  private _supporterMinPrice = this.locatorForOptional(
    '[data-testid="supporter-min-price"]',
  );

  async getSupporterMinLabelText(): Promise<string | null> {
    const el = await this._supporterMinLabel();
    return el ? (await el.text()).trim() : null;
  }

  async getSupporterMinPriceText(): Promise<string | null> {
    const el = await this._supporterMinPrice();
    return el ? (await el.text()).trim() : null;
  }

  // --- Tier Selection ---
  async selectTier(tier: 'regular' | 'supporter' | 'notaflof'): Promise<void> {
    const locators = {
      regular: this._tierRegular,
      supporter: this._tierSupporter,
      notaflof: this._tierNotaflof,
    };
    const btn = await locators[tier]();
    if (!btn) throw new Error(`Tier button "${tier}" not found`);
    await btn.click();
  }

  async isTierSelected(
    tier: 'regular' | 'supporter' | 'notaflof',
  ): Promise<boolean> {
    const locators = {
      regular: this._tierRegular,
      supporter: this._tierSupporter,
      notaflof: this._tierNotaflof,
    };
    const btn = await locators[tier]();
    if (!btn) return false;
    return (await btn.getAttribute('aria-pressed')) === 'true';
  }

  async isTierVisible(
    tier: 'regular' | 'supporter' | 'notaflof',
  ): Promise<boolean> {
    const locators = {
      regular: this._tierRegular,
      supporter: this._tierSupporter,
      notaflof: this._tierNotaflof,
    };
    const el = await locators[tier]();
    return el !== null;
  }

  // --- Total ---
  async getTotalText(): Promise<string | null> {
    const el = await this._total();
    return el ? (await el.text()).trim() : null;
  }

  // --- Payment States ---
  async isVettingRequiredVisible(): Promise<boolean> {
    const el = await this._vettingRequired();
    return el !== null;
  }

  async getVettingRequiredText(): Promise<string | null> {
    const el = await this._vettingRequired();
    return el ? (await el.text()).trim() : null;
  }

  async hasApplyForVettingLink(): Promise<boolean> {
    const link = await this._applyForVetting();
    return link !== null;
  }

  async getGuestSidebarSignInHref(): Promise<string | null> {
    const link = await this._guestSidebarSignIn();
    return link ? link.getAttribute('href') : null;
  }

  async clickGuestSidebarSignIn(): Promise<void> {
    const link = await this._guestSidebarSignIn();
    if (!link) throw new Error('Guest sidebar sign-in link not found');
    await link.click();
  }

  async setGuestEmail(value: string): Promise<void> {
    const input = await this._guestEmailInput();
    if (!input) throw new Error('Guest email input not found');
    await input.clear();
    await input.sendKeys(value);
    await input.dispatchEvent('input');
    await input.blur();
  }

  async submitGuestEmail(): Promise<void> {
    const button = await this._guestSidebarContinue();
    if (!button) throw new Error('Guest sidebar continue button not found');
    await button.click();
  }

  async getCheckoutVettingSignInHref(): Promise<string | null> {
    const link = await this._checkoutVettingSignIn();
    return link ? link.getAttribute('href') : null;
  }

  async isPaymentSetupIncomplete(): Promise<boolean> {
    const el = await this._paymentIncomplete();
    return el !== null;
  }

  async isStripePaymentVisible(): Promise<boolean> {
    const el = await this._stripePayment();
    return el !== null;
  }

  async isStripePayButtonVisible(): Promise<boolean> {
    const el = await this._stripePayButton();
    return el !== null;
  }

  async isFreeTicketVisible(): Promise<boolean> {
    const el = await this._freeTicket();
    return el !== null;
  }

  // --- Invalid custom amount CTA (below-min / above-max) ---
  async isAmountInvalidVisible(): Promise<boolean> {
    const el = await this._amountInvalid();
    return el !== null;
  }

  async isAmountInvalidCtaDisabled(): Promise<boolean> {
    const btn = await this._amountInvalidCta();
    if (!btn) return false;
    // ZardButton reflects zDisabled via the data-disabled host attribute
    // (empty string when disabled, absent when enabled).
    return (await btn.getAttribute('data-disabled')) !== null;
  }

  async getAmountInvalidMessage(): Promise<string | null> {
    const el = await this._amountInvalidMessage();
    return el ? (await el.text()).trim() : null;
  }

  async isFreeTicketEnabled(): Promise<boolean> {
    const btn = await this._freeTicket();
    if (!btn) return false;
    // ZardButton reflects zDisabled via the data-disabled host attribute
    // (empty string when disabled, absent when enabled).
    return (await btn.getAttribute('data-disabled')) === null;
  }

  async claimFreeTicket(): Promise<void> {
    const btn = await this._freeTicket();
    if (!btn) throw new Error('Free ticket button not found');
    await btn.click();
  }

  // --- Guest ToS assent (BRA-455) ---
  async isTermsCheckboxVisible(): Promise<boolean> {
    const el = await this._termsCheckbox();
    return el !== null;
  }

  async isTermsChecked(): Promise<boolean> {
    const el = await this._termsCheckbox();
    if (!el) return false;
    return (await el.getProperty<boolean>('checked')) ?? false;
  }

  async acceptTerms(): Promise<void> {
    const el = await this._termsCheckbox();
    if (!el) throw new Error('Terms checkbox not found');
    if (await this.isTermsChecked()) return;
    await this.toggleTerms();
  }

  async toggleTerms(): Promise<void> {
    const el = await this._termsCheckbox();
    if (!el) throw new Error('Terms checkbox not found');
    await el.click();
    await el.dispatchEvent('change');
  }

  async getTermsLinkHrefs(): Promise<{
    terms: string | null;
    privacy: string | null;
  }> {
    const termsEl = await this._termsLink();
    const privacyEl = await this._privacyLink();
    return {
      terms: termsEl ? await termsEl.getAttribute('href') : null,
      privacy: privacyEl ? await privacyEl.getAttribute('href') : null,
    };
  }

  // --- Post-payment ---
  async isViewTicketsVisible(): Promise<boolean> {
    const el = await this._viewTickets();
    return el !== null;
  }

  async clickViewTickets(): Promise<void> {
    const btn = await this._viewTickets();
    if (!btn) throw new Error('View tickets button not found');
    await btn.click();
  }

  async isRetryVisible(): Promise<boolean> {
    const el = await this._retry();
    return el !== null;
  }

  async clickRetry(): Promise<void> {
    const btn = await this._retry();
    if (!btn) throw new Error('Retry button not found');
    await btn.click();
  }
}
