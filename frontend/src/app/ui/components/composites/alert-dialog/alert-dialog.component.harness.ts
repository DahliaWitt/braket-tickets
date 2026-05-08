import {ComponentHarness} from '@angular/cdk/testing';

export class BraAlertDialogComponentHarness extends ComponentHarness {
  static hostSelector = 'bra-alert-dialog';

  private readonly title = this.locatorForOptional(
    '[data-testid="z-alert-title"]',
  );
  private readonly description = this.locatorForOptional(
    '[data-testid="z-alert-description"]',
  );
  private readonly content = this.locatorForOptional(
    '[data-testid="z-alert-content"]',
  );
  private readonly focusTrapAnchors = this.locatorForAll(
    '.cdk-focus-trap-anchor',
  );
  private readonly focusFallback = this.locatorForOptional(
    '[data-testid="z-alert-focus-fallback"]',
  );
  private readonly cancelButton = this.locatorForOptional(
    '[data-testid="z-alert-cancel-button"]',
  );
  private readonly okButton = this.locatorForOptional(
    '[data-testid="z-alert-ok-button"]',
  );

  async getTitleText(): Promise<string | null> {
    const el = await this.title();
    return el ? el.text() : null;
  }

  async getDescriptionText(): Promise<string | null> {
    const el = await this.description();
    return el ? el.text() : null;
  }

  async getContentText(): Promise<string | null> {
    const el = await this.content();
    return el ? el.text() : null;
  }

  async hasCancelButton(): Promise<boolean> {
    return (await this.cancelButton()) !== null;
  }

  async hasOkButton(): Promise<boolean> {
    return (await this.okButton()) !== null;
  }

  async getCancelAriaLabel(): Promise<string | null> {
    const btn = await this.cancelButton();
    return btn ? btn.getAttribute('aria-label') : null;
  }

  async getOkAriaLabel(): Promise<string | null> {
    const btn = await this.okButton();
    return btn ? btn.getAttribute('aria-label') : null;
  }

  async hasFocusTrapAnchors(): Promise<boolean> {
    return (await this.focusTrapAnchors()).length === 2;
  }

  async isCancelInitialFocus(): Promise<boolean> {
    const btn = await this.cancelButton();
    return (await btn?.getAttribute('cdkFocusInitial')) !== null;
  }

  async isFallbackInitialFocus(): Promise<boolean> {
    const fallback = await this.focusFallback();
    return (await fallback?.getAttribute('cdkFocusInitial')) !== null;
  }

  async isFallbackFocused(): Promise<boolean> {
    const fallback = await this.focusFallback();
    return (await fallback?.isFocused()) ?? false;
  }

  async isCancelFocused(): Promise<boolean> {
    const btn = await this.cancelButton();
    return (await btn?.isFocused()) ?? false;
  }

  async isOkFocused(): Promise<boolean> {
    const btn = await this.okButton();
    return (await btn?.isFocused()) ?? false;
  }

  async focusStartTrapAnchor(): Promise<void> {
    const [startAnchor] = await this.focusTrapAnchors();
    await startAnchor?.focus();
  }

  async focusEndTrapAnchor(): Promise<void> {
    const anchors = await this.focusTrapAnchors();
    await anchors.at(-1)?.focus();
  }

  async clickCancel(): Promise<void> {
    const btn = await this.cancelButton();
    if (btn) {
      await btn.click();
    }
  }

  async clickOk(): Promise<void> {
    const btn = await this.okButton();
    if (btn) {
      await btn.click();
    }
  }
}

export {BraAlertDialogComponentHarness as BraAlertDialogHarness};
