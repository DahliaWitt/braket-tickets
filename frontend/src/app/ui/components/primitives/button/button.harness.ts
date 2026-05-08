import { ComponentHarness } from '@angular/cdk/testing';

export class ZardButtonHarness extends ComponentHarness {
  static hostSelector = 'z-button, button[z-button], a[z-button]';

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async click(): Promise<void> {
    return (await this.host()).click();
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }

  async isLoading(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('aria-busy')) === 'true';
  }

  async hasGlow(): Promise<boolean> {
    return (await (await this.host()).getAttribute('data-glow')) !== null;
  }

  async getType(): Promise<string | null> {
    return (await this.host()).getAttribute('data-type');
  }
}
