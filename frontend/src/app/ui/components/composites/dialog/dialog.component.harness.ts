import {ComponentHarness} from '@angular/cdk/testing';

export class BraDialogHarness extends ComponentHarness {
  static hostSelector = 'bra-dialog';

  private readonly title = this.locatorForOptional('[data-testid="z-title"]');
  private readonly description = this.locatorForOptional(
    '[data-testid="z-description"]',
  );
  private readonly content = this.locatorForOptional(
    '[data-testid="z-content"]',
  );
  private readonly closeHeaderButton = this.locatorForOptional(
    '[data-testid="z-close-header-button"]',
  );
  private readonly focusTrapAnchors = this.locatorForAll(
    '.cdk-focus-trap-anchor',
  );
  private readonly focusFallback = this.locatorForOptional(
    '[data-testid="z-focus-fallback"]',
  );
  private readonly cancelButton = this.locatorForOptional(
    '[data-testid="z-cancel-button"]',
  );
  private readonly okButton = this.locatorForOptional(
    '[data-testid="z-ok-button"]',
  );

  async getRole(): Promise<string | null> {
    return (await this.host()).getAttribute('role');
  }

  private async getHostClassTokens(): Promise<string[]> {
    const className = (await (await this.host()).getAttribute('class')) ?? '';
    return className.split(/\s+/);
  }

  /** The dialog panel must never grow past the viewport. */
  async hasViewportMaxHeight(): Promise<boolean> {
    return (await this.getHostClassTokens()).includes(
      'max-h-[calc(100dvh-2rem)]',
    );
  }

  /** The body region scrolls while header/footer stay visible. */
  async hasScrollableBody(): Promise<boolean> {
    const body = await this.focusFallback();
    const className = (await body?.getAttribute('class')) ?? '';
    return className.split(/\s+/).includes('overflow-y-auto');
  }

  async getAriaLabelledBy(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-labelledby');
  }

  async getAriaDescribedBy(): Promise<string | null> {
    return (await this.host()).getAttribute('aria-describedby');
  }

  async getTitleText(): Promise<string | null> {
    const el = await this.title();
    return el ? (await el.text()).trim() : null;
  }

  async getDescriptionText(): Promise<string | null> {
    const el = await this.description();
    return el ? (await el.text()).trim() : null;
  }

  async getContentText(): Promise<string | null> {
    const el = await this.content();
    return el ? (await el.text()).trim() : null;
  }

  async getCancelText(): Promise<string | null> {
    const btn = await this.cancelButton();
    return btn ? (await btn.text()).trim() : null;
  }

  async getOkText(): Promise<string | null> {
    const btn = await this.okButton();
    return btn ? (await btn.text()).trim() : null;
  }

  async isOkDisabled(): Promise<boolean> {
    const btn = await this.okButton();
    if (!btn) return false;
    return (await btn.getAttribute('disabled')) !== null;
  }

  async hasCloseHeaderButton(): Promise<boolean> {
    return (await this.closeHeaderButton()) !== null;
  }

  async hasCancelButton(): Promise<boolean> {
    return (await this.cancelButton()) !== null;
  }

  async hasOkButton(): Promise<boolean> {
    return (await this.okButton()) !== null;
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

  async isHeaderCloseFocused(): Promise<boolean> {
    const btn = await this.closeHeaderButton();
    return (await btn?.isFocused()) ?? false;
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

  async clickHeaderClose(): Promise<void> {
    const btn = await this.closeHeaderButton();
    if (!btn) {
      throw new Error(
        'Close button [data-testid="z-close-header-button"] is not present in the dialog',
      );
    }
    await btn.click();
  }

  async clickCancel(): Promise<void> {
    const btn = await this.cancelButton();
    if (!btn) {
      throw new Error(
        'Cancel button [data-testid="z-cancel-button"] is not present in the dialog',
      );
    }
    await btn.click();
  }

  async clickOk(): Promise<void> {
    const btn = await this.okButton();
    if (!btn) {
      throw new Error(
        'OK button [data-testid="z-ok-button"] is not present in the dialog',
      );
    }
    await btn.click();
  }
}
