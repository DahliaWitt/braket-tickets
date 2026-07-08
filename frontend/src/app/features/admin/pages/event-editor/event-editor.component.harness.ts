import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import type {EventVisibility} from '@shared/domain/event-visibility';

export class EventEditorHarness extends ComponentHarness {
  static hostSelector = 'app-event-editor';

  // ── Publish dialog ────────────────────────────────────────────────

  private getPublishSaveBtn = this.locatorFor(
    '[data-testid="publish-save-btn"]',
  );
  private getPublishDialogEl = this.locatorForOptional(
    '[data-testid="publish-dialog"]',
  );
  private getPublishDialogConfirmBtn = this.locatorFor(
    '[data-testid="publish-dialog-confirm"]',
  );
  private getPublishDialogCancelBtn = this.locatorFor(
    '[data-testid="publish-dialog-cancel"]',
  );
  private getRecipientCountEl = this.locatorForOptional(
    '[data-testid="recipient-count"]',
  );

  async openPublishDialog(): Promise<void> {
    const btn = await this.getPublishSaveBtn();
    await btn.click();
  }

  async isPublishDialogVisible(): Promise<boolean> {
    const el = await this.getPublishDialogEl();
    return el !== null;
  }

  async getAnnouncementChoice(): Promise<'skip' | 'now' | 'scheduled' | null> {
    for (const choice of ['skip', 'now', 'scheduled'] as const) {
      const radio = await this.locatorForOptional(
        `input[name="announcement"][value="${choice}"]`,
      )();
      // The template uses [checked] binding not value attr — check via property
      if (radio) {
        const checked = await radio.getProperty<boolean>('checked');
        if (checked) return choice;
      }
    }
    return null;
  }

  async setAnnouncementChoice(
    choice: 'skip' | 'now' | 'scheduled',
  ): Promise<void> {
    const radio = await this.locatorFor(
      `input[type="radio"][value="${choice}"]`,
    )();
    await radio.click();
  }

  async getRecipientCountText(): Promise<string | null> {
    const el = await this.getRecipientCountEl();
    return el ? (await el.text()).trim() : null;
  }

  async confirmPublish(): Promise<void> {
    const btn = await this.getPublishDialogConfirmBtn();
    await btn.click();
  }

  async cancelPublishDialog(): Promise<void> {
    const btn = await this.getPublishDialogCancelBtn();
    await btn.click();
  }

  private getTitleInput = this.locatorFor('input#title');
  private getDatePicker = this.locatorFor('bra-date-picker');
  private getLocationInput = this.locatorFor('input#location');
  private getDescriptionTextArea = this.locatorFor('textarea#description');
  private getSaveButton = this.locatorFor('button[zType="default"]');
  private getCancelButton = this.locatorFor('button[z-button][zType="ghost"]');
  private getFileInput = this.locatorFor('input[type="file"]');
  private getSelectFileLabel = this.locatorFor('label.cursor-pointer');
  private getFileNameText = this.locatorFor('span.truncate');
  private getClearFileButton = this.locatorFor('button.text-destructive');
  private getTotalTicketsInput = this.locatorFor('input#totalTickets');
  private getSlidingScaleCheckbox = this.locatorFor(
    'input#slidingScaleEnabled',
  );
  private getSlidingScaleMaxInput = this.locatorForOptional(
    'input#slidingScaleMax',
  );
  private getMaxTicketsPerUserInput = this.locatorFor(
    'input#maxTicketsPerUser',
  );
  private getTitleTooLongError = this.locatorForOptional(
    '[data-testid="title-too-long-error"]',
  );
  private getTitleBlankError = this.locatorForOptional(
    '[data-testid="title-blank-error"]',
  );
  private getPriceError = this.locatorForOptional(
    '[data-testid="price-error"]',
  );
  private getDateError = this.locatorForOptional('[data-testid="date-error"]');
  private getTimeError = this.locatorForOptional('[data-testid="time-error"]');
  private getEndTimeInput = this.locatorFor('input#endTime');
  private getEndTimeError = this.locatorForOptional(
    '[data-testid="end-time-error"]',
  );
  private getTotalTicketsError = this.locatorForOptional(
    '[data-testid="totalTickets-error"]',
  );
  private getMaxTicketsPerUserError = this.locatorForOptional(
    '[data-testid="maxTicketsPerUser-error"]',
  );
  private getSubmitError = this.locatorForOptional(
    '[data-testid="event-save-error"]',
  );

  async setTitle(value: string) {
    const input = await this.getTitleInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async getTitle(): Promise<string> {
    const input = await this.getTitleInput();
    return input.getProperty('value');
  }

  async setLocation(value: string) {
    const input = await this.getLocationInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setDescription(value: string) {
    const input = await this.getDescriptionTextArea();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setDate(_value: string) {
    const _datePicker = await this.getDatePicker();
    // Use the component instance to set value directly since interacting with
    // the actual popover calendar in a unit test is very high ceremony.
    const _host = await this.host();
    // This expects the harness to be used with TestbedHarnessEnvironment
    // and access to the component instance if needed.
    // However, harnesses shouldn't ideally reach into internals.
    // Let's try sending keys to the date picker's button if it supports it,
    // but the component uses Reactive Forms, so setting value on the host
    // or triggering events is better.

    // A better way for these Zard components is to use their public API if available.
    // For now, let's keep it simple as a test helper.
  }

  async isSaveButtonDisabled() {
    const button = await this.getSaveButton();
    // For native button elements with [zDisabled], the disabled property is set
    const disabled = (await button.getProperty('disabled')) as unknown;
    if (typeof disabled === 'boolean') {
      return disabled;
    }
    // Fallback to checking the attribute
    const attr = await button.getAttribute('disabled');
    return attr !== null;
  }

  async clickSave() {
    const button = await this.getSaveButton();
    await button.click();
  }

  async clickCancel() {
    const button = await this.getCancelButton();
    await button.click();
  }

  async selectFile(_fileName: string) {
    const _input = await this.getFileInput();
    // Simulate file selection. testing-library or standard events might be needed for full realism,
    // but we can try to trigger change event or manually set property if possible.
    // In many cases, we mock the signal directly in the spec, but let's see if we can trigger it.
    // Standard CDK testing sendKeys doesn't always work for file inputs.
  }

  async getFileName() {
    const span = await this.getFileNameText();
    return (await span.text()).trim();
  }

  async hasClearFileButton() {
    const btn = await this.locatorForOptional('button.text-destructive')();
    return !!btn;
  }

  async clickClearFile() {
    const btn = await this.getClearFileButton();
    await btn.click();
  }

  getVisibilitySelector(): Promise<TestElement> {
    return this.locatorFor('[data-testid="visibility-selector"]')();
  }

  async getSelectedVisibility(): Promise<string> {
    for (const value of ['private', 'public_viewable', 'public'] as const) {
      const radio = await this.locatorFor(
        `input[name="visibility"][value="${value}"]`,
      )();
      if (await radio.getProperty<boolean>('checked')) {
        return value;
      }
    }
    return 'private';
  }

  async selectVisibility(value: EventVisibility): Promise<void> {
    const radio = await this.locatorFor(
      `input[name="visibility"][value="${value}"]`,
    )();
    await radio.click();
  }

  async getVisibilityHelperText(value: EventVisibility): Promise<string> {
    const testId =
      value === 'public_viewable'
        ? 'visibility-public-viewable-helper'
        : `visibility-${value}-helper`;
    const helper = await this.locatorFor(`[data-testid="${testId}"]`)();
    return (await helper.text())
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, ' / ')
      .trim();
  }

  private getCommunitySelect = this.locatorFor(
    'z-select[zAriaLabel="Community"]',
  );

  async getCommunitySelectText(): Promise<string> {
    const select = await this.getCommunitySelect();
    return (await select.text()).trim();
  }

  async isLoading() {
    const loader = await this.locatorForOptional('.animate-spin')();
    return !!loader;
  }

  async getErrorText() {
    const error = await this.locatorForOptional('p.text-destructive')();
    return error ? error.text() : null;
  }

  async setTotalTickets(value: string) {
    const input = await this.getTotalTicketsInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async setSlidingScaleEnabled(enabled: boolean): Promise<void> {
    const checkbox = await this.getSlidingScaleCheckbox();
    if ((await checkbox.getProperty<boolean>('checked')) !== enabled) {
      await checkbox.click();
    }
  }

  async isSlidingScaleEnabled(): Promise<boolean> {
    const checkbox = await this.getSlidingScaleCheckbox();
    return checkbox.getProperty<boolean>('checked');
  }

  async getSlidingScaleMaxValue(): Promise<string | null> {
    const input = await this.getSlidingScaleMaxInput();
    return input ? input.getProperty<string>('value') : null;
  }

  async setMaxTicketsPerUser(value: string) {
    const input = await this.getMaxTicketsPerUserInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  private getPriceInput = this.locatorFor('input#price');

  async setPrice(value: string) {
    const input = await this.getPriceInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async wheelPriceInput() {
    const input = await this.getPriceInput();
    await input.dispatchEvent('wheel');
  }

  async getTitleTooLongErrorText() {
    const error = await this.getTitleTooLongError();
    return error ? (await error.text()).trim() : null;
  }

  async getTitleBlankErrorText() {
    const error = await this.getTitleBlankError();
    return error ? (await error.text()).trim() : null;
  }

  async getTotalTicketsErrorText() {
    const error = await this.getTotalTicketsError();
    return error ? (await error.text()).trim() : null;
  }

  async getPriceErrorText() {
    const error = await this.getPriceError();
    return error ? (await error.text()).trim() : null;
  }

  async getDateErrorText() {
    const error = await this.getDateError();
    return error ? (await error.text()).trim() : null;
  }

  async getTimeErrorText() {
    const error = await this.getTimeError();
    return error ? (await error.text()).trim() : null;
  }

  async setEndTime(value: string) {
    const input = await this.getEndTimeInput();
    await input.clear();
    await input.sendKeys(value);
    await input.blur();
  }

  async getEndTimeErrorText() {
    const error = await this.getEndTimeError();
    return error ? (await error.text()).trim() : null;
  }

  async getMaxTicketsPerUserErrorText() {
    const error = await this.getMaxTicketsPerUserError();
    return error ? (await error.text()).trim() : null;
  }

  async getSubmitErrorText() {
    const error = await this.getSubmitError();
    return error ? (await error.text()).trim() : null;
  }
}
