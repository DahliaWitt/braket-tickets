import { ComponentHarness } from '@angular/cdk/testing';

export class ContentLayoutComponentHarness extends ComponentHarness {
  static hostSelector = 'app-content-layout';

  private getMain = this.locatorFor('main#main-content');
  private getCenterColumn = this.locatorFor('main#main-content > div:nth-child(2)');
  private getLeftColumn = this.locatorForOptional('main#main-content > div:first-child');
  private getRightColumn = this.locatorForOptional('main#main-content > div:last-child');

  /** Returns true when the main content element is present. */
  async isMainPresent(): Promise<boolean> {
    return (await this.getMain()) !== null;
  }

  /** Returns true when the center content column is present. */
  async isCenterColumnPresent(): Promise<boolean> {
    try {
      await this.getCenterColumn();
      return true;
    } catch {
      return false;
    }
  }

  /** Returns true when the left gutter column is present in the DOM. */
  async isLeftColumnPresent(): Promise<boolean> {
    return (await this.getLeftColumn()) !== null;
  }

  /** Returns true when the right gutter column is present in the DOM. */
  async isRightColumnPresent(): Promise<boolean> {
    return (await this.getRightColumn()) !== null;
  }
}
