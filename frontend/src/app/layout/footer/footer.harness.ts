import {ComponentHarness} from '@angular/cdk/testing';

export class FooterHarness extends ComponentHarness {
  static hostSelector = 'app-footer';

  private readonly getFooterElement = this.locatorFor('footer');
  private readonly getNavElement = this.locatorFor('nav');
  private readonly getNavLinks = this.locatorForAll('nav a');
  private readonly getNavActions = this.locatorForAll('nav a, nav button');
  private readonly getFeedbackButton = this.locatorFor(
    'nav button[type="button"]',
  );
  private readonly getAboutLink = this.locatorForOptional(
    'a[routerLink="/about"]',
  );

  async clickFeedback(): Promise<void> {
    const button = await this.getFeedbackButton();
    await button.click();
  }

  async getNavText(): Promise<string[]> {
    const links = await this.getNavLinks();
    const texts = await Promise.all(
      links.map(async (link) => (await link.text()).trim()),
    );
    const feedbackButton = (await this.getFeedbackButton()).text();
    return [...texts, await feedbackButton];
  }

  async hasFooterLandmark(): Promise<boolean> {
    const nav = await this.getNavElement();
    const ariaLabel = await nav.getAttribute('aria-label');
    return ariaLabel === 'Footer';
  }

  async navActionsUseForegroundToken(): Promise<boolean> {
    const actions = await this.getNavActions();
    const classNames = await Promise.all(
      actions.map((action) => action.getAttribute('class')),
    );
    return classNames.every((classes) =>
      classes?.split(/\s+/u).includes('text-foreground'),
    );
  }

  async navActionsHaveHoverAffordance(): Promise<boolean> {
    const actions = await this.getNavActions();
    const classNames = await Promise.all(
      actions.map((action) => action.getAttribute('class')),
    );
    return classNames.every((classes) =>
      classes?.split(/\s+/u).includes('hover:underline'),
    );
  }

  async getAboutHref(): Promise<string | null> {
    const link = await this.getAboutLink();
    return link ? link.getAttribute('href') : null;
  }

  async getFooterText(): Promise<string> {
    const footer = await this.getFooterElement();
    return footer.text();
  }
}
