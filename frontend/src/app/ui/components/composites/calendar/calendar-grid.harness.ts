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
