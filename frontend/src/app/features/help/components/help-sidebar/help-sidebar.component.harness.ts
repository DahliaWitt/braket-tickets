import { ComponentHarness } from '@angular/cdk/testing';

export class HelpSidebarComponentHarness extends ComponentHarness {
  static hostSelector = 'app-help-sidebar';

  private getSectionLinks = this.locatorForAll('[data-testid="help-section-link"]');
  private getCategoryGroups = this.locatorForAll('[data-testid="help-category-group"]');
  private getCategoryToggles = this.locatorForAll('[data-testid="help-category-toggle"]');
  private getCategoryPanels = this.locatorForAll('[data-testid="help-category-panel"]');
  private getArticleLinks = this.locatorForAll('[data-testid="help-article-link"]');

  async getSectionLinkTexts(): Promise<string[]> {
    const links = await this.getSectionLinks();
    const texts: string[] = [];
    for (const link of links) {
      texts.push((await link.text()).trim());
    }
    return texts;
  }

  async getSectionLinkCount(): Promise<number> {
    return (await this.getSectionLinks()).length;
  }

  async clickSectionLink(text: string): Promise<void> {
    const links = await this.getSectionLinks();
    for (const link of links) {
      if ((await link.text()).trim().toLowerCase() === text.toLowerCase()) {
        await link.click();
        return;
      }
    }
    throw new Error(`Section link with text "${text}" not found`);
  }

  async isSectionLinkVisible(text: string): Promise<boolean> {
    const links = await this.getSectionLinks();
    for (const link of links) {
      if ((await link.text()).trim().toLowerCase() === text.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  async getCategoryCount(): Promise<number> {
    return (await this.getCategoryGroups()).length;
  }

  async getCategoryNames(): Promise<string[]> {
    const groups = await this.getCategoryGroups();
    const names: string[] = [];
    for (const group of groups) {
      const label = await group.text();
      // The category label is the first text node (the <p> element)
      names.push(label.split('\n')[0].trim());
    }
    return names;
  }

  async getArticleLinkCount(): Promise<number> {
    return (await this.getArticleLinks()).length;
  }

  async getArticleLinkTexts(): Promise<string[]> {
    const links = await this.getArticleLinks();
    const texts: string[] = [];
    for (const link of links) {
      texts.push((await link.text()).trim());
    }
    return texts;
  }

  async clickArticleLink(title: string): Promise<void> {
    const links = await this.getArticleLinks();
    for (const link of links) {
      if ((await link.text()).trim() === title) {
        await link.click();
        return;
      }
    }
    throw new Error(`Article link with title "${title}" not found`);
  }

  async isArticleLinkVisible(title: string): Promise<boolean> {
    const links = await this.getArticleLinks();
    for (const link of links) {
      if ((await link.text()).trim() === title) {
        return true;
      }
    }
    return false;
  }

  async hasSectionToggle(): Promise<boolean> {
    return (await this.getSectionLinkCount()) > 0;
  }

  async toggleCategory(name: string): Promise<void> {
    const toggles = await this.getCategoryToggles();
    for (const toggle of toggles) {
      if ((await toggle.text()).trim().toLowerCase().includes(name.toLowerCase())) {
        await toggle.click();
        return;
      }
    }
    throw new Error(`Category toggle with name "${name}" not found`);
  }

  async isCategoryExpanded(name: string): Promise<boolean> {
    const toggles = await this.getCategoryToggles();
    for (const toggle of toggles) {
      if ((await toggle.text()).trim().toLowerCase().includes(name.toLowerCase())) {
        return (await toggle.getAttribute('aria-expanded')) === 'true';
      }
    }
    throw new Error(`Category toggle with name "${name}" not found`);
  }

  async getExpandedPanelCount(): Promise<number> {
    return (await this.getCategoryPanels()).length;
  }
}
