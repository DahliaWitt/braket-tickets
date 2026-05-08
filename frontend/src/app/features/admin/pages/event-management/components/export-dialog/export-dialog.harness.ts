import { ComponentHarness } from '@angular/cdk/testing';
import { ZardButtonComponentHarness } from '@ui/components/primitives/button/button.component.harness';

export class ExportDialogHarness extends ComponentHarness {
  static hostSelector = 'app-export-dialog';

  private getCsvButton = this.locatorFor(ZardButtonComponentHarness.with({ text: /CSV/ }));

  private getPdfButton = this.locatorFor(ZardButtonComponentHarness.with({ text: /PDF/ }));

  private getCancelButton = this.locatorFor(ZardButtonComponentHarness.with({ text: 'Cancel' }));

  private getExportButton = this.locatorFor(ZardButtonComponentHarness.with({ text: /Export/ }));

  private getCheckboxes = this.locatorForAll('z-checkbox');

  async selectCsvFormat(): Promise<void> {
    const button = await this.getCsvButton();
    await button.click();
  }

  async selectPdfFormat(): Promise<void> {
    const button = await this.getPdfButton();
    await button.click();
  }

  async clickCancel(): Promise<void> {
    const button = await this.getCancelButton();
    await button.click();
  }

  async clickExport(): Promise<void> {
    const button = await this.getExportButton();
    await button.click();
  }

  async isExportButtonDisabled(): Promise<boolean> {
    const button = await this.getExportButton();
    return button.isDisabled();
  }

  async getCheckboxCount(): Promise<number> {
    const checkboxes = await this.getCheckboxes();
    return checkboxes.length;
  }

  async getFieldLabels(): Promise<string[]> {
    const checkboxes = await this.getCheckboxes();
    const labels: string[] = [];

    for (const checkbox of checkboxes) {
      const text = await checkbox.text();
      labels.push(text.trim());
    }

    return labels;
  }
}
