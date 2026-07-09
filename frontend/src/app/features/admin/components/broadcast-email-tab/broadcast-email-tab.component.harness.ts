import {ComponentHarness} from '@angular/cdk/testing';
import {RichTextEditorHarness} from '../rich-text-editor/rich-text-editor.component.harness';

export class BroadcastEmailTabComponentHarness extends ComponentHarness {
  static hostSelector = 'app-broadcast-email-tab';

  private getSubjectInput = this.locatorFor(
    '[data-testid="broadcast-subject"]',
  );
  private getMessageEditor = this.locatorFor(RichTextEditorHarness);
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

  async setSubject(value: string): Promise<void> {
    const input = await this.getSubjectInput();
    await input.clear();
    await input.sendKeys(value);
  }

  async getSubjectValue(): Promise<string> {
    const input = await this.getSubjectInput();
    return input.getProperty<string>('value');
  }

  /** Returns the CDK harness for the embedded rich-text message editor. */
  async getMessageEditorHarness(): Promise<RichTextEditorHarness> {
    return this.getMessageEditor();
  }

  /** True when the rich-text message editor is rendered in the compose form. */
  async hasMessageEditor(): Promise<boolean> {
    try {
      await this.getMessageEditor();
      return true;
    } catch {
      return false;
    }
  }

  /** Serialized ProseMirror JSON currently held by the message editor. */
  async getMessageJson(): Promise<string> {
    return (await this.getMessageEditor()).getSerializedJson();
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
