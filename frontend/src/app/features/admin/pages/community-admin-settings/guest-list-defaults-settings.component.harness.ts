import {ComponentHarness} from '@angular/cdk/testing';

export class GuestListDefaultsSettingsHarness extends ComponentHarness {
  static hostSelector = 'app-guest-list-defaults-settings';

  private readonly artistSlots = this.locatorFor(
    '[data-testid="artist-guest-slots"]',
  );
  private readonly staffSlots = this.locatorFor(
    '[data-testid="staff-guest-slots"]',
  );
  private readonly helpTrigger = this.locatorFor(
    '[data-testid="guest-list-defaults-help"]',
  );
  private readonly helpText = this.locatorFor(
    '[data-testid="guest-list-defaults-help-text"]',
  );
  private readonly saveButton = this.locatorFor(
    '[data-testid="save-guest-list-defaults"]',
  );

  async getArtistSlots(): Promise<string> {
    return (await (await this.artistSlots()).getProperty('value')) ?? '';
  }

  async getStaffSlots(): Promise<string> {
    return (await (await this.staffSlots()).getProperty('value')) ?? '';
  }

  async setArtistSlots(value: string): Promise<void> {
    const input = await this.artistSlots();
    await input.clear();
    await input.sendKeys(value);
  }

  async setStaffSlots(value: string): Promise<void> {
    const input = await this.staffSlots();
    await input.clear();
    await input.sendKeys(value);
  }

  async getHelpText(): Promise<string> {
    return (await (await this.helpText()).text()).trim();
  }

  async getHelpAriaDescribedBy(): Promise<string | null> {
    return (await this.helpTrigger()).getAttribute('aria-describedby');
  }

  async clickSave(): Promise<void> {
    await (await this.saveButton()).click();
  }
}
