import {ComponentHarness} from '@angular/cdk/testing';

export class CheckInScannerComponentHarness extends ComponentHarness {
  static hostSelector = 'app-check-in-scanner';

  private getSoundToggle = this.locatorFor('[data-testid="sound-toggle"]');
  private getEnableSoundButton = this.locatorForOptional(
    '[data-testid="enable-sound-button"]',
  );
  private getScanResultRegion = this.locatorFor('[aria-live="assertive"]');
  private getLastResultEl = this.locatorForOptional(
    '[data-testid="scan-result"]',
  );
  private getCameraStartupError = this.locatorForOptional(
    '[data-testid="camera-startup-error"]',
  );
  private getButtons = this.locatorForAll('button, z-button');

  async clickSoundToggle(): Promise<void> {
    const toggle = await this.getSoundToggle();
    await toggle.click();
  }

  async getSoundToggleLabel(): Promise<string | null> {
    const toggle = await this.getSoundToggle();
    return toggle.getAttribute('aria-label');
  }

  async isSoundEnabled(): Promise<boolean> {
    const label = await this.getSoundToggleLabel();
    return label === 'Mute scanner sounds';
  }

  async isEnableSoundFallbackVisible(): Promise<boolean> {
    return (await this.getEnableSoundButton()) !== null;
  }

  async clickEnableSoundFallback(): Promise<void> {
    const button = await this.getEnableSoundButton();
    if (!button) throw new Error('Enable sound fallback button not visible');
    await button.click();
  }

  async isScanResultRegionPresent(): Promise<boolean> {
    try {
      await this.getScanResultRegion();
      return true;
    } catch {
      return false;
    }
  }

  async isCheckInResultVisible(): Promise<boolean> {
    return (await this.getLastResultEl()) !== null;
  }

  async isLastResultSuccess(): Promise<boolean> {
    const resultEl = await this.getLastResultEl();
    if (!resultEl) return false;
    const text = await resultEl.text();
    return text.includes('AUTHENTICATED');
  }

  async isLastResultRejected(): Promise<boolean> {
    const resultEl = await this.getLastResultEl();
    if (!resultEl) return false;
    const text = await resultEl.text();
    return text.includes('REJECTED');
  }

  async getResultMessage(): Promise<string | null> {
    const resultEl = await this.getLastResultEl();
    return resultEl ? resultEl.text() : null;
  }

  async clickStartScanner(): Promise<void> {
    const buttons = await this.getButtons();
    for (const button of buttons) {
      const ariaLabel = await button.getAttribute('aria-label');
      const text = await button.text();
      if (
        ariaLabel === 'Start QR code scanning' ||
        text.includes('START SCANNER')
      ) {
        await button.click();
        return;
      }
    }
    throw new Error('Start scanner button not found');
  }

  async getCameraStartupErrorText(): Promise<string | null> {
    const error = await this.getCameraStartupError();
    return error ? error.text() : null;
  }
}
