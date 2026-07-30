import {ComponentHarness} from '@angular/cdk/testing';

export class SectionLandingComponentHarness extends ComponentHarness {
  static hostSelector = 'app-section-landing';

  private getHeading = this.locatorFor('h1');
  private getDescription = this.locatorFor('p');
  private getArticleCards = this.locatorForAll(
    '[data-testid="help-article-card"]',
  );
  private getSectionHeadings = this.locatorForAll('h2');
  private getDeveloperVideo = this.locatorForOptional('iframe');
  private getEmptyState = this.locatorForOptional(
    '[data-testid="section-empty-state"]',
  );
  private getLoadingState = this.locatorForOptional(
    '[data-testid="section-loading-state"]',
  );
  private getErrorState = this.locatorForOptional(
    '[data-testid="section-error-state"]',
  );

  async getSectionHeadingText(): Promise<string> {
    const h1 = await this.getHeading();
    return (await h1.text()).trim();
  }

  async getDescriptionText(): Promise<string> {
    const p = await this.getDescription();
    return (await p.text()).trim();
  }

  async getArticleCardCount(): Promise<number> {
    return (await this.getArticleCards()).length;
  }

  async getArticleCardTitles(): Promise<string[]> {
    const cards = await this.getArticleCards();
    const titles: string[] = [];
    for (const card of cards) {
      const h3 = await card.text();
      // h3 is the first part before the description
      titles.push(h3.split('\n')[0].trim());
    }
    return titles;
  }

  async getArticleCardDescriptions(): Promise<string[]> {
    const cards = await this.getArticleCards();
    const descriptions: string[] = [];
    for (const card of cards) {
      const fullText = await card.text();
      const parts = fullText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // First part is title (h3), remaining parts are description
      descriptions.push(parts.slice(1).join(' ').trim());
    }
    return descriptions;
  }

  async clickArticleCard(title: string): Promise<void> {
    const cards = await this.getArticleCards();
    for (const card of cards) {
      const cardText = await card.text();
      if (cardText.split('\n')[0].trim() === title) {
        await card.click();
        return;
      }
    }
    throw new Error(`Article card with title "${title}" not found`);
  }

  async getCategoryHeadings(): Promise<string[]> {
    const headings = await this.getSectionHeadings();
    const texts: string[] = [];
    for (const h of headings) {
      texts.push((await h.text()).trim());
    }
    return texts;
  }

  async isDeveloperVideoVisible(): Promise<boolean> {
    return (await this.getDeveloperVideo()) !== null;
  }

  async getDeveloperVideoTitle(): Promise<string | null> {
    const video = await this.getDeveloperVideo();
    if (!video) return null;
    return video.getAttribute('title');
  }

  async isEmptyStateVisible(): Promise<boolean> {
    const cards = await this.getArticleCards();
    if (cards.length > 0) return false;
    return (await this.getEmptyState()) !== null;
  }

  async getEmptyStateText(): Promise<string> {
    const empty = await this.getEmptyState();
    if (!empty) return '';
    return (await empty.text()).trim();
  }

  async isLoadingStateVisible(): Promise<boolean> {
    return (await this.getLoadingState()) !== null;
  }

  async isErrorStateVisible(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  async getErrorStateText(): Promise<string> {
    const error = await this.getErrorState();
    if (!error) return '';
    return (await error.text()).trim();
  }

  async getArticleCardClasses(index: number): Promise<string> {
    const cards = await this.getArticleCards();
    if (index < 0 || index >= cards.length) {
      throw new Error(
        `Article card index ${index} out of bounds (${cards.length} cards)`,
      );
    }
    return (await cards[index].getAttribute('class')) ?? '';
  }
}
