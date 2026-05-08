import {ComponentHarness} from '@angular/cdk/testing';

export class NotFoundComponentHarness extends ComponentHarness {
  static hostSelector = 'app-not-found';

  private getHeading = this.locatorForOptional('h1');
  private getGoHomeButton = this.locatorForOptional(
    '[data-testid="go-home-button"]',
  );

  /** Returns the text content of the 404 heading, or null if absent. */
  async getHeadingText(): Promise<string | null> {
    const heading = await this.getHeading();
    return heading ? heading.text() : null;
  }

  /** Returns true when the 404 heading is present in the DOM. */
  async isHeadingVisible(): Promise<boolean> {
    return (await this.getHeading()) !== null;
  }

  /** Returns true when the "Go Home" button is present. */
  async isGoHomeButtonPresent(): Promise<boolean> {
    return (await this.getGoHomeButton()) !== null;
  }

  /** Returns the configured routerLink target for the "Go Home" button. */
  async getGoHomeRouterLink(): Promise<string | null> {
    const button = await this.getGoHomeButton();
    return button ? button.getAttribute('routerLink') : null;
  }

  /** Clicks the "Go Home" button. */
  async clickGoHome(): Promise<void> {
    const button = await this.getGoHomeButton();
    if (!button) {
      throw new Error('Go Home button not found');
    }
    await button.click();
  }
}
