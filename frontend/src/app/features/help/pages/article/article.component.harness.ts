import { ComponentHarness } from '@angular/cdk/testing';

export class ArticleComponentHarness extends ComponentHarness {
  static hostSelector = 'app-article';

  private getBreadcrumb = this.locatorForOptional('[data-testid="help-breadcrumb"]');
  private getArticleContent = this.locatorForOptional('[data-testid="help-article-content"]');
  private getLoadingState = this.locatorForOptional('[data-testid="article-loading-state"]');
  private getErrorState = this.locatorForOptional('[data-testid="article-error-state"]');
  private getLoginPrompt = this.locatorForOptional('[data-testid="help-login-prompt"]');
  private getPrevLink = this.locatorForOptional('[data-testid="prev-article-link"]');
  private getNextLink = this.locatorForOptional('[data-testid="next-article-link"]');
  private getPrevTitle = this.locatorForOptional('[data-testid="prev-article-title"]');
  private getNextTitle = this.locatorForOptional('[data-testid="next-article-title"]');
  private getPrevIcon = this.locatorForOptional('[data-testid="prev-article-link"] z-icon');
  private getNextIcon = this.locatorForOptional('[data-testid="next-article-link"] z-icon');
  private getPrevIconWrapper = this.locatorForOptional(
    '[data-testid="prev-article-icon-wrapper"]',
  );
  private getNextIconWrapper = this.locatorForOptional(
    '[data-testid="next-article-icon-wrapper"]',
  );

  async isBreadcrumbVisible(): Promise<boolean> {
    return (await this.getBreadcrumb()) !== null;
  }

  async getBreadcrumbText(): Promise<string> {
    const breadcrumb = await this.getBreadcrumb();
    if (!breadcrumb) return '';
    return (await breadcrumb.text()).trim();
  }

  async isArticleContentVisible(): Promise<boolean> {
    return (await this.getArticleContent()) !== null;
  }

  async isLoadingVisible(): Promise<boolean> {
    return (await this.getLoadingState()) !== null;
  }

  async isErrorStateVisible(): Promise<boolean> {
    return (await this.getErrorState()) !== null;
  }

  async isLoginPromptVisible(): Promise<boolean> {
    return (await this.getLoginPrompt()) !== null;
  }

  async getLoginPromptText(): Promise<string> {
    const prompt = await this.getLoginPrompt();
    if (!prompt) return '';
    return (await prompt.text()).trim();
  }

  async clickSignIn(): Promise<void> {
    const signInLink = await this.locatorForOptional('[data-testid="help-login-prompt"] a')();
    if (!signInLink) throw new Error('Sign in link is not visible');
    await signInLink.click();
  }

  async hasPrevNavigation(): Promise<boolean> {
    const link = await this.getPrevLink();
    if (!link) return false;
    const text = await link.text();
    return text.toLowerCase().includes('previous');
  }

  async hasNextNavigation(): Promise<boolean> {
    const link = await this.getNextLink();
    if (!link) return false;
    const text = await link.text();
    return text.toLowerCase().includes('next');
  }

  async clickPrevArticle(): Promise<void> {
    const link = await this.getPrevLink();
    if (!link) throw new Error('Previous article navigation is not visible');
    await link.click();
  }

  async clickNextArticle(): Promise<void> {
    const link = await this.getNextLink();
    if (!link) throw new Error('Next article navigation is not visible');
    await link.click();
  }

  async clickBackToHelp(): Promise<void> {
    const errorState = await this.getErrorState();
    if (errorState) {
      const backLink = await this.locatorForOptional('[data-testid="article-error-state"] a')();
      if (backLink) {
        await backLink.click();
        return;
      }
    }
    const notFoundBackLink = await this.locatorForOptional('div.text-muted-foreground > a')();
    if (notFoundBackLink) {
      await notFoundBackLink.click();
      return;
    }
    throw new Error('No back-to-help link found');
  }

  async getArticleHeadings(): Promise<string[]> {
    const content = await this.getArticleContent();
    if (!content) return [];
    // Return heading elements text from the prose content
    const h2Elements = await this.locatorForAll('[data-testid="help-article-content"] h2')();
    const texts: string[] = [];
    for (const h of h2Elements) {
      texts.push((await h.text()).trim());
    }
    return texts;
  }

  async getPrevLinkClasses(): Promise<string> {
    const link = await this.getPrevLink();
    if (!link) return '';
    return (await link.getAttribute('class')) ?? '';
  }

  async getNextLinkClasses(): Promise<string> {
    const link = await this.getNextLink();
    if (!link) return '';
    return (await link.getAttribute('class')) ?? '';
  }

  async getPrevTitleClasses(): Promise<string> {
    const title = await this.getPrevTitle();
    if (!title) return '';
    return (await title.getAttribute('class')) ?? '';
  }

  async getNextTitleClasses(): Promise<string> {
    const title = await this.getNextTitle();
    if (!title) return '';
    return (await title.getAttribute('class')) ?? '';
  }

  async hasPrevIcon(): Promise<boolean> {
    return (await this.getPrevIcon()) !== null;
  }

  async hasNextIcon(): Promise<boolean> {
    return (await this.getNextIcon()) !== null;
  }

  async getNextIconWrapperClasses(): Promise<string> {
    const wrapper = await this.getNextIconWrapper();
    if (!wrapper) return '';
    return (await wrapper.getAttribute('class')) ?? '';
  }

  async getPrevIconWrapperClasses(): Promise<string> {
    const wrapper = await this.getPrevIconWrapper();
    if (!wrapper) return '';
    return (await wrapper.getAttribute('class')) ?? '';
  }
}
