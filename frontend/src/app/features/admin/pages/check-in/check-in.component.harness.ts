import {ComponentHarness} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class CheckInComponentHarness extends ComponentHarness {
  static hostSelector = 'app-check-in';

  protected getEventSelector = this.locatorFor(
    'select[aria-label="Select event"]',
  );
  protected getSelectedEventOption = this.locatorForOptional(
    'select[aria-label="Select event"] option:checked',
  );
  protected getTabs = this.locatorForAll('[role="tab"]');
  protected getSearchInput = this.locatorFor(
    'input[aria-label="Filter attendees"]',
  );
  // Camera buttons use z-button custom element; not needed for spec (camera functionality tested separately)
  protected getActionButtons = this.locatorForAll('z-button');
  protected getVideoElement = this.locatorForOptional('video');
  // Camera error has no testid; <p class="text-destructive"> inside a destructive alert div
  protected getCameraError = this.locatorForOptional('.bg-destructive\\/5 p');
  protected getLastResult = this.locatorForOptional('[role="alert"]');
  protected getListItems = this.locatorForAll('[data-testid="buyer-entry"]');
  protected getCardContents = this.locatorForAll('[data-slot="card-content"]');
  protected getAttendeeListScrollContainer =
    this.locatorFor('.overflow-y-auto');
  protected getCheckInButtons = this.locatorForAll(
    '[data-testid="buyer-entry"] button[aria-label^="Check in"]',
  );
  protected getManualFeedback = this.locatorForOptional(
    '[data-testid="manual-check-in-feedback"]',
  );
  protected getSoundToggle = this.locatorForOptional(
    '[data-testid="sound-toggle"]',
  );
  protected getEnableSoundButton = this.locatorForOptional(
    '[data-testid="enable-sound-button"]',
  );
  protected getEventEmptyState = this.locatorForOptional(
    '[data-testid="event-empty-state"]',
  );
  protected getScannerPanel = this.locatorForOptional('app-check-in-scanner');
  protected getImportedSection = this.locatorForOptional(
    '[data-testid="imported-section"]',
  );
  protected getImportedEntries = this.locatorForAll(
    '[data-testid="imported-entry"]',
  );
  protected getImportedSourceBadges = this.locatorForAll(
    '[data-testid="imported-source-badge"]',
  );
  protected getImportedSourceCounts = this.locatorForOptional(
    '[data-testid="imported-source-counts"]',
  );
  protected getImportedCheckInButtons = this.locatorForAll(
    '[data-testid="imported-entry"] button[aria-label^="Check in external"]',
  );

  async selectEventByLabel(label: string): Promise<void> {
    await waitForHarnessCondition(
      async () => {
        const select = await this.getEventSelector();
        // CDK TestElement.selectOptions() only takes indexes — find the matching option by text.
        const options = await this.locatorForAll(
          'select[aria-label="Select event"] option',
        )();
        for (let i = 0; i < options.length; i++) {
          const text = (await options[i].text()).trim();
          if (text === label) {
            await select.selectOptions(i);
            return (await this.getSelectedEventLabel()) === label;
          }
        }
        return false;
      },
      {description: `event selector option ${label}`, timeoutMs: 10000},
    );
  }

  async getSelectedEventLabel(): Promise<string | null> {
    const selected = await this.getSelectedEventOption();
    if (!selected) {
      return null;
    }
    return (await selected.text()).trim();
  }

  async assertSelectedEventLabel(label: string): Promise<void> {
    await waitForHarnessCondition(
      async () => (await this.getSelectedEventLabel()) === label,
      {
        description: `selected event label ${label}`,
        timeoutMs: 10000,
      },
    );
  }

  async selectEventByIndex(index: number): Promise<void> {
    const select = await this.getEventSelector();
    await select.selectOptions(index);
  }

  async getSelectedEventValue(): Promise<string> {
    const select = await this.getEventSelector();
    return select.getProperty('value');
  }

  async hasEventEmptyState(): Promise<boolean> {
    return Boolean(await this.getEventEmptyState());
  }

  async hasScannerPanel(): Promise<boolean> {
    return Boolean(await this.getScannerPanel());
  }

  async clickActivateCamera(): Promise<void> {
    const buttons = await this.getActionButtons();
    for (const button of buttons) {
      const text = await button.text();
      if (text.includes('ACTIVATE OPTICS')) {
        await button.click();
        return;
      }
    }
  }

  async clickStopCamera(): Promise<void> {
    const buttons = await this.getActionButtons();
    for (const button of buttons) {
      const text = await button.text();
      if (text.includes('ABORT SCAN')) {
        await button.click();
        return;
      }
    }
  }

  async switchTab(tabName: 'Tickets' | 'Guestlist'): Promise<void> {
    const tabs = await this.getTabs();
    for (const tab of tabs) {
      const text = await tab.text();
      if (text.includes(tabName)) {
        await tab.click();
        await waitForHarnessCondition(
          async () => (await tab.getAttribute('aria-selected')) === 'true',
          {description: `${tabName} tab selection`},
        );
        return;
      }
    }
  }

  async enterSearchTerm(term: string): Promise<void> {
    const input = await this.getSearchInput();
    await input.clear();
    await input.sendKeys(term);
  }

  async getListItemsCount(): Promise<number> {
    const items = await this.getListItems();
    return items.length;
  }

  async getManualListCardContentClasses(): Promise<string> {
    const cardContents = await this.getCardContents();
    const manualListContent = cardContents[1];
    if (!manualListContent) {
      throw new Error('Manual attendee list card content not found');
    }
    return (await manualListContent.getAttribute('class')) ?? '';
  }

  async getAttendeeListScrollContainerClasses(): Promise<string> {
    const container = await this.getAttendeeListScrollContainer();
    return (await container.getAttribute('class')) ?? '';
  }

  async clickCheckInOnItem(index: number): Promise<void> {
    const buttons = await this.getCheckInButtons();
    if (buttons[index]) {
      await buttons[index].click();
    }
  }

  async getCheckInButtonLabels(): Promise<string[]> {
    const buttons = await this.getCheckInButtons();
    return Promise.all(
      buttons.map(
        async (button) => (await button.getAttribute('aria-label')) ?? '',
      ),
    );
  }

  async getManualFeedbackText(): Promise<string | null> {
    const feedback = await this.getManualFeedback();
    return feedback ? feedback.text() : null;
  }

  async getListItemText(index: number): Promise<string> {
    const items = await this.getListItems();
    if (!items[index]) {
      throw new Error(`List item ${index} not found`);
    }
    return items[index].text();
  }

  async isActivateCameraButtonDisabled(): Promise<boolean> {
    const buttons = await this.getActionButtons();
    for (const button of buttons) {
      const text = await button.text();
      if (text.includes('ACTIVATE OPTICS')) {
        return button.getProperty('disabled');
      }
    }
    return true;
  }

  async getCameraErrorText(): Promise<string | null> {
    const error = await this.getCameraError();
    return error ? error.text() : null;
  }

  async getLastResultText(): Promise<string | null> {
    const result = await this.getLastResult();
    return result ? result.text() : null;
  }

  async isVideoElementVisible(): Promise<boolean> {
    const video = await this.getVideoElement();
    if (!video) return false;
    const classes = await video.getAttribute('class');
    return classes ? !classes.includes('hidden') : false;
  }

  async getSoundToggleText(): Promise<string | null> {
    const button = await this.getSoundToggle();
    return button ? button.text() : null;
  }

  async clickSoundToggle(): Promise<void> {
    const button = await this.getSoundToggle();
    if (button) {
      await button.click();
    }
  }

  async hasImportedSection(): Promise<boolean> {
    return Boolean(await this.getImportedSection());
  }

  async getImportedEntryCount(): Promise<number> {
    const entries = await this.getImportedEntries();
    return entries.length;
  }

  async getImportedEntryTextByName(name: string): Promise<string | null> {
    const entries = await this.getImportedEntries();
    for (const entry of entries) {
      const text = await entry.text();
      if (text.includes(name)) return text;
    }
    return null;
  }

  async getImportedSourceBadgeTexts(): Promise<string[]> {
    const badges = await this.getImportedSourceBadges();
    return Promise.all(
      badges.map(async (badge) => (await badge.text()).trim()),
    );
  }

  async getImportedSourceCountsText(): Promise<string | null> {
    const el = await this.getImportedSourceCounts();
    return el ? (await el.text()).replace(/\s+/g, ' ').trim() : null;
  }

  async clickImportedCheckInByName(name: string): Promise<void> {
    // The check-in button's aria-label ends with "for <name>", so match on it.
    const buttons = await this.getImportedCheckInButtons();
    for (const button of buttons) {
      const label = (await button.getAttribute('aria-label')) ?? '';
      if (label.includes(name)) {
        await button.click();
        return;
      }
    }
  }

  async hasEnableSoundButton(): Promise<boolean> {
    return Boolean(await this.getEnableSoundButton());
  }

  async clickEnableSoundButton(): Promise<void> {
    const button = await this.getEnableSoundButton();
    if (button) {
      await button.click();
    }
  }
}
