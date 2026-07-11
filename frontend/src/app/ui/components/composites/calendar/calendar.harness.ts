import {ComponentHarness} from '@angular/cdk/testing';

import {BraCalendarGridComponentHarness} from './calendar-grid.harness';
import {BraCalendarNavigationComponentHarness} from './calendar-navigation.component.harness';

export class BraCalendarComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-calendar, [bra-calendar]';

  private getGrid = this.locatorFor(BraCalendarGridComponentHarness);
  private getNavigation = this.locatorFor(
    BraCalendarNavigationComponentHarness,
  );

  async getNavigationHarness(): Promise<BraCalendarNavigationComponentHarness> {
    return this.getNavigation();
  }

  async getGridHarness(): Promise<BraCalendarGridComponentHarness> {
    return this.getGrid();
  }

  /** Click the previous month button. */
  async clickPreviousMonth(): Promise<void> {
    const nav = await this.getNavigation();
    await nav.clickPreviousMonth();
  }

  /** Click the next month button. */
  async clickNextMonth(): Promise<void> {
    const nav = await this.getNavigation();
    await nav.clickNextMonth();
  }

  /** Returns the currently displayed month label (e.g. "Jan"). */
  async getCurrentMonthLabel(): Promise<string> {
    const nav = await this.getNavigation();
    return nav.getCurrentMonthLabel();
  }

  /** Returns the currently displayed year label (e.g. "2025"). */
  async getCurrentYearLabel(): Promise<string> {
    const nav = await this.getNavigation();
    return nav.getCurrentYearLabel();
  }

  /** Returns the text of all enabled day buttons in the grid. */
  async getEnabledDayLabels(): Promise<string[]> {
    const grid = await this.getGrid();
    return grid.getEnabledDayLabels();
  }

  /**
   * Returns the month/year the grid is actually rendering (e.g. "February 2026"),
   * derived from the in-month day cells. Use this to assert the rendered grid
   * agrees with the navigation header — not just the header dropdown value.
   */
  async getRenderedGridMonthYear(): Promise<string | null> {
    const grid = await this.getGrid();
    return grid.getRenderedMonthYear();
  }

  /** Clicks a day button by its visible label (e.g. "15"). */
  async clickDay(label: string): Promise<void> {
    const grid = await this.getGrid();
    await grid.clickDay(label);
  }

  /** Returns true if the host element is disabled (aria-disabled). */
  async isDisabled(): Promise<boolean> {
    const host = await this.host();
    return (await host.getAttribute('disabled')) !== null;
  }
}
