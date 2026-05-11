import {ComponentHarness} from '@angular/cdk/testing';

export class EventCardHarness extends ComponentHarness {
  static hostSelector = 'app-event-card';

  private getPosterPlaceholder = this.locatorForOptional(
    '[data-testid="event-card-poster-placeholder"]',
  );

  async getTitle(): Promise<string> {
    const el = await this.locatorFor('[data-testid="event-card-title"]')();
    return el.text();
  }

  async getDate(): Promise<string> {
    const el = await this.locatorFor('[data-testid="event-card-date"]')();
    return el.text();
  }

  async getLocation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="event-card-location"]',
    )();
    return el ? el.text() : null;
  }

  async isSoldOut(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="event-card-sold-out"]',
    )();
    return el !== null;
  }

  async clickMoreInfo(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="event-card-more-info"]')();
    return btn.click();
  }

  async getMoreInfoHref(): Promise<string | null> {
    const btn = await this.locatorFor('[data-testid="event-card-more-info"]')();
    return btn.getAttribute('href');
  }

  async getMoreInfoRole(): Promise<string | null> {
    const btn = await this.locatorFor('[data-testid="event-card-more-info"]')();
    return btn.getAttribute('role');
  }

  async getPosterPlaceholderHref(): Promise<string | null> {
    const placeholder = await this.getPosterPlaceholder();
    return placeholder ? placeholder.getAttribute('href') : null;
  }

  async getPosterPlaceholderAriaHidden(): Promise<string | null> {
    const placeholder = await this.getPosterPlaceholder();
    return placeholder ? placeholder.getAttribute('aria-hidden') : null;
  }

  async clickBuy(): Promise<void> {
    const btn = await this.locatorFor('[data-testid="event-card-buy"]')();
    return btn.click();
  }

  async getBuyHref(): Promise<string | null> {
    const btn = await this.locatorFor('[data-testid="event-card-buy"]')();
    return btn.getAttribute('href');
  }

  async isBuyDisabled(): Promise<boolean> {
    const btn = await this.locatorFor('[data-testid="event-card-buy"]')();
    return (await btn.getAttribute('aria-disabled')) === 'true';
  }
}
