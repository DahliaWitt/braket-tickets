import {ComponentHarness} from '@angular/cdk/testing';

export class MarketingAnnouncementCardHarness extends ComponentHarness {
  static hostSelector = 'app-marketing-announcement-card';

  private getCard = this.locatorFor(
    '[data-testid="marketing-announcement-card"]',
  );
  private getEmptyState = this.locatorForOptional(
    '[data-testid="marketing-announcement-empty"]',
  );
  private getLoadingState = this.locatorForOptional(
    '[data-testid="marketing-announcement-loading"]',
  );
  private getStatus = this.locatorForOptional(
    '[data-testid="marketing-announcement-status"]',
  );
  private getCancelButton = this.locatorForOptional(
    '[data-testid="marketing-cancel-scheduled"]',
  );
  private getScheduleDateInput = this.locatorForOptional(
    '[data-testid="marketing-schedule-date"]',
  );
  private getScheduleTimeInput = this.locatorForOptional(
    '[data-testid="marketing-schedule-time"]',
  );
  private getScheduleDateLabel = this.locatorForOptional(
    '[data-testid="marketing-schedule-date-label"]',
  );
  private getScheduleTimeLabel = this.locatorForOptional(
    '[data-testid="marketing-schedule-time-label"]',
  );
  private getScheduleSubmitButton = this.locatorForOptional(
    '[data-testid="marketing-schedule-submit"]',
  );
  private getQueueNowButton = this.locatorForOptional(
    '[data-testid="marketing-queue-now"]',
  );
  private getTrackingSummary = this.locatorForOptional(
    '[data-testid="marketing-announcement-tracking"]',
  );
  private getTrackingDisclaimer = this.locatorForOptional(
    '[data-testid="marketing-announcement-tracking-disclaimer"]',
  );
  private getAudienceScopeFieldset = this.locatorForOptional(
    '[data-testid="audience-scope-fieldset"]',
  );
  private getCommunityRadio = this.locatorForOptional(
    'input[name="audienceScope"][value="community"]',
  );
  private getCommunityAndTrustedRadio = this.locatorForOptional(
    'input[name="audienceScope"][value="community_and_trusted"]',
  );
  private getRecipientBreakdown = this.locatorForOptional(
    '[data-testid="marketing-recipient-breakdown"]',
  );

  async getEmptyText(): Promise<string | null> {
    const element = await this.getEmptyState();
    return element ? element.text() : null;
  }

  async getLoadingText(): Promise<string | null> {
    const element = await this.getLoadingState();
    return element ? element.text() : null;
  }

  async getStatusText(): Promise<string | null> {
    const element = await this.getStatus();
    return element ? element.text() : null;
  }

  async hasCancelButton(): Promise<boolean> {
    return (await this.getCancelButton()) !== null;
  }

  async hasScheduleForm(): Promise<boolean> {
    return (await this.getScheduleDateInput()) !== null;
  }

  async hasQueueNowButton(): Promise<boolean> {
    return (await this.getQueueNowButton()) !== null;
  }

  async getScheduleDateValue(): Promise<string | null> {
    const input = await this.getScheduleDateInput();
    return input ? input.getProperty('value') : null;
  }

  async getScheduleDateLabelText(): Promise<string | null> {
    const label = await this.getScheduleDateLabel();
    return label ? (await label.text()).trim() : null;
  }

  async getScheduleTimeLabelText(): Promise<string | null> {
    const label = await this.getScheduleTimeLabel();
    return label ? (await label.text()).trim() : null;
  }

  /** True when the date label's `for` points at the date input's id. */
  async isScheduleDateLabelAssociated(): Promise<boolean> {
    const label = await this.getScheduleDateLabel();
    const input = await this.getScheduleDateInput();
    if (!label || !input) return false;
    const forAttr = await label.getAttribute('for');
    const inputId = await input.getAttribute('id');
    return forAttr !== null && forAttr === inputId;
  }

  /** True when the time label's `for` points at the time input's id. */
  async isScheduleTimeLabelAssociated(): Promise<boolean> {
    const label = await this.getScheduleTimeLabel();
    const input = await this.getScheduleTimeInput();
    if (!label || !input) return false;
    const forAttr = await label.getAttribute('for');
    const inputId = await input.getAttribute('id');
    return forAttr !== null && forAttr === inputId;
  }

  async getScheduleTimeValue(): Promise<string | null> {
    const input = await this.getScheduleTimeInput();
    return input ? input.getProperty('value') : null;
  }

  async clickScheduleSubmit(): Promise<void> {
    const button = await this.getScheduleSubmitButton();
    await button?.click();
  }

  async getTrackingText(): Promise<string | null> {
    const element = await this.getTrackingSummary();
    return element ? element.text() : null;
  }

  async getTrackingDisclaimerText(): Promise<string | null> {
    const element = await this.getTrackingDisclaimer();
    return element ? element.text() : null;
  }

  async hasAudienceScopeFieldset(): Promise<boolean> {
    return (await this.getAudienceScopeFieldset()) !== null;
  }

  async isCommunityRadioChecked(): Promise<boolean> {
    const input = await this.getCommunityRadio();
    if (!input) return false;
    return input.getProperty<boolean>('checked');
  }

  async isCommunityAndTrustedRadioChecked(): Promise<boolean> {
    const radio = await this.getCommunityAndTrustedRadio();
    if (!radio) return false;
    return radio.getProperty<boolean>('checked');
  }

  async clickCommunityAndTrustedRadio(): Promise<void> {
    const radio = await this.getCommunityAndTrustedRadio();
    await radio?.click();
  }

  async getRecipientBreakdownText(): Promise<string | null> {
    const element = await this.getRecipientBreakdown();
    return element ? element.text() : null;
  }

  async usesEmailCardSpacingContract(): Promise<boolean> {
    const host = await this.host();
    const card = await this.getCard();

    return (
      (await host.hasClass('block')) &&
      (await card.hasClass('py-0')) &&
      (await card.hasClass('[&>[data-slot=card-content]]:p-6'))
    );
  }
}
