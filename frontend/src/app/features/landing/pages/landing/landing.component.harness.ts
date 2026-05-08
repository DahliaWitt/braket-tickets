import { ComponentHarness } from '@angular/cdk/testing';

export class LandingComponentHarness extends ComponentHarness {
  static hostSelector = 'app-landing';

  // ─── Hero ──────────────────────────────────────────
  private _hero = this.locatorForOptional('[data-testid="landing-hero"]');
  private _loginBtn = this.locatorForOptional('[data-testid="landing-login-btn"]');
  private _iykyk = this.locatorForOptional('[data-testid="landing-iykyk"]');

  async hasHeroSection(): Promise<boolean> {
    const el = await this._hero();
    return el !== null;
  }

  async clickLogin(): Promise<void> {
    const btn = await this._loginBtn();
    if (!btn) throw new Error('Login button not found');
    await btn.click();
  }

  async hasIykyk(): Promise<boolean> {
    const el = await this._iykyk();
    return el !== null;
  }

  // ─── Featured Event ────────────────────────────────
  private _featuredEvent = this.locatorForOptional('[data-testid="landing-featured-event"]');

  async hasFeaturedEventSection(): Promise<boolean> {
    const el = await this._featuredEvent();
    return el !== null;
  }

  // ─── Overflow Events ───────────────────────────────
  private _overflowEvents = this.locatorForOptional('[data-testid="landing-overflow-events"]');
  private _browseAll = this.locatorForOptional('[data-testid="browse-all-events"]');

  async hasOverflowEventsSection(): Promise<boolean> {
    const el = await this._overflowEvents();
    return el !== null;
  }

  async hasBrowseAllLink(): Promise<boolean> {
    const el = await this._browseAll();
    return el !== null;
  }

  // ─── Communities Bar ───────────────────────────────
  private _communities = this.locatorForOptional('[data-testid="landing-communities"]');

  async hasCommunitiesSection(): Promise<boolean> {
    const el = await this._communities();
    return el !== null;
  }
}
