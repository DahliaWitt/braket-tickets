import { ComponentHarness } from '@angular/cdk/testing';

export class AppQrComponentHarness extends ComponentHarness {
  static hostSelector = 'app-qr';

  async getImgSrc(): Promise<string | null> {
    const imgFn = this.locatorForOptional('img');
    const img = await imgFn();
    if (!img) return null;
    return img.getAttribute('src');
  }

  /** Returns true if the QR image element is present and has a src (data URL loaded). */
  async isRendered(): Promise<boolean> {
    const src = await this.getImgSrc();
    return src !== null && src.length > 0;
  }
}
