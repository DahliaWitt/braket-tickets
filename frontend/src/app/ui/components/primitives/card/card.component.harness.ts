import { ComponentHarness } from '@angular/cdk/testing';

export class ZardCardComponentHarness extends ComponentHarness {
  static hostSelector = 'z-card';

  async getText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }

  async getTitleText(): Promise<string> {
    const title = await this.locatorForOptional('[data-slot="card-title"]')();
    return title ? title.text() : '';
  }
}

export class ZardCardHeaderComponentHarness extends ComponentHarness {
  static hostSelector = '[data-slot="card-header"]';
}

export class ZardCardTitleComponentHarness extends ComponentHarness {
  static hostSelector = '[data-slot="card-title"]';

  async getText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }
}
