import { ComponentHarness } from '@angular/cdk/testing';

import { BraDropdownMenuItemComponentHarness } from './dropdown-item.component.harness';

export class BraDropdownMenuContentComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-dropdown-menu-content';

  /**
   * NOTE: The menu content renders inside an `ng-template` that is projected into an overlay
   * when the dropdown is open. This harness covers the host element itself (always in the DOM
   * but hidden via `display:none`). Use the overlay-aware document-level query via
   * `TestbedHarnessEnvironment.documentRootLoader()` to locate rendered menu items at test time.
   */

  private getMenuItems = this.locatorForAll(BraDropdownMenuItemComponentHarness);

  /**
   * Returns all rendered dropdown menu item harnesses.
   * Only populated when the content template has been projected into an overlay.
   */
  async getItems(): Promise<BraDropdownMenuItemComponentHarness[]> {
    return this.getMenuItems();
  }

  /**
   * Returns the text labels of all rendered menu items.
   */
  async getItemLabels(): Promise<string[]> {
    const items = await this.getItems();
    return Promise.all(items.map((i) => i.getText()));
  }

  /**
   * Returns the menu item harness whose text matches `label`.
   * Throws if no matching item is found.
   */
  async getItemByLabel(label: string): Promise<BraDropdownMenuItemComponentHarness> {
    const items = await this.getItems();
    for (const item of items) {
      if ((await item.getText()) === label) {
        return item;
      }
    }
    throw new Error(`No dropdown menu item found with label "${label}"`);
  }

  /**
   * Returns the CSS classes applied to the rendered menu container div.
   * Returns an empty string when the template has not yet been projected.
   */
  async getMenuClasses(): Promise<string> {
    const el = this.locatorForOptional('[role="menu"]');
    const menu = await el();
    return menu ? ((await menu.getAttribute('class')) ?? '') : '';
  }
}
