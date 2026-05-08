import { ComponentHarness, type TestElement, TestKey } from '@angular/cdk/testing';

export class ZardPopoverHarness extends ComponentHarness {
  static hostSelector = '[zPopover]';

  private getOverlay = this.documentRootLocatorFactory().locatorForOptional(
    '.cdk-overlay-pane z-popover',
  );

  async isOpen(): Promise<boolean> {
    return (await this.getOverlay()) !== null;
  }

  async open(): Promise<void> {
    const host = await this.host();
    await host.hover();
  }

  async close(): Promise<void> {
    const host = await this.host();
    await host.sendKeys(TestKey.ESCAPE);
  }

  getContent(): Promise<TestElement | null> {
    return this.getOverlay();
  }

  async click(): Promise<void> {
    const host = await this.host();
    await host.click();
  }
}
