import { ComponentHarness } from '@angular/cdk/testing';

export class ZardProgressBarComponentHarness extends ComponentHarness {
  static hostSelector = 'z-progress-bar';

  private readonly _progressbar = this.locatorFor('[role="progressbar"]');
  private readonly _determinateBar = this.locatorForOptional('#bar');

  async getProgress(): Promise<number | null> {
    const bar = await this._progressbar();
    const value = await bar.getAttribute('aria-valuenow');
    return value !== null ? Number(value) : null;
  }

  async getAriaValueNow(): Promise<string | null> {
    return (await this._progressbar()).getAttribute('aria-valuenow');
  }

  async isIndeterminate(): Promise<boolean> {
    const bar = await this._progressbar();
    const busy = await bar.getAttribute('aria-busy');
    return busy === 'true';
  }

  async getAriaBusy(): Promise<string | null> {
    return (await this._progressbar()).getAttribute('aria-busy');
  }

  async getAriaLabel(): Promise<string | null> {
    return (await this._progressbar()).getAttribute('aria-label');
  }

  async getDeterminateWidthStyle(): Promise<string | null> {
    const bar = await this._determinateBar();
    return bar ? bar.getAttribute('style') : null;
  }
}
