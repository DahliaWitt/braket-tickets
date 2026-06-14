import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import type {Id} from '@convex/_generated/dataModel';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class CommunitySelectorHarness extends ComponentHarness {
  static hostSelector = 'app-community-selector';

  private getDropdownContainer = this.locatorForOptional(
    '[data-testid="community-selector-dropdown"]',
  );
  private getSelect = this.locatorForOptional('select#community-select');
  private getStaticNameEl = this.locatorForOptional(
    '[data-testid="community-name"]',
  );
  private getSetDefaultButton = this.locatorForOptional(
    '[data-testid="set-default-community"]',
  );

  /** Returns the dropdown container element, or null if not rendered. */
  getDropdown(): Promise<TestElement | null> {
    return this.getDropdownContainer();
  }

  /** Returns the static name span element, or null if not rendered. */
  getStaticName(): Promise<TestElement | null> {
    return this.getStaticNameEl();
  }

  /** Returns true when the dropdown container is present in the DOM. */
  async isDropdownVisible(): Promise<boolean> {
    return (await this.getDropdownContainer()) !== null;
  }

  /** Returns true when the static community name span is present in the DOM. */
  async isStaticNameVisible(): Promise<boolean> {
    return (await this.getStaticNameEl()) !== null;
  }

  /** Returns the trimmed text content of the static name span, or null if absent. */
  async getStaticNameText(): Promise<string | null> {
    const el = await this.getStaticNameEl();
    if (!el) return null;
    return (await el.text()).trim();
  }

  /** Returns the native select's selected value, or null if the dropdown is absent. */
  async getSelectedValue(): Promise<string | null> {
    const select = await this.getSelect();
    if (!select) return null;

    const value: unknown = await select.getProperty('value');
    return typeof value === 'string' ? value : null;
  }

  /**
   * Sets the select element's value to `value` and dispatches a `change` event,
   * mirroring how the component listens for selection changes.
   */
  async selectCommunity(value: Id<'organizers'>): Promise<void> {
    const select = await this.getSelect();
    if (!select) {
      throw new Error('Community select dropdown is not present in the DOM');
    }

    await waitForHarnessCondition(
      async () => {
        const options = await this.locatorForAll(
          'select#community-select option',
        )();
        for (let index = 0; index < options.length; index += 1) {
          if ((await options[index].getProperty('value')) === value) {
            await select.selectOptions(index);
            return true;
          }
        }
        return false;
      },
      {
        description: `community selector option ${value}`,
        timeoutMs: 10000,
      },
    );
  }

  /** Returns true when the set-default action is rendered. */
  async hasSetDefaultButton(): Promise<boolean> {
    return (await this.getSetDefaultButton()) !== null;
  }

  /** Returns the set-default button text, or null when absent. */
  async getSetDefaultButtonText(): Promise<string | null> {
    const button = await this.getSetDefaultButton();
    if (!button) return null;
    return (await button.text()).trim();
  }

  /** Returns whether the set-default action is disabled. */
  async isSetDefaultButtonDisabled(): Promise<boolean | null> {
    const button = await this.getSetDefaultButton();
    if (!button) return null;
    return button.getAttribute('disabled').then((value) => value !== null);
  }

  /** Clicks the set-default action. */
  async clickSetDefaultButton(): Promise<void> {
    const button = await this.getSetDefaultButton();
    if (!button) {
      throw new Error('Set default community button is not present in the DOM');
    }
    await button.click();
  }
}
