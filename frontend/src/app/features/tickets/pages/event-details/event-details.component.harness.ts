import {
  ComponentHarness,
  HarnessPredicate,
  type TestElement,
} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class EventDetailsHarness extends ComponentHarness {
  static hostSelector = 'app-event-details';

  private async awaitRendered(
    locator: () => Promise<TestElement | null>,
    description: string,
    timeoutMs = 5000,
  ): Promise<void> {
    await waitForHarnessCondition(async () => (await locator()) !== null, {
      description,
      timeoutMs,
    });
  }

  private async waitForContent(timeoutMs = 15000): Promise<void> {
    await waitForHarnessCondition(
      async () =>
        (await this._eventTitle()) !== null ||
        (await this._errorState()) !== null,
      {
        description: 'event details content',
        timeoutMs,
      },
    );
  }

  static with(
    options: {selector?: string} = {},
  ): HarnessPredicate<EventDetailsHarness> {
    return new HarnessPredicate(EventDetailsHarness, options);
  }

  // --- Error State ---
  private _errorState = this.locatorForOptional(
    '[data-testid="event-details-error-state"]',
  );
  private _notFoundState = this.locatorForOptional(
    '[data-testid="event-details-not-found-state"]',
  );

  async isErrorVisible(): Promise<boolean> {
    const el = await this._errorState();
    return el !== null;
  }

  async isNotFoundVisible(): Promise<boolean> {
    const el = await this._notFoundState();
    return el !== null;
  }

  async getNotFoundText(): Promise<string | null> {
    const el = await this._notFoundState();
    return el ? el.text() : null;
  }

  // --- Community Link ---
  private _communityLinkContainer = this.locatorForOptional(
    '[data-testid="community-link-container"]',
  );
  private _communityLink = this.locatorForOptional(
    '[data-testid="community-link"]',
  );
  private _communityName = this.locatorForOptional(
    '[data-testid="community-name"]',
  );

  async isCommunityLinkVisible(): Promise<boolean> {
    const el = await this._communityLink();
    return el !== null;
  }

  async getCommunityName(): Promise<string | null> {
    const link = await this._communityLink();
    if (link) return (await link.text()).trim();
    const name = await this._communityName();
    if (name) return (await name.text()).trim();
    return null;
  }

  // --- Vetting ---
  private _vettingNotice = this.locatorForOptional(
    '[data-testid="vetting-notice"]',
  );
  private _vettingSignInBtn = this.locatorForOptional(
    '[data-testid="vetting-sign-in-btn"]',
  );
  private _applyForVettingLink = this.locatorForOptional(
    '[data-testid="apply-for-vetting-link"]',
  );
  private _actionBarVettingLink = this.locatorForOptional(
    '[data-testid="action-bar-vetting-link"]',
  );

  async isVettingNoticeVisible(): Promise<boolean> {
    const el = await this._vettingNotice();
    return el !== null;
  }

  async clickVettingSignIn(): Promise<void> {
    const btn = await this._vettingSignInBtn();
    if (!btn) throw new Error('Vetting sign-in button not found');
    await btn.click();
  }

  async clickApplyForVetting(): Promise<void> {
    const link = await this._applyForVettingLink();
    if (!link) throw new Error('Apply for vetting link not found');
    await link.click();
  }

  async isActionBarVettingLinkVisible(): Promise<boolean> {
    const el = await this._actionBarVettingLink();
    return el !== null;
  }

  // --- Paused Sales Banner ---
  private _pausedSalesBanner = this.locatorForOptional(
    '[data-testid="paused-sales-banner"]',
  );

  async isPausedSalesBannerVisible(): Promise<boolean> {
    const el = await this._pausedSalesBanner();
    return el !== null;
  }

  async getPausedSalesBannerText(): Promise<string | null> {
    const el = await this._pausedSalesBanner();
    return el
      ? String((await el.getProperty('textContent')) ?? '').trim()
      : null;
  }

  // --- Resale ---
  private _soldOutBanner = this.locatorForOptional(
    '[data-testid="sold-out-banner"]',
  );
  private _unsubscribeResaleBtn = this.locatorForOptional(
    '[data-testid="unsubscribe-resale-btn"]',
  );
  private _resaleNotifyBtn = this.locatorForOptional(
    '[data-testid="resale-notify-btn"]',
  );
  private _resaleNotifySubscribed = this.locatorForOptional(
    '[data-testid="resale-notify-subscribed"]',
  );

  async isSoldOutBannerVisible(): Promise<boolean> {
    const el = await this._soldOutBanner();
    return el !== null;
  }

  async getSoldOutStatusActionGapPx(): Promise<number> {
    const el = await this._soldOutBanner();
    if (!el) throw new Error('Sold out banner not found');

    return parseCssLengthPx(
      (await el.getCssValue('gap')) || (await el.getCssValue('row-gap')),
    );
  }

  async isUnsubscribeResaleVisible(): Promise<boolean> {
    const el = await this._unsubscribeResaleBtn();
    return el !== null;
  }

  async clickUnsubscribeResale(): Promise<void> {
    const btn = await this._unsubscribeResaleBtn();
    if (!btn) throw new Error('Unsubscribe resale button not found');
    await btn.click();
  }

  async isResaleNotifyButtonVisible(): Promise<boolean> {
    const el = await this._resaleNotifyBtn();
    return el !== null;
  }

  async clickResaleNotifyButton(): Promise<void> {
    const btn = await this._resaleNotifyBtn();
    if (!btn) throw new Error('Resale notify button not found');
    await btn.click();
  }

  async isResaleNotifySubscribedVisible(): Promise<boolean> {
    const el = await this._resaleNotifySubscribed();
    return el !== null;
  }

  async getResaleNotifySubscribedText(): Promise<string | null> {
    const el = await this._resaleNotifySubscribed();
    return el
      ? String((await el.getProperty('textContent')) ?? '').trim()
      : null;
  }

  // --- Event Title ---
  private _eventTitle = this.locatorForOptional('[data-testid="event-title"]');

  async getEventTitle(): Promise<string> {
    await this.waitForContent();
    const errorState = await this._errorState();
    if (errorState) {
      throw new Error(
        `Event details error state visible: ${(await errorState.text()).trim()}`,
      );
    }
    const el = await this._eventTitle();
    if (!el) throw new Error('Event title heading not found');
    return String((await el.getProperty('textContent')) ?? '').trim();
  }

  // --- Get Tickets Button ---
  private _getTicketsButton = this.locatorForOptional(
    '[data-testid="get-tickets-button"]',
  );
  private _contactCommunityButton = this.locatorForOptional(
    '[data-testid="contact-community-button"]',
  );

  async isGetTicketsButtonVisible(): Promise<boolean> {
    const el = await this._getTicketsButton();
    return el !== null;
  }

  async clickGetTickets(): Promise<void> {
    await this.awaitRendered(this._getTicketsButton, 'get tickets button');
    const el = await this._getTicketsButton();
    if (!el) throw new Error('Get Tickets button not found');
    await el.click();
  }

  async getGetTicketsButtonText(): Promise<string> {
    const el = await this._getTicketsButton();
    if (!el) throw new Error('Get Tickets button not found');
    return (await el.text()).trim();
  }

  async isContactCommunityButtonVisible(): Promise<boolean> {
    const el = await this._contactCommunityButton();
    return el !== null;
  }

  async clickContactCommunityButton(): Promise<void> {
    const el = await this._contactCommunityButton();
    if (!el) throw new Error('Contact community button not found');
    await el.click();
  }

  // --- Limit Reached ---
  private _limitReached = this.locatorForOptional(
    '[data-testid="ticket-limit-reached"]',
  );

  async isLimitReachedVisible(): Promise<boolean> {
    const el = await this._limitReached();
    return el !== null;
  }

  async getLimitReachedText(): Promise<string | null> {
    const el = await this._limitReached();
    return el
      ? String((await el.getProperty('textContent')) ?? '').trim()
      : null;
  }

  // --- Resale Available Banner ---
  private _resaleAvailableBanner = this.locatorForOptional(
    '[data-testid="resale-available-banner"]',
  );

  async isResaleAvailableBannerVisible(): Promise<boolean> {
    const el = await this._resaleAvailableBanner();
    return el !== null;
  }

  // --- Guest Checkout ---
  private _guestCheckoutOptions = this.locatorForOptional(
    '[data-testid="guest-checkout-options"]',
  );
  private _checkoutAsGuestBtn = this.locatorForOptional(
    '[data-testid="checkout-as-guest-btn"]',
  );
  private _signInToPurchaseBtn = this.locatorForOptional(
    '[data-testid="sign-in-to-purchase-btn"]',
  );

  async isGuestCheckoutVisible(): Promise<boolean> {
    const el = await this._guestCheckoutOptions();
    return el !== null;
  }

  async clickCheckoutAsGuest(): Promise<void> {
    const btn = await this._checkoutAsGuestBtn();
    if (!btn) throw new Error('Checkout as guest button not found');
    await btn.click();
  }

  async clickSignInToPurchase(): Promise<void> {
    const btn = await this._signInToPurchaseBtn();
    if (!btn) throw new Error('Sign in to purchase button not found');
    await btn.click();
  }
}

function parseCssLengthPx(cssValue: string): number {
  const value = Number.parseFloat(cssValue);
  if (Number.isNaN(value)) return 0;
  if (cssValue.endsWith('rem')) return value * 16;
  return value;
}
