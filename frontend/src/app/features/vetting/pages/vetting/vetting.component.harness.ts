import {ComponentHarness} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';
import {ZardButtonComponentHarness} from '@ui/components/primitives/button/button.component.harness';

export class VettingComponentHarness extends ComponentHarness {
  static hostSelector = 'app-vetting';

  protected getReferralInput = this.locatorFor('input[id="referral"]');
  protected getWhyJoinInput = this.locatorFor('textarea[id="whyJoin"]');
  protected getSocialsInput = this.locatorFor('input[id="socials"]');
  protected getConductAgreement = this.locatorForOptional(
    '[data-testid="conduct-agreement"]',
  );
  protected getConductCheckbox = this.locatorFor(
    '[data-testid="conduct-checkbox"]',
  );

  async getSubmitButton(): Promise<ZardButtonComponentHarness> {
    // Find button by ID attribute on z-button element
    const buttons = await this.locatorForAll(ZardButtonComponentHarness)();
    for (const button of buttons) {
      const host = await button.host();
      const id = await host.getAttribute('id');
      if (id === 'submit-btn') {
        return button;
      }
    }
    // Fallback: find by text
    for (const button of buttons) {
      const text = await button.getText();
      if (text.includes('Submit Application') || text.includes('Submitting')) {
        return button;
      }
    }
    throw new Error('Submit button not found');
  }

  // Existing application states
  protected getPendingState = this.locatorForOptional(
    '[data-testid="vetting-pending-state"]',
  );
  protected getApprovedState = this.locatorForOptional(
    '[data-testid="vetting-approved-state"]',
  );
  protected getRejectedState = this.locatorForOptional(
    '[data-testid="vetting-rejected-state"]',
  );
  protected getRejectedStateReason = this.locatorForOptional(
    '[data-testid="vetting-rejected-state-reason"]',
  );
  protected getUnavailableState = this.locatorForOptional(
    '[data-testid="vetting-unavailable-state"]',
  );
  protected getGateLoadingState = this.locatorForOptional(
    '[data-testid="vetting-gate-loading-state"]',
  );
  protected getGateErrorState = this.locatorForOptional(
    '[data-testid="vetting-gate-error-state"]',
  );

  // Error messages - IDs match template
  protected getReferralError = this.locatorForOptional(
    '#referral-required-error',
  );
  protected getWhyJoinError = this.locatorForOptional(
    '#whyJoin-required-error',
  );
  protected getWhyJoinMinError = this.locatorForOptional(
    '#whyJoin-minlength-error',
  );
  protected getWhyJoinMaxError = this.locatorForOptional(
    '#whyJoin-maxlength-error',
  );
  protected getReferralMaxError = this.locatorForOptional(
    '#referral-maxlength-error',
  );
  protected getConductError = this.locatorForOptional('#conduct-error');
  protected getFormError = this.locatorForOptional('#form-error');

  async setReferral(value: string) {
    const input = await this.getReferralInput();
    await input.clear();
    if (value) {
      await input.sendKeys(value);
    }
    await input.blur();
  }

  async setWhyJoin(value: string) {
    const input = await this.getWhyJoinInput();
    await input.clear();
    if (value) {
      await input.sendKeys(value);
    }
    await input.blur();
  }

  async setSocials(value: string) {
    const input = await this.getSocialsInput();
    await input.clear();
    if (value) {
      await input.sendKeys(value);
    }
    await input.blur();
  }

  async toggleConduct() {
    // Wait for the conduct checkbox to render (Convex data + zoneless CD)
    await waitForHarnessCondition(
      async () =>
        (await this.locatorForOptional(
          '[data-testid="conduct-checkbox"]',
        )()) !== null,
      {description: 'conduct checkbox'},
    );
    const checkbox = await this.getConductCheckbox();
    await checkbox.click();
    await checkbox.blur();
  }

  async clickBooleanRadio(
    questionId: string,
    value: 'true' | 'false',
  ): Promise<void> {
    const option = value === 'true' ? 'yes' : 'no';
    const radio = await this.locatorFor(
      `[data-testid="${questionId}-${option}-radio"]`,
    )();
    await radio.click();
    await radio.blur();
  }

  async clickBooleanLabel(
    questionId: string,
    value: 'true' | 'false',
  ): Promise<void> {
    const option = value === 'true' ? 'yes' : 'no';
    const label = await this.locatorFor(
      `[data-testid="${questionId}-${option}-label"]`,
    )();
    await label.click();
  }

  async isBooleanRadioSelected(
    questionId: string,
    value: 'true' | 'false',
  ): Promise<boolean> {
    const option = value === 'true' ? 'yes' : 'no';
    const radio = await this.locatorFor(
      `[data-testid="${questionId}-${option}-radio"]`,
    )();
    return radio.getProperty<boolean>('checked');
  }

  async isCheckboxOptionSelected(
    questionId: string,
    optionIndex: number,
  ): Promise<boolean> {
    const checkbox = await this.locatorFor(
      `input[id="${questionId}-${optionIndex}"]`,
    )();
    return checkbox.getProperty<boolean>('checked');
  }

  async clickCheckboxOption(
    questionId: string,
    optionIndex: number,
  ): Promise<void> {
    const checkbox = await this.locatorFor(
      `input[id="${questionId}-${optionIndex}"]`,
    )();
    await checkbox.click();
    await checkbox.blur();
  }

  async submit() {
    const btn = await this.getSubmitButton();
    await btn.click();
  }

  async getSubmitButtonText(): Promise<string> {
    const btn = await this.getSubmitButton();
    return btn.getText();
  }

  async isSubmitDisabled(): Promise<boolean> {
    try {
      const btn = await this.getSubmitButton();
      return await btn.isDisabled();
    } catch {
      // Button not found means it's probably disabled/not rendered
      return true;
    }
  }

  async getReferralErrorText() {
    const el = await this.getReferralError();
    return el ? el.text() : null;
  }

  async getReferralInputClasses(): Promise<string> {
    const input = await this.getReferralInput();
    return (await input.getAttribute('class')) ?? '';
  }

  async getWhyJoinInputClasses(): Promise<string> {
    const input = await this.getWhyJoinInput();
    return (await input.getAttribute('class')) ?? '';
  }

  async getWhyJoinErrorText() {
    const el = await this.getWhyJoinError();
    return el ? el.text() : null;
  }

  async getWhyJoinMinErrorText() {
    const el = await this.getWhyJoinMinError();
    return el ? el.text() : null;
  }

  async getWhyJoinMaxErrorText() {
    const el = await this.getWhyJoinMaxError();
    return el ? el.text() : null;
  }

  async getReferralMaxErrorText() {
    const el = await this.getReferralMaxError();
    return el ? el.text() : null;
  }

  async getConductErrorText() {
    const el = await this.getConductError();
    return el ? el.text() : null;
  }

  async getFormErrorText() {
    const el = await this.getFormError();
    return el ? el.text() : null;
  }

  async isPendingStateVisible(): Promise<boolean> {
    const el = await this.getPendingState();
    return el !== null;
  }

  async isReferralInputVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('input[id="referral"]')();
    return el !== null;
  }

  async isWhyJoinInputVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('textarea[id="whyJoin"]')();
    return el !== null;
  }

  async isSubmitButtonVisible(): Promise<boolean> {
    const el = await this.locatorForOptional('#submit-btn')();
    return el !== null;
  }

  async isApprovedStateVisible(): Promise<boolean> {
    const el = await this.getApprovedState();
    return el !== null;
  }

  async getPendingStateText(): Promise<string | null> {
    const el = await this.getPendingState();
    return el ? el.text() : null;
  }

  async getApprovedStateText(): Promise<string | null> {
    const el = await this.getApprovedState();
    return el ? el.text() : null;
  }

  async isRejectedStateVisible(): Promise<boolean> {
    const el = await this.getRejectedState();
    return el !== null;
  }

  async getRejectedStateText(): Promise<string | null> {
    const el = await this.getRejectedState();
    return el ? el.text() : null;
  }

  async getRejectedStateReasonText(): Promise<string | null> {
    const el = await this.getRejectedStateReason();
    return el ? el.text() : null;
  }

  async isUnavailableStateVisible(): Promise<boolean> {
    const el = await this.getUnavailableState();
    return el !== null;
  }

  async isGateLoadingStateVisible(): Promise<boolean> {
    const el = await this.getGateLoadingState();
    return el !== null;
  }

  async isGateErrorStateVisible(): Promise<boolean> {
    const el = await this.getGateErrorState();
    return el !== null;
  }

  async getGateErrorStateText(): Promise<string | null> {
    const el = await this.getGateErrorState();
    return el ? el.text() : null;
  }

  async getUnavailableStateText(): Promise<string | null> {
    const el = await this.getUnavailableState();
    return el ? el.text() : null;
  }

  async isConductAgreementVisible(): Promise<boolean> {
    const agreement = await this.getConductAgreement();
    return agreement !== null;
  }

  async isCodeOfConductButtonVisible(): Promise<boolean> {
    const button = await this.locatorForOptional(
      '[data-testid="code-of-conduct-button"]',
    )();
    return button !== null;
  }
}
