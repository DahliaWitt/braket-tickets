import { ComponentHarness } from '@angular/cdk/testing';

export class AboutComponentHarness extends ComponentHarness {
  static hostSelector = 'app-about';

  private getAllHeadings = this.locatorForAll('h1, h2');
  private getH1 = this.locatorForOptional('h1');
  private getAllH2s = this.locatorForAll('h2');
  private getGetInTouchButton = this.locatorForOptional('button[type="button"]');
  private getPrivacyLink = this.locatorForOptional('a[routerLink="/privacy"]');
  private getTermsLink = this.locatorForOptional('a[routerLink="/terms"]');
  private getSupportLink = this.locatorForOptional('a[routerLink="/support"]');

  /** Returns the text of the h1 heading, or null if absent. */
  async getPageTitle(): Promise<string | null> {
    const h1 = await this.getH1();
    return h1 ? (await h1.text()).trim() : null;
  }

  /** Returns the full visible page text for content assertions. */
  async getPageText(): Promise<string> {
    return (await this.host()).text();
  }

  /** Returns true when the "ABOUT US" h1 heading is present. */
  async isAboutUsSectionPresent(): Promise<boolean> {
    const title = await this.getPageTitle();
    return title !== null && title.includes('ABOUT US');
  }

  /** Returns the text content of all h2 headings. */
  async getSectionHeadings(): Promise<string[]> {
    const h2s = await this.getAllH2s();
    return Promise.all(h2s.map(async (h) => (await h.text()).trim()));
  }

  /** Returns the heading tag order, e.g. ["H1", "H2", "H2"]. */
  async getHeadingTags(): Promise<string[]> {
    const headings = await this.getAllHeadings();
    return Promise.all(headings.map(async (heading) => heading.getProperty<string>('tagName')));
  }

  /** Returns true when the "WORK WITH US" h2 section heading is present. */
  async isWorkWithUsSectionPresent(): Promise<boolean> {
    const headings = await this.getSectionHeadings();
    return headings.some((h) => h.includes('WORK WITH US'));
  }

  /** Returns true when the "PLATFORM & SECURITY" h2 section heading is present. */
  async isPlatformSecuritySectionPresent(): Promise<boolean> {
    const headings = await this.getSectionHeadings();
    return headings.some((h) => h.includes('PLATFORM & SECURITY'));
  }

  /** Returns true when the "Get in Touch" button is present. */
  async isGetInTouchButtonPresent(): Promise<boolean> {
    return (await this.getGetInTouchButton()) !== null;
  }

  /** Clicks the "Get in Touch" button. */
  async clickGetInTouch(): Promise<void> {
    const button = await this.getGetInTouchButton();
    if (!button) {
      throw new Error('"Get in Touch" button not found');
    }
    await button.click();
  }

  /** Returns true when the Privacy Policy link is present. */
  async isPrivacyLinkPresent(): Promise<boolean> {
    return (await this.getPrivacyLink()) !== null;
  }

  /** Returns true when the Terms of Service link is present. */
  async isTermsLinkPresent(): Promise<boolean> {
    return (await this.getTermsLink()) !== null;
  }

  /** Returns true when the Support link is present. */
  async isSupportLinkPresent(): Promise<boolean> {
    return (await this.getSupportLink()) !== null;
  }

  /** Returns the routerLink targets for the privacy, terms, and support links. */
  async getLinkTargets(): Promise<string[]> {
    const targets: string[] = [];

    const links = [await this.getPrivacyLink(), await this.getTermsLink(), await this.getSupportLink()];
    for (const link of links) {
      if (!link) continue;
      const target = await link.getAttribute('routerLink');
      if (target) {
        targets.push(target);
      }
    }

    return targets;
  }

  /** Returns the text content of the Get in Touch button, or null if missing. */
  async getGetInTouchButtonText(): Promise<string | null> {
    const button = await this.getGetInTouchButton();
    return button ? (await button.text()).trim() : null;
  }

  /** Returns the total number of headings (h1 + h2) on the page. */
  async getHeadingCount(): Promise<number> {
    const headings = await this.getAllHeadings();
    return headings.length;
  }
}
