import { ComponentHarness } from '@angular/cdk/testing';

export class BraCalendarNavigationHarness extends ComponentHarness {
  static hostSelector = 'bra-calendar-navigation';

  private readonly previousButton = this.locatorFor('button[aria-label="Previous month"]');
  private readonly nextButton = this.locatorFor('button[aria-label="Next month"]');

  async clickPrevious(): Promise<void> {
    const button = await this.previousButton();
    await button.click();
  }

  async clickNext(): Promise<void> {
    const button = await this.nextButton();
    await button.click();
  }

  async isPreviousDisabled(): Promise<boolean> {
    const button = await this.previousButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async isNextDisabled(): Promise<boolean> {
    const button = await this.nextButton();
    return (await button.getAttribute('disabled')) !== null;
  }
}

export class BraCalendarNavigationComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-calendar-navigation';

  private getPreviousButton = this.locatorFor('button[aria-label="Previous month"]');
  private getNextButton = this.locatorFor('button[aria-label="Next month"]');
  private getMonthSelect = this.locatorFor(
    'z-select[zAriaLabel="Select month"], z-select[aria-label="Select month"]',
  );
  private getYearSelect = this.locatorFor(
    'z-select[zAriaLabel="Select year"], z-select[aria-label="Select year"]',
  );

  async clickPreviousMonth(): Promise<void> {
    await (await this.getPreviousButton()).click();
  }

  async clickNextMonth(): Promise<void> {
    await (await this.getNextButton()).click();
  }

  async isPreviousDisabled(): Promise<boolean> {
    const button = await this.getPreviousButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async isNextDisabled(): Promise<boolean> {
    const button = await this.getNextButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async getCurrentMonthLabel(): Promise<string> {
    const select = await this.getMonthSelect();
    const label = await select.getAttribute('zLabel');
    return (label ?? (await select.text())).trim();
  }

  async getCurrentYearLabel(): Promise<string> {
    const select = await this.getYearSelect();
    const label = await select.getAttribute('zLabel');
    return (label ?? (await select.text())).trim();
  }
}
