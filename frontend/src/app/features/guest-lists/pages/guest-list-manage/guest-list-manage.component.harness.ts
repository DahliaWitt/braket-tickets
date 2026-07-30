import {ComponentHarness} from '@angular/cdk/testing';

export class GuestListManageComponentHarness extends ComponentHarness {
  static hostSelector = 'app-guest-list-manage';

  async hasEventDetails(): Promise<boolean> {
    return (
      (await this.locatorForOptional('[data-testid="guest-list-event"]')()) !==
      null
    );
  }

  async getEventDetailsText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-event"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async getUnavailableText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-unavailable"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async getLoadFailureText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-load-failure"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async retryLoading(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-retry-loading"]')()
    ).click();
  }

  async getUsageText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-usage"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async isAddDisabled(): Promise<boolean> {
    const button = await this.locatorFor('[data-testid="guest-list-add"]')();
    return (await button.getAttribute('disabled')) !== null;
  }

  async getAddState(): Promise<{disabled: boolean; text: string}> {
    const button = await this.locatorFor('[data-testid="guest-list-add"]')();
    return {
      disabled: (await button.getAttribute('disabled')) !== null,
      text: (await button.text()).trim(),
    };
  }

  async fillGuest(name: string, email: string): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-name"]')()
    ).sendKeys(name);
    await (
      await this.locatorFor('[data-testid="guest-list-email"]')()
    ).sendKeys(email);
  }

  async getGuestFormValues(): Promise<{name: string; email: string}> {
    const name = await this.locatorFor('[data-testid="guest-list-name"]')();
    const email = await this.locatorFor('[data-testid="guest-list-email"]')();
    return {
      name: await name.getProperty('value'),
      email: await email.getProperty('value'),
    };
  }

  async getActionErrorText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-action-error"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async getActionNoticeText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-list-action-notice"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async submitGuest(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-add-form"]')()
    ).dispatchEvent('submit');
  }

  async getGuestFormErrors(): Promise<string[]> {
    const errors = await this.locatorForAll(
      '[data-testid="guest-list-field-error"]',
    )();
    return Promise.all(
      errors.map(async (error) => (await error.text()).trim()),
    );
  }

  async getGuestRows(): Promise<string[]> {
    const rows = await this.locatorForAll('[data-testid="guest-list-guest"]')();
    return Promise.all(rows.map(async (row) => (await row.text()).trim()));
  }

  async clickRetry(): Promise<void> {
    await (await this.locatorFor('[data-testid="guest-list-retry"]')()).click();
  }

  async getRetryState(): Promise<{disabled: boolean; text: string}> {
    const button = await this.locatorFor('[data-testid="guest-list-retry"]')();
    return {
      disabled: (await button.getAttribute('disabled')) !== null,
      text: (await button.text()).trim(),
    };
  }

  async clickEdit(): Promise<void> {
    await (await this.locatorFor('[data-testid="guest-list-edit"]')()).click();
  }

  async getEditState(): Promise<{disabled: boolean; text: string}> {
    const button = await this.locatorFor('[data-testid="guest-list-edit"]')();
    return {
      disabled: (await button.getAttribute('disabled')) !== null,
      text: (await button.text()).trim(),
    };
  }

  async isEditing(): Promise<boolean> {
    return (
      (await this.locatorForOptional(
        '[data-testid="guest-list-cancel-edit"]',
      )()) !== null
    );
  }

  async openRemovalConfirmation(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-remove"]')()
    ).click();
  }

  async clickRemove(): Promise<void> {
    await this.openRemovalConfirmation();
    await this.confirmRemoval();
  }

  async getRemovalConfirmationText(): Promise<string | null> {
    const confirmation = await this.locatorForOptional(
      '[data-testid="guest-list-remove-confirmation"]',
    )();
    return confirmation ? (await confirmation.text()).trim() : null;
  }

  async confirmRemoval(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-confirm-remove"]')()
    ).click();
  }

  async cancelRemoval(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-cancel-remove"]')()
    ).click();
  }

  async isCancelRemovalFocused(): Promise<boolean> {
    return (
      await this.locatorFor('[data-testid="guest-list-cancel-remove"]')()
    ).isFocused();
  }

  async getRemovalConfirmationState(): Promise<{
    confirmDisabled: boolean;
    confirmBusy: boolean;
    cancelDisabled: boolean;
  }> {
    const confirm = await this.locatorFor(
      '[data-testid="guest-list-confirm-remove"]',
    )();
    const cancel = await this.locatorFor(
      '[data-testid="guest-list-cancel-remove"]',
    )();
    return {
      confirmDisabled: (await confirm.getAttribute('disabled')) !== null,
      confirmBusy: (await confirm.getAttribute('aria-busy')) === 'true',
      cancelDisabled: (await cancel.getAttribute('disabled')) !== null,
    };
  }

  async isRemoveFocused(): Promise<boolean> {
    return (
      await this.locatorFor('[data-testid="guest-list-remove"]')()
    ).isFocused();
  }

  async isGuestListHeadingFocused(): Promise<boolean> {
    return (
      await this.locatorFor('[data-testid="guest-list-heading"]')()
    ).isFocused();
  }

  async getRemoveState(): Promise<{disabled: boolean; text: string}> {
    const button = await this.locatorFor('[data-testid="guest-list-remove"]')();
    return {
      disabled: (await button.getAttribute('disabled')) !== null,
      text: (await button.text()).trim(),
    };
  }

  async hasLoadMoreGuests(): Promise<boolean> {
    return (
      (await this.locatorForOptional(
        '[data-testid="guest-list-load-more"]',
      )()) !== null
    );
  }

  async loadMoreGuests(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-load-more"]')()
    ).click();
  }

  async clickForget(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-list-forget"]')()
    ).click();
  }
}
