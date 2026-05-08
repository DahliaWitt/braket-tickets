import { ComponentHarness } from '@angular/cdk/testing';

export class EventPosterUploaderHarness extends ComponentHarness {
  static hostSelector = 'app-event-poster-uploader';

  private getUploadZone = this.locatorFor('[data-testid="poster-upload-zone"]');
  private getPreviewImage = this.locatorForOptional('[data-testid="poster-preview-image"]');
  private getCurrentImage = this.locatorForOptional('[data-testid="poster-current-image"]');
  private getEmptyState = this.locatorForOptional('[data-testid="poster-empty"]');
  private getClearBtn = this.locatorForOptional('[data-testid="poster-clear-btn"]');
  private getFileInput = this.locatorFor('[data-testid="poster-file-input"]');
  private getProgressOverlay = this.locatorForOptional('[data-testid="upload-progress-overlay"]');
  private getDragOverOverlay = this.locatorForOptional('[data-testid="drag-over-overlay"]');

  async hasPreviewImage(): Promise<boolean> {
    return (await this.getPreviewImage()) !== null;
  }

  async hasCurrentImage(): Promise<boolean> {
    return (await this.getCurrentImage()) !== null;
  }

  /** True when the upload zone is showing the empty / no-poster state. */
  async isEmpty(): Promise<boolean> {
    return (await this.getEmptyState()) !== null;
  }

  /** True when either a local preview or an existing poster URL is shown. */
  async hasPreview(): Promise<boolean> {
    return (await this.hasPreviewImage()) || (await this.hasCurrentImage());
  }

  async hasClearButton(): Promise<boolean> {
    return (await this.getClearBtn()) !== null;
  }

  async getAcceptedMimeTypes(): Promise<string | null> {
    const input = await this.getFileInput();
    return input.getAttribute('accept');
  }

  async clickClear(): Promise<void> {
    const btn = await this.getClearBtn();
    if (!btn) throw new Error('Clear button not found');
    await btn.click();
  }

  async hasProgressOverlay(): Promise<boolean> {
    return (await this.getProgressOverlay()) !== null;
  }

  /** True when the drag-over visual state is active (the drag-over indicator is rendered). */
  async isDragOver(): Promise<boolean> {
    return (await this.getDragOverOverlay()) !== null;
  }

  /**
   * Dispatch a synthetic dragenter to the upload zone, activating the drag-over state.
   * To simulate a full file drop with data, call the component's `onDrop()` directly
   * in unit tests (CDK TestElement.dispatchEvent does not support DataTransfer payloads).
   */
  async simulateDragEnter(): Promise<void> {
    const zone = await this.getUploadZone();
    await zone.dispatchEvent('dragenter', { bubbles: true });
  }

  /**
   * Dispatch a synthetic dragleave to the upload zone, clearing the drag-over state.
   */
  async simulateDragLeave(): Promise<void> {
    const zone = await this.getUploadZone();
    await zone.dispatchEvent('dragleave', { bubbles: true });
  }
}
