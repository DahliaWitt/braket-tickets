import {ComponentHarness} from '@angular/cdk/testing';

export class EventPublishDialogComponentHarness extends ComponentHarness {
  static hostSelector = 'app-event-publish-dialog';

  private getOverlay = this.locatorForOptional(
    '[data-testid="publish-dialog-overlay"]',
  );
  private getDialog = this.locatorForOptional('[data-testid="publish-dialog"]');
  private getCancelButton = this.locatorForOptional(
    '[data-testid="publish-dialog-cancel"]',
  );
  private getConfirmButton = this.locatorForOptional(
    '[data-testid="publish-dialog-confirm"]',
  );
  private getScheduleDateInput = this.locatorForOptional(
    '[data-testid="schedule-date"]',
  );
  private getScheduleTimeInput = this.locatorForOptional(
    '[data-testid="schedule-time"]',
  );
  private getRecipientCountEl = this.locatorForOptional(
    '[data-testid="recipient-count"]',
  );
  private getAnnouncementRadios = this.locatorForAll(
    'input[name="announcement"]',
  );

  private async getAnnouncementRadio(choice: 'skip' | 'now' | 'scheduled') {
    const radios = await this.getAnnouncementRadios();
    for (const radio of radios) {
      const value = await radio.getProperty<string>('value');
      if (value === choice) {
        return radio;
      }
    }
    throw new Error(`Announcement radio option "${choice}" not found`);
  }

  async isOpen(): Promise<boolean> {
    return (await this.getOverlay()) !== null;
  }

  async isDialogVisible(): Promise<boolean> {
    return (await this.getDialog()) !== null;
  }

  async clickCancel(): Promise<void> {
    const button = await this.getCancelButton();
    if (!button)
      throw new Error('Cancel button not found — dialog may not be open');
    await button.click();
  }

  async clickConfirm(): Promise<void> {
    const button = await this.getConfirmButton();
    if (!button)
      throw new Error('Confirm button not found — dialog may not be open');
    await button.click();
  }

  async selectAnnouncementChoice(
    choice: 'skip' | 'now' | 'scheduled',
  ): Promise<void> {
    const radio = await this.getAnnouncementRadio(choice);
    await radio.click();
  }

  async keydownAnnouncementChoice(
    choice: 'skip' | 'now' | 'scheduled',
    key: string,
  ): Promise<void> {
    const radio = await this.getAnnouncementRadio(choice);
    await radio.sendKeys(key);
  }

  async clickAnnouncementChoiceLabel(
    choice: 'skip' | 'now' | 'scheduled',
  ): Promise<void> {
    const label = await this.locatorFor(
      `[data-testid="announcement-${choice}-label"]`,
    )();
    await label.click();
  }

  async getSelectedAnnouncementChoice(): Promise<string | null> {
    const radios = await this.getAnnouncementRadios();
    for (const radio of radios) {
      const checked = await radio.getProperty<boolean>('checked');
      if (checked) {
        return radio.getProperty<string>('value');
      }
    }
    return null;
  }

  async isScheduleDateInputVisible(): Promise<boolean> {
    return (await this.getScheduleDateInput()) !== null;
  }

  async setScheduleDate(isoDate: string): Promise<void> {
    const input = await this.getScheduleDateInput();
    if (!input)
      throw new Error(
        'Schedule date input not visible — select "scheduled" first',
      );
    await input.setInputValue(isoDate);
  }

  async setScheduleTime(time: string): Promise<void> {
    const input = await this.getScheduleTimeInput();
    if (!input)
      throw new Error(
        'Schedule time input not visible — select "scheduled" first',
      );
    await input.setInputValue(time);
  }

  async getRecipientCountText(): Promise<string | null> {
    const el = await this.getRecipientCountEl();
    return el ? el.text() : null;
  }
}
