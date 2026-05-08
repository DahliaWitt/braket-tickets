import { type BaseHarnessFilters, ComponentHarness, HarnessPredicate } from '@angular/cdk/testing';

export interface ZardBadgeHarnessFilters extends BaseHarnessFilters {
  text?: string | RegExp;
}

export class ZardBadgeComponentHarness extends ComponentHarness {
  static hostSelector = 'z-badge';

  static with(options: ZardBadgeHarnessFilters): HarnessPredicate<ZardBadgeComponentHarness> {
    return new HarnessPredicate(ZardBadgeComponentHarness, options).addOption(
      'text',
      options.text,
      (harness, text) => HarnessPredicate.stringMatches(harness.getText(), text),
    );
  }

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async hasClass(className: string): Promise<boolean> {
    return (await this.host()).hasClass(className);
  }
}
