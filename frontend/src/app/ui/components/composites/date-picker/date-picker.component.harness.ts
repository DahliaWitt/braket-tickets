import { ComponentHarness } from '@angular/cdk/testing';

export class BraDatePickerHarness extends ComponentHarness {
  static hostSelector = 'button';

  async getTriggerText(): Promise<string> {
    const trigger = await this.host();
    return trigger.text();
  }

  async isDisabled(): Promise<boolean> {
    const trigger = await this.host();
    return trigger.getProperty<boolean>('disabled');
  }
}
