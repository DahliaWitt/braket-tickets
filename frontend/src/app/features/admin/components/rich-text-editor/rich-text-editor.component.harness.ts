import {ComponentHarness} from '@angular/cdk/testing';

/**
 * CDK harness for {@link RichTextEditorComponent}.
 *
 * Encapsulates every `data-testid` the component exposes so tests never reach
 * for raw DOM selectors. Toolbar toggles report their pressed state via
 * `aria-pressed`; the serialized document is mirrored into an inert element for
 * the {@link getSerializedJson} accessor.
 */
export class RichTextEditorHarness extends ComponentHarness {
  static hostSelector = 'app-rich-text-editor';

  private readonly getBoldBtn = this.locatorFor('[data-testid="rt-bold"]');
  private readonly getItalicBtn = this.locatorFor('[data-testid="rt-italic"]');
  private readonly getHeading2Btn = this.locatorFor(
    '[data-testid="rt-heading-2"]',
  );
  private readonly getHeading3Btn = this.locatorFor(
    '[data-testid="rt-heading-3"]',
  );
  private readonly getBulletListBtn = this.locatorFor(
    '[data-testid="rt-bullet-list"]',
  );
  private readonly getOrderedListBtn = this.locatorFor(
    '[data-testid="rt-ordered-list"]',
  );
  private readonly getLinkBtn = this.locatorFor('[data-testid="rt-link"]');
  private readonly getImageBtn = this.locatorFor('[data-testid="rt-image"]');

  private readonly getLinkEditor = this.locatorForOptional(
    '[data-testid="rich-text-link-editor"]',
  );
  private readonly getLinkInput = this.locatorFor(
    '[data-testid="rich-text-link-input"]',
  );
  private readonly getLinkApplyBtn = this.locatorFor(
    '[data-testid="rich-text-link-apply"]',
  );
  private readonly getLinkRemoveBtn = this.locatorFor(
    '[data-testid="rich-text-link-remove"]',
  );
  private readonly getLinkCancelBtn = this.locatorFor(
    '[data-testid="rich-text-link-cancel"]',
  );

  private readonly getImageInput = this.locatorFor(
    '[data-testid="rich-text-image-input"]',
  );
  private readonly getUploadProgress = this.locatorForOptional(
    '[data-testid="rich-text-upload-progress"]',
  );
  private readonly getJsonMirror = this.locatorFor(
    '[data-testid="rich-text-json"]',
  );
  private readonly getProseMirror = this.locatorFor(
    '[data-testid="rich-text-prosemirror"]',
  );

  // ── Body text entry ──────────────────────────────────────────────────────────

  /** Focuses the editable body and types the given text at the cursor. */
  async typeInBody(text: string): Promise<void> {
    const body = await this.getProseMirror();
    await body.focus();
    await body.sendKeys(text);
  }

  /** Plain-text content currently rendered in the editable body. */
  async getBodyText(): Promise<string> {
    return (await this.getProseMirror()).text();
  }

  /** The `aria-labelledby` on the editable body, or null when unset. */
  async getBodyAriaLabelledby(): Promise<string | null> {
    return (await this.getProseMirror()).getAttribute('aria-labelledby');
  }

  /** The `aria-label` on the editable body, or null when unset. */
  async getBodyAriaLabel(): Promise<string | null> {
    return (await this.getProseMirror()).getAttribute('aria-label');
  }

  // ── Toolbar clicks ─────────────────────────────────────────────────────────

  async clickBold(): Promise<void> {
    await (await this.getBoldBtn()).click();
  }

  async clickItalic(): Promise<void> {
    await (await this.getItalicBtn()).click();
  }

  async clickHeading2(): Promise<void> {
    await (await this.getHeading2Btn()).click();
  }

  async clickHeading3(): Promise<void> {
    await (await this.getHeading3Btn()).click();
  }

  async clickBulletList(): Promise<void> {
    await (await this.getBulletListBtn()).click();
  }

  async clickOrderedList(): Promise<void> {
    await (await this.getOrderedListBtn()).click();
  }

  async clickLink(): Promise<void> {
    await (await this.getLinkBtn()).click();
  }

  async clickImage(): Promise<void> {
    await (await this.getImageBtn()).click();
  }

  // ── Toggle pressed state ─────────────────────────────────────────────────────

  async isBoldActive(): Promise<boolean> {
    return (
      (await (await this.getBoldBtn()).getAttribute('aria-pressed')) === 'true'
    );
  }

  async isBulletListActive(): Promise<boolean> {
    return (
      (await (await this.getBulletListBtn()).getAttribute('aria-pressed')) ===
      'true'
    );
  }

  async isOrderedListActive(): Promise<boolean> {
    return (
      (await (await this.getOrderedListBtn()).getAttribute('aria-pressed')) ===
      'true'
    );
  }

  async isImageButtonDisabled(): Promise<boolean> {
    return (await (await this.getImageBtn()).getAttribute('disabled')) !== null;
  }

  /**
   * True when the image toolbar button is interactive — i.e. an `imageUpload`
   * function was supplied and no upload is in flight. Inverse of
   * {@link isImageButtonDisabled}.
   */
  async isImageButtonEnabled(): Promise<boolean> {
    return !(await this.isImageButtonDisabled());
  }

  // ── Link editor ──────────────────────────────────────────────────────────────

  async isLinkEditorOpen(): Promise<boolean> {
    return (await this.getLinkEditor()) !== null;
  }

  /** Opens the link editor, fills the URL, and clicks apply. */
  async insertLink(url: string): Promise<void> {
    await this.clickLink();
    const input = await this.getLinkInput();
    await input.clear();
    await input.setInputValue(url);
    // Signal Forms are not used here, but the component reads (input) events.
    await input.dispatchEvent('input');
    await (await this.getLinkApplyBtn()).click();
  }

  async setLinkUrl(url: string): Promise<void> {
    const input = await this.getLinkInput();
    await input.clear();
    await input.setInputValue(url);
    await input.dispatchEvent('input');
  }

  async clickLinkApply(): Promise<void> {
    await (await this.getLinkApplyBtn()).click();
  }

  async clickLinkRemove(): Promise<void> {
    await (await this.getLinkRemoveBtn()).click();
  }

  async clickLinkCancel(): Promise<void> {
    await (await this.getLinkCancelBtn()).click();
  }

  // ── Image upload ─────────────────────────────────────────────────────────────

  async getAcceptedImageTypes(): Promise<string | null> {
    return (await this.getImageInput()).getAttribute('accept');
  }

  async hasUploadProgress(): Promise<boolean> {
    return (await this.getUploadProgress()) !== null;
  }

  // ── Document accessor ────────────────────────────────────────────────────────

  /** Returns the serialized ProseMirror JSON currently held by the editor. */
  async getSerializedJson(): Promise<string> {
    return (await this.getJsonMirror()).text();
  }
}
