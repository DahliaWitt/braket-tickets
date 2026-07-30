import {ComponentHarness} from '@angular/cdk/testing';

export class LandingComponentHarness extends ComponentHarness {
  static hostSelector = 'app-landing';

  // ─── Hero ──────────────────────────────────────────
  private _hero = this.locatorForOptional('[data-testid="landing-hero"]');
  private _loginBtn = this.locatorForOptional(
    '[data-testid="landing-login-btn"]',
  );
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

  // ─── Events ────────────────────────────────────────
  private _eventsSection = this.locatorForOptional(
    '[data-testid="landing-events"]',
  );
  private _eventsLoading = this.locatorForOptional(
    '[data-testid="landing-events-loading"]',
  );
  private _eventsSkeletons = this.locatorForAll(
    '[data-testid="landing-events-loading"] z-skeleton',
  );
  private _eventsError = this.locatorForOptional(
    '[data-testid="landing-events-error"]',
  );
  private _browseAll = this.locatorForOptional(
    '[data-testid="browse-all-events"]',
  );

  async hasEventsSection(): Promise<boolean> {
    const el = await this._eventsSection();
    return el !== null;
  }

  async hasEventsLoadingSection(): Promise<boolean> {
    const el = await this._eventsLoading();
    return el !== null;
  }

  async getEventsSkeletonCount(): Promise<number> {
    return (await this._eventsSkeletons()).length;
  }

  async hasEventsErrorSection(): Promise<boolean> {
    const el = await this._eventsError();
    return el !== null;
  }

  async getEventsErrorText(): Promise<string | null> {
    const el = await this._eventsError();
    return el ? (await el.text()).trim() : null;
  }

  async getEventsText(): Promise<string | null> {
    const el = await this._eventsSection();
    return el ? (await el.text()).trim() : null;
  }

  async hasBrowseAllLink(): Promise<boolean> {
    const el = await this._browseAll();
    return el !== null;
  }

  // ─── Communities Bar ───────────────────────────────
  private _communities = this.locatorForOptional(
    '[data-testid="landing-communities"]',
  );

  async hasCommunitiesSection(): Promise<boolean> {
    const el = await this._communities();
    return el !== null;
  }
}
