import {ComponentHarness} from '@angular/cdk/testing';

export class BroadcastEmailTabComponentHarness extends ComponentHarness {
  static hostSelector = 'app-broadcast-email-tab';

  private getSubjectInput = this.locatorFor(
    '[data-testid="broadcast-subject"]',
  );
  private getMessageTextarea = this.locatorFor(
    '[data-testid="broadcast-message"]',
  );
  private getSendButton = this.locatorFor('[data-testid="send-broadcast"]');
  private getComposeCard = this.locatorFor(
    '[data-testid="broadcast-email-card"]',
  );
  private getRecipientCountEl = this.locatorForOptional(
    '[data-testid="broadcast-recipient-count"]',
  );
  private getLengthErrorEl = this.locatorForOptional(
    '[data-testid="broadcast-length-error"]',
  );
  private getAudienceErrorEl = this.locatorForOptional(
    '[data-testid="broadcast-audience-error"]',
  );
  private getAudienceLoadingEl = this.locatorForOptional(
    '[data-testid="broadcast-audience-loading"]',
  );
  private getExceedsCapEl = this.locatorForOptional(
    '[data-testid="broadcast-exceeds-cap"]',
  );
  private getIncludeExternalContainer = this.locatorForOptional(
    '[data-testid="broadcast-include-external"]',
  );
  private getIncludeExternalSwitch = this.locatorFor(
    '[data-testid="broadcast-include-external-switch"] button[role="switch"]',
  );
  private getIncludeExternalCountEl = this.locatorForOptional(
    '[data-testid="broadcast-include-external-count"]',
  );
  private getHistoryCard = this.locatorFor(
    '[data-testid="broadcast-history-card"]',
  );
  private getHistoryEmptyEl = this.locatorForOptional(
    '[data-testid="broadcast-history-empty"]',
  );
  private getHistoryEntries = this.locatorForAll(
    '[data-testid="broadcast-history-entry"]',
  );
  private getHistoryErrorEl = this.locatorForOptional(
    '[data-testid="broadcast-history-error-state"]',
  );
  private getCatchupNoteEl = this.locatorForOptional(
    '[data-testid="broadcast-catchup-note"]',
  );

  async setSubject(value: string): Promise<void> {
    const input = await this.getSubjectInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getSubjectValue(): Promise<string> {
    const input = await this.getSubjectInput();
    return input.getProperty<string>('value');
  }

  async setMessage(value: string): Promise<void> {
    const textarea = await this.getMessageTextarea();
    await textarea.clear();
    await textarea.sendKeys(value);
  }

  async getMessageValue(): Promise<string> {
    const textarea = await this.getMessageTextarea();
    return textarea.getProperty<string>('value');
  }

  async isSendButtonDisabled(): Promise<boolean> {
    const button = await this.getSendButton();
    return button.getProperty<boolean>('disabled');
  }

  async clickSendButton(): Promise<void> {
    const button = await this.getSendButton();
    await button.click();
  }

  async getRecipientCount(): Promise<string | null> {
    const el = await this.getRecipientCountEl();
    return el ? el.text() : null;
  }

  async hasLengthError(): Promise<boolean> {
    return (await this.getLengthErrorEl()) !== null;
  }

  async hasAudienceError(): Promise<boolean> {
    return (await this.getAudienceErrorEl()) !== null;
  }

  async isAudienceLoading(): Promise<boolean> {
    return (await this.getAudienceLoadingEl()) !== null;
  }

  async isExceedingCap(): Promise<boolean> {
    return (await this.getExceedsCapEl()) !== null;
  }

  async isIncludeExternalToggleVisible(): Promise<boolean> {
    return (await this.getIncludeExternalContainer()) !== null;
  }

  async isIncludeExternalToggled(): Promise<boolean> {
    const toggle = await this.getIncludeExternalSwitch();
    return (await toggle.getAttribute('aria-checked')) === 'true';
  }

  async clickIncludeExternalToggle(): Promise<void> {
    const toggle = await this.getIncludeExternalSwitch();
    await toggle.click();
  }

  async getIncludeExternalCountText(): Promise<string | null> {
    const el = await this.getIncludeExternalCountEl();
    return el ? el.text() : null;
  }

  async isHistoryEmpty(): Promise<boolean> {
    return (await this.getHistoryEmptyEl()) !== null;
  }

  async getHistoryEntryCount(): Promise<number> {
    const entries = await this.getHistoryEntries();
    return entries.length;
  }

  async hasHistoryError(): Promise<boolean> {
    return (await this.getHistoryErrorEl()) !== null;
  }

  async getCatchupNoteText(): Promise<string | null> {
    const el = await this.getCatchupNoteEl();
    return el ? el.text() : null;
  }

  async isHistoryCardPresent(): Promise<boolean> {
    try {
      await this.getHistoryCard();
      return true;
    } catch {
      return false;
    }
  }

  async usesEmailCardSpacingContract(): Promise<boolean> {
    const host = await this.host();
    const composeCard = await this.getComposeCard();
    const historyCard = await this.getHistoryCard();
    const spacingClasses = ['py-0', '[&>[data-slot=card-content]]:p-6'];

    return (
      (await host.hasClass('block')) &&
      (
        await Promise.all(
          [composeCard, historyCard].flatMap((card) =>
            spacingClasses.map((className) => card.hasClass(className)),
          ),
        )
      ).every(Boolean)
    );
  }
}
