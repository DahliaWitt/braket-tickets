import { type BaseHarnessFilters, ComponentHarness, HarnessPredicate } from '@angular/cdk/testing';

export interface ZardSelectItemHarnessFilters extends BaseHarnessFilters {
  text?: string | RegExp;
  value?: string;
}

export class ZardSelectItemComponentHarness extends ComponentHarness {
  static hostSelector = 'z-select-item, [z-select-item]';

  static with(
    options: ZardSelectItemHarnessFilters,
  ): HarnessPredicate<ZardSelectItemComponentHarness> {
    return new HarnessPredicate(ZardSelectItemComponentHarness, options)
      .addOption('text', options.text, (harness, text) =>
        HarnessPredicate.stringMatches(harness.getText(), text),
      )
      .addOption(
        'value',
        options.value,
        async (harness, value) => (await harness.getValue()) === value,
      );
  }

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async getValue(): Promise<string | null> {
    return (await this.host()).getAttribute('value');
  }

  async isSelected(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-selected')) !== null;
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }

  async click(): Promise<void> {
    await (await this.host()).click();
  }
}
