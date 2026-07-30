import {ComponentHarness} from '@angular/cdk/testing';

export class ZardAlertHarness extends ComponentHarness {
  static hostSelector = 'z-alert';

  async getTitle(): Promise<string | null> {
    const el = await this.locatorForOptional('[data-alert-title]')();
    return el ? el.text() : null;
  }

  async getDescription(): Promise<string | null> {
    const el = await this.locatorForOptional('[data-alert-description]')();
    return el ? el.text() : null;
  }

  async descriptionHasClass(className: string): Promise<boolean> {
    const el = await this.locatorForOptional('[data-alert-description]')();
    return el ? el.hasClass(className) : false;
  }

  async getType(): Promise<string | null> {
    return (await this.host()).getAttribute('data-type');
  }

  async getAppearance(): Promise<string | null> {
    return (await this.host()).getAttribute('data-appearance');
  }

  async getRole(): Promise<string | null> {
    return (await this.host()).getAttribute('role');
  }
}
