import {ComponentHarness} from '@angular/cdk/testing';

/**
 * CDK harness for the shared import surface. Covers everything an E2E or
 * component test needs: step navigation, per-partition row counts, per-row
 * reason text, the dedup toggle, source-label entry, template download, and the
 * confirm button state.
 */
export class ImportSurfaceComponentHarness extends ComponentHarness {
  static hostSelector = 'app-import-surface';

  private readonly getTitle = this.locatorFor('[data-testid="import-title"]');
  private readonly getPasteInput = this.locatorFor(
    '[data-testid="import-paste-input"]',
  );
  // The file input is driven by Playwright's setInputFiles on its data-testid
  // (CDK harnesses cannot perform file uploads), so no CDK locator is exposed
  // for it here.
  private readonly getParseNext = this.locatorFor(
    '[data-testid="import-parse-next"]',
  );
  private readonly getTemplateDownload = this.locatorFor(
    '[data-testid="import-template-download"]',
  );
  private readonly getConfirm = this.locatorForOptional(
    '[data-testid="import-confirm"]',
  );
  private readonly getParseError = this.locatorForOptional(
    '[data-testid="import-parse-error"]',
  );
  private readonly getMappingError = this.locatorForOptional(
    '[data-testid="import-mapping-error"]',
  );
  private readonly getMappingNext = this.locatorForOptional(
    '[data-testid="import-mapping-next"]',
  );
  private readonly getDedupToggle = this.locatorForOptional(
    '[data-testid="import-dedup-toggle"]',
  );
  private readonly getSourceInput = this.locatorForOptional(
    '[data-testid="import-source-input"]',
  );
  private readonly getOverCapError = this.locatorForOptional(
    '[data-testid="import-overcap-error"]',
  );
  private readonly getEmptyState = this.locatorForOptional(
    '[data-testid="import-empty-state"]',
  );

  private readonly getPreviewRows = this.locatorForAll(
    '[data-testid="import-preview-row"]',
  );
  private readonly getReasons = this.locatorForAll(
    '[data-testid="import-preview-reason"]',
  );
  private readonly getMappingRows = this.locatorForAll(
    '[data-testid="import-mapping-row"]',
  );
  private readonly getStepMarkers = this.locatorForAll(
    '[data-testid="import-step-marker"]',
  );

  private readonly getCountValid = this.locatorForOptional(
    '[data-testid="import-count-valid"]',
  );
  private readonly getCountInvalid = this.locatorForOptional(
    '[data-testid="import-count-invalid"]',
  );
  private readonly getCountDuplicate = this.locatorForOptional(
    '[data-testid="import-count-duplicate"]',
  );

  private readonly getReportInserted = this.locatorForOptional(
    '[data-testid="import-report-inserted"]',
  );
  private readonly getReportSkipped = this.locatorForOptional(
    '[data-testid="import-report-skipped"]',
  );
  private readonly getReportFailed = this.locatorForOptional(
    '[data-testid="import-report-failed"]',
  );
  private readonly getReportPending = this.locatorForOptional(
    '[data-testid="import-report-pending"]',
  );
  private readonly getReportError = this.locatorForOptional(
    '[data-testid="import-report-error"]',
  );
  private readonly getReportDone = this.locatorForOptional(
    '[data-testid="import-report-done"]',
  );
  private readonly getMappingBack = this.locatorForOptional(
    '[data-testid="import-mapping-back"]',
  );
  private readonly getPreviewBack = this.locatorForOptional(
    '[data-testid="import-preview-back"]',
  );
  private readonly getCounts = this.locatorForOptional(
    '[data-testid="import-counts"]',
  );
  private readonly getFileLabel = this.locatorForOptional(
    '[data-testid="import-file-label"]',
  );

  async getTitleText(): Promise<string> {
    return (await this.getTitle()).text();
  }

  /** The step marker currently flagged active. */
  async getActiveStep(): Promise<string | null> {
    const markers = await this.getStepMarkers();
    for (const marker of markers) {
      if ((await marker.getAttribute('data-active')) === 'true') {
        return (await marker.text()).trim();
      }
    }
    return null;
  }

  async isEmptyStateVisible(): Promise<boolean> {
    return (await this.getEmptyState()) !== null;
  }

  /**
   * Set the paste textarea value. Uses `setInputValue` so multi-line CSV with
   * embedded newlines is applied verbatim (sendKeys would interpret Enter as a
   * submit in some contexts), then dispatches `input` for zoneless CD.
   */
  async pasteText(text: string): Promise<void> {
    const input = await this.getPasteInput();
    await input.setInputValue(text);
    await input.dispatchEvent('input');
  }

  async isParseNextDisabled(): Promise<boolean> {
    return (await this.getParseNext()).getProperty<boolean>('disabled');
  }

  async clickNext(): Promise<void> {
    await (await this.getParseNext()).click();
  }

  async clickMappingNext(): Promise<void> {
    const button = await this.getMappingNext();
    if (button) await button.click();
  }

  async clickTemplateDownload(): Promise<void> {
    await (await this.getTemplateDownload()).click();
  }

  async getParseErrorText(): Promise<string | null> {
    const el = await this.getParseError();
    return el ? (await el.text()).trim() : null;
  }

  async getMappingErrorText(): Promise<string | null> {
    const el = await this.getMappingError();
    return el ? (await el.text()).trim() : null;
  }

  async getMappingRowCount(): Promise<number> {
    return (await this.getMappingRows()).length;
  }

  /** Set a mapping-step column dropdown to a field key (or '' to ignore). */
  async setColumnMapping(columnIndex: number, fieldKey: string): Promise<void> {
    const select = await this.locatorFor(
      `[data-testid="import-mapping-select-${columnIndex}"]`,
    )();
    await select.setInputValue(fieldKey);
    await select.dispatchEvent('change');
  }

  async getPreviewRowCount(): Promise<number> {
    return (await this.getPreviewRows()).length;
  }

  /** Count preview rows in a given partition (valid/invalid/duplicate). */
  async getRowCountByPartition(
    partition: 'valid' | 'invalid' | 'duplicate',
  ): Promise<number> {
    const rows = await this.getPreviewRows();
    let count = 0;
    for (const row of rows) {
      if ((await row.getAttribute('data-partition')) === partition) count++;
    }
    return count;
  }

  async getReasonTexts(): Promise<string[]> {
    const reasons = await this.getReasons();
    return Promise.all(reasons.map(async (r) => (await r.text()).trim()));
  }

  async getValidCountText(): Promise<string | null> {
    const el = await this.getCountValid();
    return el ? (await el.text()).trim() : null;
  }

  async getInvalidCountText(): Promise<string | null> {
    const el = await this.getCountInvalid();
    return el ? (await el.text()).trim() : null;
  }

  async getDuplicateCountText(): Promise<string | null> {
    const el = await this.getCountDuplicate();
    return el ? (await el.text()).trim() : null;
  }

  async hasDedupToggle(): Promise<boolean> {
    return (await this.getDedupToggle()) !== null;
  }

  async toggleDedup(): Promise<void> {
    const toggle = await this.getDedupToggle();
    if (toggle) await toggle.click();
  }

  async isDedupIncludeChecked(): Promise<boolean> {
    const toggle = await this.getDedupToggle();
    return toggle ? toggle.getProperty<boolean>('checked') : false;
  }

  async hasSourceInput(): Promise<boolean> {
    return (await this.getSourceInput()) !== null;
  }

  async setSourceLabel(value: string): Promise<void> {
    const input = await this.getSourceInput();
    if (!input) return;
    await input.setInputValue(value);
    await input.dispatchEvent('input');
  }

  async isOverCapErrorVisible(): Promise<boolean> {
    return (await this.getOverCapError()) !== null;
  }

  async isConfirmDisabled(): Promise<boolean> {
    const button = await this.getConfirm();
    if (!button) return true;
    return button.getProperty<boolean>('disabled');
  }

  async clickConfirm(): Promise<void> {
    const button = await this.getConfirm();
    if (button) await button.click();
  }

  async getReportInsertedText(): Promise<string | null> {
    const el = await this.getReportInserted();
    return el ? (await el.text()).trim() : null;
  }

  async getReportSkippedText(): Promise<string | null> {
    const el = await this.getReportSkipped();
    return el ? (await el.text()).trim() : null;
  }

  async getReportErrorText(): Promise<string | null> {
    const el = await this.getReportError();
    return el ? (await el.text()).trim() : null;
  }

  async getReportFailedText(): Promise<string | null> {
    const el = await this.getReportFailed();
    return el ? (await el.text()).trim() : null;
  }

  async getReportPendingText(): Promise<string | null> {
    const el = await this.getReportPending();
    return el ? (await el.text()).trim() : null;
  }

  async clickReportDone(): Promise<void> {
    const button = await this.getReportDone();
    if (button) await button.click();
  }

  async clickMappingBack(): Promise<void> {
    const button = await this.getMappingBack();
    if (button) await button.click();
  }

  async clickPreviewBack(): Promise<void> {
    const button = await this.getPreviewBack();
    if (button) await button.click();
  }

  /** Full text of the counts summary row (valid / invalid / duplicate). */
  async getCountsText(): Promise<string | null> {
    const el = await this.getCounts();
    return el ? (await el.text()).trim() : null;
  }

  async getFileLabelText(): Promise<string | null> {
    const el = await this.getFileLabel();
    return el ? (await el.text()).trim() : null;
  }
}
