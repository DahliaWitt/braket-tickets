import { ComponentHarness } from '@angular/cdk/testing';

export class ZardSwitchHarness extends ComponentHarness {
  static hostSelector = 'z-switch';

  private getButton = this.locatorFor('button[role="switch"]');

  async isChecked(): Promise<boolean> {
    const btn = await this.getButton();
    return (await btn.getAttribute('aria-checked')) === 'true';
  }

  async isDisabled(): Promise<boolean> {
    const btn = await this.getButton();
    return (await btn.getProperty<boolean>('disabled')) ?? false;
  }

  async toggle(): Promise<void> {
    const btn = await this.getButton();
    return btn.click();
  }

  async getLabel(): Promise<string> {
    const label = await this.locatorFor('label')();
    return label.text();
  }
}
