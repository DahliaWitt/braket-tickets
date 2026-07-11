import { type BaseHarnessFilters, ComponentHarness, HarnessPredicate } from '@angular/cdk/testing';

export class ZardSelectHarness extends ComponentHarness {
  static hostSelector = 'z-select';

  private readonly trigger = this.locatorFor('button');

  async clickTrigger(): Promise<void> {
    const trigger = await this.trigger();
    await trigger.click();
  }

  async isOpen(): Promise<boolean> {
    const trigger = await this.trigger();
    return (await trigger.getAttribute('aria-expanded')) === 'true';
  }

  async getAriaLabel(): Promise<string | null> {
    const trigger = await this.trigger();
    return trigger.getAttribute('aria-label');
  }

  async getAriaLabelledBy(): Promise<string | null> {
    const trigger = await this.trigger();
    return trigger.getAttribute('aria-labelledby');
  }

  async getTriggerText(): Promise<string> {
    const trigger = await this.trigger();
    return trigger.text();
  }

  /**
   * Reads `aria-activedescendant` from the open dropdown's listbox.
   * The listbox renders in a CDK overlay, so it is resolved from the document root.
   * Requires the dropdown to be open.
   */
  async getActiveDescendantId(): Promise<string | null> {
    const listbox = await this.documentRootLocatorFactory().locatorFor(
      '[role="listbox"]',
    )();
    return listbox.getAttribute('aria-activedescendant');
  }

  /**
   * Returns the DOM `id` of the option with the given value.
   * Requires the dropdown to be open so the option is rendered in the overlay.
   */
  async getOptionId(value: string): Promise<string | null> {
    const option = await this.documentRootLocatorFactory().locatorFor(
      `z-select-item[value="${value}"]`,
    )();
    return option.getAttribute('id');
  }
}

export interface ZardSelectItemHarnessFilters extends BaseHarnessFilters {
  text?: string | RegExp;
  value?: string;
}

export class ZardSelectItemHarness extends ComponentHarness {
  static hostSelector = 'z-select-item';

  static with(options: ZardSelectItemHarnessFilters): HarnessPredicate<ZardSelectItemHarness> {
    return new HarnessPredicate(ZardSelectItemHarness, options)
      .addOption('text', options.text, async (harness, text) =>
        HarnessPredicate.stringMatches(harness.getText(), text),
      )
      .addOption(
        'value',
        options.value,
        async (harness, value) => (await harness.getValue()) === value,
      );
  }

  async click(): Promise<void> {
    const host = await this.host();
    await host.click();
  }

  async getText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }

  async getValue(): Promise<string | null> {
    const host = await this.host();
    return host.getAttribute('value');
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }
}

export interface ZardSelectHarnessFilters extends BaseHarnessFilters {
  placeholder?: string | RegExp;
  /** Match by data-testid attribute on the host element. */
  testId?: string;
}

export class ZardSelectComponentHarness extends ComponentHarness {
  static hostSelector = 'z-select, [z-select]';

  static with(options: ZardSelectHarnessFilters): HarnessPredicate<ZardSelectComponentHarness> {
    return new HarnessPredicate(ZardSelectComponentHarness, options)
      .addOption(
        'placeholder',
        options.placeholder,
        async (harness, placeholder) =>
          HarnessPredicate.stringMatches(harness.getPlaceholderText(), placeholder),
      )
      .addOption('testId', options.testId, async (harness, testId) => {
        const host = await harness.host();
        return (await host.getAttribute('data-testid')) === testId;
      });
  }

  private readonly triggerButton = this.locatorFor('button[type="button"]');
  private readonly placeholderEl = this.locatorForOptional('.text-muted-foreground.truncate');

  async isOpen(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-state')) === 'open';
  }

  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('data-disabled')) !== null;
  }

  async open(): Promise<void> {
    if (!(await this.isOpen())) {
      await this.toggle();
    }
  }

  async close(): Promise<void> {
    if (await this.isOpen()) {
      await this.toggle();
    }
  }

  async toggle(): Promise<void> {
    const button = await this.triggerButton();
    await button.click();
  }

  async getSelectedText(): Promise<string> {
    const button = await this.triggerButton();
    return button.text();
  }

  async getPlaceholderText(): Promise<string> {
    const el = await this.placeholderEl();
    return el ? el.text() : '';
  }

  async isPlaceholderVisible(): Promise<boolean> {
    const el = await this.placeholderEl();
    return el !== null;
  }

  async selectOption(option: string | RegExp): Promise<void> {
    await this.open();
    const rootLocator = this.documentRootLocatorFactory();
    // Poll for options — CDK overlay may not render immediately in zoneless Angular
    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const elements = await rootLocator.locatorForAll('[role="option"]')();
      for (const el of elements) {
        const text = await el.text();
        if (typeof option === 'string') {
          if (text.includes(option)) {
            await el.click();
            return;
          }
        } else if (option.test(text)) {
          await el.click();
          return;
        }
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error(`Option "${option}" not found in z-select dropdown`);
  }

  async selectOptionByValue(value: string): Promise<void> {
    await this.open();
    const rootLocator = this.documentRootLocatorFactory();
    const elements = await rootLocator.locatorForAll(`z-select-item[value="${value}"]`)();
    if (elements.length === 0) {
      throw new Error(`Option with value "${value}" not found in z-select dropdown`);
    }
    await elements[0].click();
  }

  async getOptionElements() {
    await this.open();
    const rootLocator = this.documentRootLocatorFactory();
    return rootLocator.locatorForAll('[role="option"]')();
  }
}
