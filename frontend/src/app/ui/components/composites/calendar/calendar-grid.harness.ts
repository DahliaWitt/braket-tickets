import { ComponentHarness, type TestElement } from '@angular/cdk/testing';

export class BraCalendarGridComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-calendar-grid';

  private getDayButtons = this.locatorForAll('button[type="button"]');
  private getWeekdayHeaders = this.locatorForAll('[role="columnheader"]');

  async getWeekdayLabels(): Promise<string[]> {
    const headers = await this.getWeekdayHeaders();
    return Promise.all(headers.map((h) => h.text()));
  }

  async getAllDayLabels(): Promise<string[]> {
    const buttons = await this.getDayButtons();
    return Promise.all(buttons.map((b) => b.text()));
  }

  /**
   * Returns the month and year the grid is actually rendering, derived from the
   * in-month day cells (those whose aria-label is NOT marked "Outside month").
   * Format: "February 2026". Returns null if it cannot be determined.
   *
   * This reads the rendered grid rather than the navigation header, so it can
   * catch a grid/header disagreement (e.g. month rollover from a selected 31st).
   */
  async getRenderedMonthYear(): Promise<string | null> {
    const buttons = await this.getDayButtons();
    for (const btn of buttons) {
      const ariaLabel = await btn.getAttribute('aria-label');
      if (!ariaLabel || ariaLabel.includes('Outside month')) {
        continue;
      }
      // aria-label format: "Wednesday, February 4, 2026" (weekday, month, day, year)
      const match = /([A-Za-z]+)\s+\d{1,2},\s*(\d{4})/.exec(ariaLabel);
      if (match) {
        return `${match[1]} ${match[2]}`;
      }
    }
    return null;
  }

  async getEnabledDayLabels(): Promise<string[]> {
    const buttons = await this.getDayButtons();
    const results: string[] = [];
    for (const btn of buttons) {
      const disabled = await btn.getAttribute('disabled');
      if (disabled === null) {
        results.push((await btn.text()).trim());
      }
    }
    return results;
  }

  async clickDay(label: string): Promise<void> {
    const buttons = await this.getDayButtons();
    for (const btn of buttons) {
      const text = (await btn.text()).trim();
      const disabled = await btn.getAttribute('disabled');
      if (text === label && disabled === null) {
        await btn.click();
        return;
      }
    }
    throw new Error(`No enabled day button found with label "${label}"`);
  }

  async clickDayByIndex(index: number): Promise<void> {
    const buttons = await this.getDayButtons();
    if (index < 0 || index >= buttons.length) {
      throw new Error(`Day button index ${index} out of range (0-${buttons.length - 1})`);
    }
    await buttons[index].click();
  }

  async isDaySelected(label: string): Promise<boolean> {
    const buttons = await this.getDayButtons();
    for (const btn of buttons) {
      const text = (await btn.text()).trim();
      if (text === label) {
        return (await btn.getAttribute('aria-selected')) === 'true';
      }
    }
    return false;
  }

  async getFocusedDayButton(): Promise<TestElement | null> {
    const buttons = await this.getDayButtons();
    for (const btn of buttons) {
      const tabindex = await btn.getAttribute('tabindex');
      if (tabindex === '0') {
        return btn;
      }
    }
    return null;
  }

  async getFocusedDayLabel(): Promise<string | null> {
    const btn = await this.getFocusedDayButton();
    return btn ? (await btn.text()).trim() : null;
  }

  async getTabbableDayIndex(): Promise<number> {
    const buttons = await this.getDayButtons();
    for (let index = 0; index < buttons.length; index++) {
      const tabindex = await buttons[index].getAttribute('tabindex');
      if (tabindex === '0') {
        return index;
      }
    }
    return -1;
  }

  async getAriaLabelByIndex(index: number): Promise<string | null> {
    const buttons = await this.getDayButtons();
    if (index < 0 || index >= buttons.length) {
      return null;
    }
    return buttons[index].getAttribute('aria-label');
  }
}
