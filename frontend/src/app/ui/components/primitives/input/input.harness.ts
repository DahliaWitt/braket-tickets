import {ComponentHarness, HarnessPredicate} from '@angular/cdk/testing';

export class ZardInputHarness extends ComponentHarness {
  static hostSelector = '[zInput]';

  static with(
    options: {selector?: string} = {},
  ): HarnessPredicate<ZardInputHarness> {
    return new HarnessPredicate(ZardInputHarness, options);
  }

  async getValue(): Promise<string> {
    return (await this.host()).getProperty('value');
  }

  async setValue(value: string): Promise<void> {
    const host = await this.host();
    await host.clear();
    await host.sendKeys(value);
    // Ensure the input event is dispatched to trigger the model update
    await host.dispatchEvent('input');
    await host.blur();
  }

  async isDisabled(): Promise<boolean> {
    return (await this.host()).getProperty('disabled');
  }

  async getAriaInvalid(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-invalid');
  }

  async getAriaDescribedBy(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-describedby');
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.host()).getAttribute(name);
  }

  async blur(): Promise<void> {
    return (await this.host()).blur();
  }
}
