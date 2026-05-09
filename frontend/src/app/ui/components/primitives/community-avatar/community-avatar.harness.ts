import {ComponentHarness} from '@angular/cdk/testing';

export class BraCommunityAvatarHarness extends ComponentHarness {
  static hostSelector = 'bra-community-avatar';

  async hasImage(): Promise<boolean> {
    const img = await this.locatorForOptional('img')();
    return img !== null;
  }

  async getImageSrc(): Promise<string | null> {
    const img = await this.locatorForOptional('img')();
    return img ? img.getAttribute('src') : null;
  }

  async getImageAlt(): Promise<string | null> {
    const img = await this.locatorForOptional('img')();
    return img ? img.getAttribute('alt') : null;
  }

  async getInitialText(): Promise<string | null> {
    const span = await this.locatorForOptional(
      '[data-testid="community-avatar-initial"]',
    )();
    return span ? (await span.text()).trim() : null;
  }

  async getSize(): Promise<string | null> {
    return (await this.host()).getAttribute('data-size');
  }
}
