import {ComponentHarness} from '@angular/cdk/testing';
import {EventCardHarness} from '@ui/components/composites/event-card/event-card.harness';
import {BraCommunityAvatarHarness} from '@ui/components/primitives/community-avatar/community-avatar.harness';

export class CommunityEventsComponentHarness extends ComponentHarness {
  static hostSelector = 'app-community-events';

  async isLoadingStateVisible(): Promise<boolean> {
    // Loading state renders skeleton elements but not the header or grid
    const skeleton = await this.locatorForOptional('z-skeleton')();
    return !!skeleton;
  }

  async isPickerStateVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-picker"]',
    )();
    return !!el;
  }

  async getPickerCardCount(): Promise<number> {
    const cards = await this.locatorForAll(
      '[data-testid="community-picker-card"]',
    )();
    return cards.length;
  }

  async isErrorStateVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-error"]',
    )();
    return !!el;
  }

  async isNotFoundVisible(): Promise<boolean> {
    return this.isErrorStateVisible();
  }

  async isEmptyStateVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-empty"]',
    )();
    return !!el;
  }

  async getEmptyStateTitle(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-empty"] [data-testid="empty-state-title"]',
    )();
    return el ? (await el.text()).trim() : null;
  }

  async getEmptyStateBrowseHref(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-empty-browse"]',
    )();
    return el ? el.getAttribute('href') : null;
  }

  async isPickerEmptyStateVisible(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="community-picker-empty"]',
    )();
    return !!el;
  }

  async getPickerEmptyStateTitle(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-picker-empty"] [data-testid="empty-state-title"]',
    )();
    return el ? (await el.text()).trim() : null;
  }

  async getPickerEmptyHomeHref(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-picker-empty-home"]',
    )();
    return el ? el.getAttribute('href') : null;
  }

  async getEventCardCount(): Promise<number> {
    const cards = await this.locatorForAll(EventCardHarness)();
    return cards.length;
  }

  async getEventCards(): Promise<EventCardHarness[]> {
    return this.locatorForAll(EventCardHarness)();
  }

  async getCommunityNameHeaderText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-header"]',
    )();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getDescription(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="community-events-description"]',
    )();
    if (!el) return null;
    return (await el.text()).trim();
  }

  async getHeaderAvatar(): Promise<BraCommunityAvatarHarness | null> {
    return this.locatorForOptional(
      BraCommunityAvatarHarness.with({
        ancestor: '[data-testid="community-events-header"]',
      }),
    )();
  }
}
