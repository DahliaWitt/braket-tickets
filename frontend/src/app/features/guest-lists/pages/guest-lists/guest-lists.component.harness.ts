import {ComponentHarness} from '@angular/cdk/testing';

export class GuestListsComponentHarness extends ComponentHarness {
  static hostSelector = 'app-guest-lists';

  async isLoading(): Promise<boolean> {
    return (
      (await this.locatorForOptional(
        '[data-testid="guest-lists-loading"]',
      )()) !== null
    );
  }

  async getEmptyText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-lists-empty"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async getLoadFailureText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-lists-load-failure"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async retryLoading(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-lists-retry-loading"]')()
    ).click();
  }

  async getPaginationFailureText(): Promise<string | null> {
    const element = await this.locatorForOptional(
      '[data-testid="guest-lists-pagination-failure"]',
    )();
    return element ? (await element.text()).trim() : null;
  }

  async retryPagination(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-lists-retry-pagination"]')()
    ).click();
  }

  async hasLoadMore(): Promise<boolean> {
    return (
      (await this.locatorForOptional(
        '[data-testid="guest-lists-load-more"]',
      )()) !== null
    );
  }

  async loadMore(): Promise<void> {
    await (
      await this.locatorFor('[data-testid="guest-lists-load-more"]')()
    ).click();
  }

  async getAssignmentLinks(): Promise<{text: string; href: string | null}[]> {
    const links = await this.locatorForAll(
      '[data-testid="guest-list-assignment-link"]',
    )();
    return Promise.all(
      links.map(async (link) => ({
        text: (await link.text()).trim(),
        href: await link.getAttribute('href'),
      })),
    );
  }

  async clickAssignment(index = 0): Promise<void> {
    const links = await this.locatorForAll(
      '[data-testid="guest-list-assignment-link"]',
    )();
    const link = links[index];
    if (!link) throw new Error(`No guest-list assignment at index ${index}`);
    await link.click();
  }
}
