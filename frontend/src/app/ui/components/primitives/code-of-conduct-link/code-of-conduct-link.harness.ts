import {ComponentHarness} from '@angular/cdk/testing';

export class BraCodeOfConductLinkHarness extends ComponentHarness {
  static hostSelector = 'bra-code-of-conduct-link';

  private readonly button = this.locatorFor(
    '[data-testid="code-of-conduct-link"]',
  );

  private readonly optionalButton = this.locatorForOptional(
    '[data-testid="code-of-conduct-link"]',
  );

  async click(): Promise<void> {
    await (await this.button()).click();
  }

  async isVisible(): Promise<boolean> {
    return (await this.optionalButton()) !== null;
  }

  async getText(): Promise<string> {
    return (await this.button()).text();
  }
}
