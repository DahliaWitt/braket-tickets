import {ComponentHarness} from '@angular/cdk/testing';

export class AdminCommunityEditorComponentHarness extends ComponentHarness {
  static hostSelector = 'app-admin-community-editor';

  private getNameInput = this.locatorFor('#name');
  private getSlugInput = this.locatorFor('#slug');
  private getEmailInput = this.locatorFor('#email');
  private getContactInfoInput = this.locatorFor('#contactInfo');
  private getDescriptionTextarea = this.locatorFor('#description');
  private getPublicDirectoryToggle = this.locatorFor(
    '[data-testid="public-directory-toggle"]',
  );
  private getPublishToggle = this.locatorFor(
    '[data-testid="community-publish-toggle"]',
  );
  private getSaveButton = this.locatorFor('[data-testid="save-community"]');
  private getAddQuestionButton = this.locatorFor(
    '[data-testid="add-question"]',
  );
  private getVettingQuestions = this.locatorForAll(
    '[data-testid="vetting-question"]',
  );
  private getVettingEmpty = this.locatorForOptional(
    '[data-testid="vetting-empty"]',
  );
  private getStripeSection = this.locatorForOptional(
    '[data-testid="stripe-connect-section"]',
  );
  private getStripeConnectedStatus = this.locatorForOptional(
    '[data-testid="stripe-connected-status"]',
  );
  private getStripeOnboardingIncomplete = this.locatorForOptional(
    '[data-testid="stripe-onboarding-incomplete"]',
  );
  private getConnectWithStripeBtn = this.locatorForOptional(
    '[data-testid="connect-with-stripe-btn"]',
  );
  private getStripeConnectEmbed = this.locatorForOptional(
    '[data-testid="stripe-connect-embed"]',
  );
  private getStripeError = this.locatorForOptional(
    '[data-testid="stripe-error"]',
  );
  private getPlatformOrganizerSection = this.locatorForOptional(
    '[data-testid="platform-organizer-section"]',
  );
  private getPlatformOrganizerToggle = this.locatorForOptional(
    '[data-testid="platform-organizer-toggle"]',
  );
  private getPlatformOrganizerBadge = this.locatorForOptional(
    '[data-testid="platform-organizer-badge"]',
  );
  private getPlatformOrganizerError = this.locatorForOptional(
    '[data-testid="platform-organizer-error"]',
  );

  async setName(value: string): Promise<void> {
    const input = await this.getNameInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getNameValue(): Promise<string> {
    const input = await this.getNameInput();
    return input.getProperty<string>('value');
  }

  async setSlug(value: string): Promise<void> {
    const input = await this.getSlugInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getSlugValue(): Promise<string> {
    const input = await this.getSlugInput();
    return input.getProperty<string>('value');
  }

  async setEmail(value: string): Promise<void> {
    const input = await this.getEmailInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async setContactInfo(value: string): Promise<void> {
    const input = await this.getContactInfoInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async setDescription(value: string): Promise<void> {
    const textarea = await this.getDescriptionTextarea();
    await textarea.clear();
    await textarea.sendKeys(value);
  }

  async clickPublicDirectoryToggle(): Promise<void> {
    const toggle = await this.getPublicDirectoryToggle();
    await toggle.click();
  }

  async isPublicDirectoryEnabled(): Promise<boolean> {
    const toggle = await this.getPublicDirectoryToggle();
    const checked = await toggle.getAttribute('aria-checked');
    return checked === 'true';
  }

  async clickPublishToggle(): Promise<void> {
    const toggle = await this.getPublishToggle();
    await toggle.click();
  }

  async isPublished(): Promise<boolean> {
    const toggle = await this.getPublishToggle();
    const pressed = await toggle.getAttribute('aria-pressed');
    return pressed === 'true';
  }

  async isSaveDisabled(): Promise<boolean> {
    const button = await this.getSaveButton();
    return (await button.getAttribute('disabled')) !== null;
  }

  async clickAddQuestion(): Promise<void> {
    const button = await this.getAddQuestionButton();
    await button.click();
  }

  async getVettingQuestionCount(): Promise<number> {
    const questions = await this.getVettingQuestions();
    return questions.length;
  }

  async isVettingEmptyVisible(): Promise<boolean> {
    return (await this.getVettingEmpty()) !== null;
  }

  async setQuestionText(index: number, value: string): Promise<void> {
    const input = await this.locatorFor(`#question-${index}`)();
    await input.clear();
    await input.sendKeys(value);
  }

  async isStripeConnected(): Promise<boolean> {
    return (await this.getStripeConnectedStatus()) !== null;
  }

  async isStripeOnboardingIncomplete(): Promise<boolean> {
    return (await this.getStripeOnboardingIncomplete()) !== null;
  }

  async isConnectWithStripeButtonVisible(): Promise<boolean> {
    return (await this.getConnectWithStripeBtn()) !== null;
  }

  async hasStripeConnectEmbed(): Promise<boolean> {
    return (await this.getStripeConnectEmbed()) !== null;
  }

  async clickConnectWithStripe(): Promise<void> {
    const btn = await this.getConnectWithStripeBtn();
    if (!btn) throw new Error('Connect with Stripe button not found');
    await btn.click();
  }

  async getStripeErrorText(): Promise<string | null> {
    const el = await this.getStripeError();
    return el ? el.text() : null;
  }

  async isStripeSectionVisible(): Promise<boolean> {
    return (await this.getStripeSection()) !== null;
  }

  async isPlatformOrganizerSectionVisible(): Promise<boolean> {
    return (await this.getPlatformOrganizerSection()) !== null;
  }

  async isPlatformOrganizerEnabled(): Promise<boolean> {
    const toggle = await this.getPlatformOrganizerToggle();
    if (!toggle) return false;
    const checked = await toggle.getAttribute('aria-checked');
    return checked === 'true';
  }

  async clickPlatformOrganizerToggle(): Promise<void> {
    const toggle = await this.getPlatformOrganizerToggle();
    if (!toggle) throw new Error('Platform organizer toggle not found');
    await toggle.click();
  }

  async isPlatformOrganizerBadgeVisible(): Promise<boolean> {
    return (await this.getPlatformOrganizerBadge()) !== null;
  }

  async getPlatformOrganizerErrorText(): Promise<string | null> {
    const el = await this.getPlatformOrganizerError();
    return el ? el.text() : null;
  }
}
