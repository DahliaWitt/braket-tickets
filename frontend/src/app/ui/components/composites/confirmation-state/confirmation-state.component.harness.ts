import { ComponentHarness } from '@angular/cdk/testing';

export class ConfirmationStateHarness extends ComponentHarness {
  static hostSelector = 'app-confirmation-state';

  private readonly iconCircle = this.locatorFor('.rounded-full');
  private readonly heading = this.locatorFor('h2');
  private readonly description = this.locatorForOptional('p');
  private readonly projected = this.locatorForOptional(
    '.space-y-4 > :last-child:not(h2):not(p):not(.rounded-full)',
  );

  async getHeadingText(): Promise<string> {
    return (await this.heading()).text();
  }

  async getDescriptionText(): Promise<string | null> {
    const desc = await this.description();
    return desc ? desc.text() : null;
  }

  async getIconCircleClasses(): Promise<string> {
    const circle = await this.iconCircle();
    return (await circle.getAttribute('class')) ?? '';
  }

  async getIconCircleId(): Promise<string | null> {
    return (await this.iconCircle()).getAttribute('id');
  }

  async getDescriptionId(): Promise<string | null> {
    const desc = await this.description();
    return desc ? desc.getAttribute('id') : null;
  }

  async getDescriptionClasses(): Promise<string | null> {
    const desc = await this.description();
    return desc ? desc.getAttribute('class') : null;
  }

  async hasSpinner(): Promise<boolean> {
    const circle = await this.iconCircle();
    const classes = (await circle.getAttribute('class')) ?? '';
    return classes.includes('animate-pulse');
  }

  async getActionBtn() {
    return this.locatorForOptional('.action-btn')();
  }
}
