import {
  type BaseHarnessFilters,
  ComponentHarness,
  HarnessPredicate,
} from '@angular/cdk/testing';

export interface ZardButtonHarnessFilters extends BaseHarnessFilters {
  text?: string | RegExp;
}

export class ZardButtonComponentHarness extends ComponentHarness {
  static hostSelector = 'z-button, button[z-button], a[z-button]';

  static with(
    options: ZardButtonHarnessFilters,
  ): HarnessPredicate<ZardButtonComponentHarness> {
    return new HarnessPredicate(ZardButtonComponentHarness, options).addOption(
      'text',
      options.text,
      (harness, text) =>
        HarnessPredicate.stringMatches(harness.getText(), text),
    );
  }

  async getText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }

  async click(): Promise<void> {
    const host = await this.host();
    return host.click();
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    const disabled = await host.getAttribute('disabled');
    const ariaDisabled = await host.getAttribute('aria-disabled');
    const dataDisabled = await host.getAttribute('data-disabled');
    return (
      disabled !== null || ariaDisabled === 'true' || dataDisabled !== null
    );
  }

  async isLoading(): Promise<boolean> {
    // Check if spinner exists inside host by tag and class
    const spinnerFn = this.locatorForOptional('z-icon.animate-spin');
    const spinner = await spinnerFn();
    // Also check generic z-icon if class check fails, as fallback, but for now stick to class
    if (spinner) return true;

    // Fallback: check for any z-icon? No, stick to specific.
    // If it fails, maybe the classes are dynamic?
    return false;
  }

  async getAriaBusy(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('aria-busy');
  }

  async getAriaDisabled(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('aria-disabled');
  }

  async getHref(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('href');
  }

  async getRole(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('role');
  }

  async getTabIndex(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('tabindex');
  }

  async keydown(key: string): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('keydown', {key});
  }

  async hasClass(className: string): Promise<boolean> {
    const host = await this.host();
    return host.hasClass(className);
  }
}
