import { ComponentHarness } from '@angular/cdk/testing';

export class ZardIconComponentHarness extends ComponentHarness {
  static hostSelector = 'z-icon, [z-icon]';

  async getIconName(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('zType');
  }

  async hasClass(className: string): Promise<boolean> {
    const svg = await this.locatorFor('svg')();
    return svg.hasClass(className);
  }
}
