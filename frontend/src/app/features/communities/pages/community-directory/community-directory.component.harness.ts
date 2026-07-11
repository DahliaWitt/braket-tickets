import {ComponentHarness} from '@angular/cdk/testing';
import type {TestElement} from '@angular/cdk/testing';
import {BraCommunityAvatarHarness} from '@ui/components/primitives/community-avatar/community-avatar.harness';

export class CommunityDirectoryComponentHarness extends ComponentHarness {
  static hostSelector = 'app-community-directory';

  // ─── Loading / Skeleton ────────────────────────────
  async isShowingSkeleton(): Promise<boolean> {
    const skeleton = await this.locatorForOptional(
      '[data-testid="community-directory-skeleton"]',
    )();
    return skeleton !== null;
  }

  async getSkeletonCards(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="skeleton-card"]')();
  }

  // ─── Community List ────────────────────────────────
  async getCommunityCards(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="community-card"]')();
  }

  async getCommunityList(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="community-list"]')();
  }

  async getEmptyState(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="empty-state"]')();
  }

  async getErrorState(): Promise<TestElement | null> {
    return this.locatorForOptional(
      '[data-testid="community-directory-error-state"]',
    )();
  }

  async getRetryButton(): Promise<TestElement | null> {
    return this.locatorForOptional(
      '[data-testid="community-directory-retry"]',
    )();
  }

  async getHeading(): Promise<TestElement> {
    return this.locatorFor('h1')();
  }

  // ─── Per-Card CTAs ─────────────────────────────────
  async getApplyButtons(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="cta-apply"]')();
  }

  async getReviseLinks(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="cta-revise"]')();
  }

  async getViewEventsLinks(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="cta-view-events"]')();
  }

  async getRelationshipSkeletons(): Promise<TestElement[]> {
    return this.locatorForAll(
      '[data-testid="community-relationship-skeleton"]',
    )();
  }

  async getRelationshipErrorBadges(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="community-relationship-error"]')();
  }

  async getCommunityNameLinks(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="community-name-link"]')();
  }

  async getCommunityLogoSlots(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="community-logo-slot"]')();
  }

  async getCommunityLogoImages(): Promise<BraCommunityAvatarHarness[]> {
    const avatars = await this.locatorForAll(BraCommunityAvatarHarness)();
    const withImages: BraCommunityAvatarHarness[] = [];
    for (const avatar of avatars) {
      if (await avatar.hasImage()) {
        withImages.push(avatar);
      }
    }
    return withImages;
  }

  async getCommunityLogoFallbacks(): Promise<BraCommunityAvatarHarness[]> {
    const avatars = await this.locatorForAll(BraCommunityAvatarHarness)();
    const withFallback: BraCommunityAvatarHarness[] = [];
    for (const avatar of avatars) {
      if (!(await avatar.hasImage())) {
        withFallback.push(avatar);
      }
    }
    return withFallback;
  }

  async getCommunityDescriptions(): Promise<TestElement[]> {
    return this.locatorForAll('[data-testid="community-description"]')();
  }

  async getCommunityDescriptionFallbacks(): Promise<TestElement[]> {
    return this.locatorForAll(
      '[data-testid="community-description-fallback"]',
    )();
  }

  async getEmptyStateHomeLink(): Promise<TestElement | null> {
    return this.locatorForOptional(
      '[data-testid="community-directory-empty-home"]',
    )();
  }

  // ─── Status Badges ──────────────────────────────────
  async getStatusBadge(testId: string): Promise<TestElement | null> {
    return this.locatorForOptional(`[data-testid="${testId}"]`)();
  }
}
