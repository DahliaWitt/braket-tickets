import { type BaseHarnessFilters, ComponentHarness, HarnessPredicate } from '@angular/cdk/testing';

export class DropdownItemHarness extends ComponentHarness {
  static hostSelector = 'bra-dropdown-menu-item';

  async click(): Promise<void> {
    await (await this.host()).click();
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.host()).getAttribute(name);
  }
}

export interface BraDropdownMenuItemHarnessFilters extends BaseHarnessFilters {
  text?: string | RegExp;
}

export class BraDropdownMenuItemComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-dropdown-menu-item, [bra-dropdown-menu-item]';

  static with(
    options: BraDropdownMenuItemHarnessFilters,
  ): HarnessPredicate<BraDropdownMenuItemComponentHarness> {
    return new HarnessPredicate(BraDropdownMenuItemComponentHarness, options).addOption(
      'text',
      options.text,
      async (harness, text) => HarnessPredicate.stringMatches(await harness.getText(), text),
    );
  }

  async getText(): Promise<string> {
    return (await (await this.host()).text()).trim();
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }

  async getVariant(): Promise<string> {
    const host = await this.host();
    return (await host.getAttribute('data-variant')) ?? 'default';
  }

  async isInset(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-inset')) !== null;
  }

  async click(): Promise<void> {
    await (await this.host()).click();
  }
}
