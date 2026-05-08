import { ComponentHarness } from '@angular/cdk/testing';

export class SelectItemHarness extends ComponentHarness {
  static hostSelector = 'z-select-item';

  async getDataSelected(): Promise<string | null> {
    return (await this.host()).getAttribute('data-selected');
  }

  async getDataDisabled(): Promise<string | null> {
    return (await this.host()).getAttribute('data-disabled');
  }

  async click(): Promise<void> {
    await (await this.host()).click();
  }
}
