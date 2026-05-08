import {ComponentHarness} from '@angular/cdk/testing';

export type FooterFeedbackCategory =
  | 'general_feedback'
  | 'bug'
  | 'feature_request';

export class FooterFeedbackDialogHarness extends ComponentHarness {
  static hostSelector = 'app-footer-feedback-dialog';

  private readonly getMessageInput = this.locatorFor(
    '[data-testid="feedback-message"]',
  );
  private readonly getSubmitButton = this.locatorFor(
    '[data-testid="feedback-submit"]',
  );
  private readonly getCancelButton = this.locatorFor(
    '[data-testid="feedback-cancel"]',
  );

  private categoryButton(value: FooterFeedbackCategory) {
    return this.locatorFor(`[data-testid="feedback-category-${value}"]`);
  }

  async setMessage(value: string): Promise<void> {
    const textarea = await this.getMessageInput();
    await textarea.clear();
    await textarea.sendKeys(value);
    await textarea.dispatchEvent('input');
  }

  async clickCategory(value: FooterFeedbackCategory): Promise<void> {
    const categoryButton = await this.categoryButton(value)();
    await categoryButton.click();
  }

  async isCategorySelected(value: FooterFeedbackCategory): Promise<boolean> {
    const categoryButton = await this.categoryButton(value)();
    const pressed = await categoryButton.getAttribute('aria-pressed');
    return pressed === 'true';
  }

  async categoryVariant(value: FooterFeedbackCategory): Promise<string | null> {
    const categoryButton = await this.categoryButton(value)();
    return categoryButton.getAttribute('data-type');
  }

  async hasCategorySelectedState(
    value: FooterFeedbackCategory,
  ): Promise<boolean> {
    const categoryButton = await this.categoryButton(value)();
    return (await categoryButton.getAttribute('data-selected')) !== null;
  }

  async categoryClasses(value: FooterFeedbackCategory): Promise<string> {
    const categoryButton = await this.categoryButton(value)();
    return (await categoryButton.getAttribute('class')) ?? '';
  }

  async submitDisabled(): Promise<boolean> {
    const submitButton = await this.getSubmitButton();
    return (await submitButton.getAttribute('disabled')) !== null;
  }

  async clickSubmit(): Promise<void> {
    const submitButton = await this.getSubmitButton();
    await submitButton.click();
  }

  async clickCancel(): Promise<void> {
    const cancelButton = await this.getCancelButton();
    await cancelButton.click();
  }
}
