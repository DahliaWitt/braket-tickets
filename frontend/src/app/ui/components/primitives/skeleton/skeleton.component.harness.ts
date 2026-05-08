import { ComponentHarness } from '@angular/cdk/testing';

export class ZardSkeletonComponentHarness extends ComponentHarness {
  static hostSelector = 'z-skeleton';

  private readonly _inner = this.locatorFor('div');

  async isVisible(): Promise<boolean> {
    const host = await this.host();
    const display = await host.getCssValue('display');
    return display !== 'none';
  }

  async getClassName(): Promise<string | null> {
    return (await this._inner()).getAttribute('class');
  }

  async getRole(): Promise<string | null> {
    return (await this._inner()).getAttribute('role');
  }

  async getAriaHidden(): Promise<string | null> {
    return (await this._inner()).getAttribute('aria-hidden');
  }

  async getWidth(): Promise<string | null> {
    return (await this._inner()).getCssValue('width');
  }

  async getWidthStyle(): Promise<string> {
    return (await this._inner()).getCssValue('width');
  }

  async getHeight(): Promise<string | null> {
    return (await this._inner()).getCssValue('height');
  }

  async getHeightStyle(): Promise<string> {
    return (await this._inner()).getCssValue('height');
  }

  async hasClass(className: string): Promise<boolean> {
    return (await this._inner()).hasClass(className);
  }

  async getAnimation(): Promise<'pulse' | 'shimmer'> {
    const inner = await this._inner();
    if (await inner.hasClass('animate-shimmer')) return 'shimmer';
    return 'pulse';
  }
}
