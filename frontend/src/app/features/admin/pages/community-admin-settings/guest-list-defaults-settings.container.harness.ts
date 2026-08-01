import {ComponentHarness} from '@angular/cdk/testing';
import {GuestListDefaultsSettingsHarness} from './guest-list-defaults-settings.component.harness';

export class GuestListDefaultsSettingsContainerHarness extends ComponentHarness {
  static hostSelector = 'app-guest-list-defaults-settings-container';

  private readonly loading = this.locatorForOptional(
    '[data-testid="guest-list-defaults-loading"]',
  );
  private readonly error = this.locatorForOptional(
    '[data-testid="guest-list-defaults-error"]',
  );
  private readonly settings = this.locatorForOptional(
    GuestListDefaultsSettingsHarness,
  );

  async getState(): Promise<'loading' | 'error' | 'ready'> {
    if (await this.loading()) return 'loading';
    if (await this.error()) return 'error';
    if (await this.settings()) return 'ready';
    throw new Error('Guest list defaults has no rendered state');
  }

  getSettings(): Promise<GuestListDefaultsSettingsHarness | null> {
    return this.settings();
  }
}
