import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import {ZardButtonComponentHarness} from '@ui/components/primitives/button/button.component.harness';
import {type SocialProvider} from '@/features/auth/models/external-auth.model';

export class AccountComponentHarness extends ComponentHarness {
  static hostSelector = 'app-account';

  protected getAllButtons = this.locatorForAll(ZardButtonComponentHarness);

  // Password form - use ID selectors since we use [field] directive with Signal Forms
  protected getOldPasswordInput = this.locatorFor('input[id="oldPassword"]');
  protected getNewPasswordInput = this.locatorFor('input[id="newPassword"]');
  protected getConfirmPasswordInput = this.locatorFor(
    'input[id="confirmPassword"]',
  );
  protected getSetPasswordInput = this.locatorFor('input[id="set-password"]');
  protected getSetPasswordConfirmInput = this.locatorFor(
    'input[id="set-password-confirm"]',
  );

  // Profile form
  protected getProfileNameInput = this.locatorFor('input[id="profile-name"]');
  protected getProfileNameLabel = this.locatorFor('label[for="profile-name"]');

  async getPasswordSubmitButton(): Promise<ZardButtonComponentHarness> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const text = await button.getText();
      if (text.includes('UPDATE PASSWORD')) {
        return button;
      }
    }
    throw new Error('Password submit button not found');
  }

  // Current email display
  async getCurrentEmail(): Promise<string | null> {
    const emailEl = this.locatorForOptional('[data-testid="current-email"]');
    const el = await emailEl();
    return el ? el.text() : null;
  }

  // Password form methods
  async setOldPassword(password: string): Promise<void> {
    const input = await this.getOldPasswordInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
    await input.blur();
  }

  async setNewPassword(password: string): Promise<void> {
    const input = await this.getNewPasswordInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
    await input.blur();
  }

  async setNewPasswordWithoutBlur(password: string): Promise<void> {
    const input = await this.getNewPasswordInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
  }

  async setConfirmPassword(password: string): Promise<void> {
    const input = await this.getConfirmPasswordInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
    await input.blur();
  }

  async submitPassword(): Promise<void> {
    const button = await this.getPasswordSubmitButton();
    await button.click();
  }

  async setSetPassword(password: string): Promise<void> {
    const input = await this.getSetPasswordInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
    await input.blur();
  }

  async setSetPasswordConfirm(password: string): Promise<void> {
    const input = await this.getSetPasswordConfirmInput();
    await input.clear();
    if (password) {
      await input.sendKeys(password);
    }
    await input.blur();
  }

  async submitSetPassword(): Promise<void> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const host = await button.host();
      const testId = await host.getAttribute('data-testid');
      if (testId === 'set-password-submit') {
        await button.click();
        return;
      }
    }
    throw new Error('Set password submit button not found');
  }

  async getProviderStatus(provider: SocialProvider): Promise<string | null> {
    const el = await this.locatorForOptional(
      `[data-testid="provider-status-${provider}"]`,
    )();
    return el ? el.text() : null;
  }

  async getProviderMessage(provider: SocialProvider): Promise<string | null> {
    const el = await this.locatorForOptional(
      `[data-testid="provider-message-${provider}"]`,
    )();
    return el ? el.text() : null;
  }

  async getProviderConnectButton(
    provider: SocialProvider,
  ): Promise<ZardButtonComponentHarness | null> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const name = await button
        .host()
        .then((host) => host.getAttribute('data-provider-action'));
      const text = await button.getText();
      const type = await button
        .host()
        .then((host) => host.getAttribute('data-provider-action-type'));
      if (name === provider && type === 'connect' && text.includes('CONNECT')) {
        return button;
      }
    }
    return null;
  }

  async getProviderUnlinkButton(
    provider: SocialProvider,
  ): Promise<ZardButtonComponentHarness | null> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const name = await button
        .host()
        .then((host) => host.getAttribute('data-provider-action'));
      const text = await button.getText();
      const type = await button
        .host()
        .then((host) => host.getAttribute('data-provider-action-type'));
      if (
        name === provider &&
        type === 'disconnect' &&
        text.includes('DISCONNECT')
      ) {
        return button;
      }
    }
    return null;
  }

  async getProviderActionState(
    provider: SocialProvider,
  ): Promise<string | null> {
    const actionButton =
      (await this.getProviderUnlinkButton(provider)) ??
      (await this.getProviderConnectButton(provider));
    if (!actionButton) {
      return null;
    }
    return actionButton
      .host()
      .then((host) => host.getAttribute('data-provider-state'));
  }

  async setProfileName(name: string): Promise<void> {
    const input = await this.getProfileNameInput();
    await input.clear();
    if (name) {
      await input.sendKeys(name);
    }
    await input.blur();
  }

  async setProfileNameWithoutBlur(name: string): Promise<void> {
    const input = await this.getProfileNameInput();
    await input.clear();
    if (name) {
      await input.sendKeys(name);
    }
  }

  async getProfileNameValue(): Promise<string> {
    const input = await this.getProfileNameInput();
    return input.getProperty<string>('value');
  }

  async submitProfile(): Promise<void> {
    const btn = await this.locatorFor('button[id="update-profile"]')();
    await btn.click();
  }

  async getPasswordError(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="password-error"]',
    )();
    return el ? el.text() : null;
  }

  async getNewPasswordValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="new-password-validation"]',
    )();
    return el ? el.text() : null;
  }

  async getNewPasswordMaxLengthValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="new-password-maxlength-validation"]',
    )();
    return el ? el.text() : null;
  }

  async getNewPasswordRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="new-password-required"]',
    )();
    return el ? el.text() : null;
  }

  async getProfileNameRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="profile-name-required"]',
    )();
    return el ? el.text() : null;
  }

  async getProfileNameMaxLengthValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="profile-name-maxlength"]',
    )();
    return el ? el.text() : null;
  }

  async getEmailRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="email-required"]',
    )();
    return el ? el.text() : null;
  }

  async getEmailInvalidValidation(): Promise<string | null> {
    const el = await this.locatorForOptional('[data-testid="email-invalid"]')();
    return el ? el.text() : null;
  }

  async getEmailSameAsCurrentValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="email-same-as-current"]',
    )();
    return el ? el.text() : null;
  }

  async getOldPasswordRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="old-password-required"]',
    )();
    return el ? el.text() : null;
  }

  async getConfirmPasswordRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="confirm-password-required"]',
    )();
    return el ? el.text() : null;
  }

  async getPasswordMismatchValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="password-mismatch"]',
    )();
    return el ? el.text() : null;
  }

  async getPasswordSubmitBlocker(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="password-submit-blocker"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-required"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordMinLengthValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-minlength"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordMaxLengthValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-maxlength"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordConfirmRequiredValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-confirm-required"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordMismatchValidation(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-mismatch"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordSubmitBlocker(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-submit-blocker"]',
    )();
    return el ? el.text() : null;
  }

  // Pending email banner
  async getPendingEmailBanner(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="pending-email-banner"]')();
  }

  async getPendingEmailAddress(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="pending-email-address"]',
    )();
    return el ? el.text() : null;
  }

  async getCancelEmailChangeButton(): Promise<ZardButtonComponentHarness | null> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const host = await button.host();
      const testId = await host.getAttribute('data-testid');
      if (testId === 'cancel-email-change-btn') {
        return button;
      }
    }
    return null;
  }

  async getCancelEmailError(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="cancel-email-error"]',
    )();
    return el ? el.text() : null;
  }

  // Email form methods
  async setNewEmail(value: string): Promise<void> {
    const input = await this.locatorFor('input[id="new-email"]')();
    await input.clear();
    if (value) {
      await input.sendKeys(value);
    }
    await input.blur();
  }

  async submitEmailChange(): Promise<void> {
    const btn = await this.locatorFor('button[id="request-email-change"]')();
    await btn.click();
  }

  async isEmailSubmitEnabled(): Promise<boolean> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const text = await button.getText();
      if (text.includes('REQUEST CHANGE')) {
        return !(await button.isDisabled());
      }
    }
    throw new Error('Email change submit button not found');
  }

  // Password submit enabled/disabled state
  async isPasswordSubmitEnabled(): Promise<boolean> {
    const button = await this.getPasswordSubmitButton();
    return !(await button.isDisabled());
  }

  async isPasswordSubmitDisabled(): Promise<boolean> {
    const button = await this.getPasswordSubmitButton();
    return button.isDisabled();
  }

  // Profile submit enabled/disabled state
  async isProfileSubmitEnabled(): Promise<boolean> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const text = await button.getText();
      if (text.includes('SAVE PROFILE')) {
        return !(await button.isDisabled());
      }
    }
    throw new Error('Profile submit button not found');
  }

  // Email preferences
  getEmailPreferencesCard(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="email-preferences-card"]')();
  }

  async getNoPrefsMessage(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="no-prefs-message"]',
    )();
    return el ? el.text() : null;
  }

  /** Text of the branded error state shown when the email-preferences query fails. */
  async getEmailPrefsErrorText(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="email-prefs-error"]',
    )();
    return el ? el.text() : null;
  }

  async getProviderUnavailableMessage(
    provider: SocialProvider,
  ): Promise<string | null> {
    return this.getProviderMessage(provider);
  }

  async getProviderWarningMessage(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="provider-warning"]',
    )();
    return el ? el.text() : null;
  }

  async getSocialOnlyMessage(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="social-only-message"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordMessage(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-message"]',
    )();
    return el ? el.text() : null;
  }

  async getSetPasswordError(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="set-password-error"]',
    )();
    return el ? el.text() : null;
  }

  getEmailPrefsList(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="email-prefs-list"]')();
  }

  async clickPreferenceToggle(organizerId: string): Promise<void> {
    const input = await this.locatorFor(
      `input[data-testid="pref-toggle-${organizerId}"]`,
    )();
    await input.click();
  }

  async isPreferenceToggleChecked(organizerId: string): Promise<boolean> {
    const input = await this.locatorFor(
      `input[data-testid="pref-toggle-${organizerId}"]`,
    )();
    return input.getProperty<boolean>('checked');
  }

  async getPreferenceToggleText(organizerId: string): Promise<string> {
    const label = await this.locatorFor(
      `[data-testid="pref-toggle-label-${organizerId}"]`,
    )();
    return label.text();
  }

  async isPreferenceToggleDisabled(organizerId: string): Promise<boolean> {
    const input = await this.locatorFor(
      `input[data-testid="pref-toggle-${organizerId}"]`,
    )();
    return input.getProperty<boolean>('disabled');
  }

  async getUnsubAllButton(): Promise<ZardButtonComponentHarness | null> {
    const buttons = await this.getAllButtons();
    for (const button of buttons) {
      const text = await button.getText();
      if (text.includes('Unsubscribe from all')) {
        return button;
      }
    }
    return null;
  }

  async getGlobalOptOutBanner(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="global-optout-banner"]')();
  }

  async getReEnableMarketingButton(): Promise<TestElement | null> {
    return this.locatorForOptional('[data-testid="reenable-marketing-btn"]')();
  }

  async getGlobalOptOutBannerBody(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="global-optout-banner-body"]',
    )();
    return el ? el.text() : null;
  }

  async getGlobalOptOutBannerHeading(): Promise<string | null> {
    const el = await this.locatorForOptional(
      '[data-testid="global-optout-banner-heading"]',
    )();
    return el ? el.text() : null;
  }

  async getPasswordInputAttribute(
    id: string,
    attribute: string,
  ): Promise<string | null> {
    const input = await this.locatorForOptional(`input[id="${id}"]`)();
    return input ? input.getAttribute(attribute) : null;
  }

  async isVisible(): Promise<boolean> {
    const host = await this.host();
    return host !== null;
  }

  /** True while the optimistic-activation loading skeleton is shown. */
  async hasLoadingSkeleton(): Promise<boolean> {
    const el = await this.locatorForOptional(
      '[data-testid="account-loading-skeleton"]',
    )();
    return el !== null;
  }

  /** True when the editable profile name input is rendered. */
  async hasProfileNameInput(): Promise<boolean> {
    const el = await this.locatorForOptional('input[id="profile-name"]')();
    return el !== null;
  }

  async profileNameLabelUsesForegroundToken(): Promise<boolean> {
    const label = await this.getProfileNameLabel();
    const classes = await label.getAttribute('class');
    return classes?.split(/\s+/u).includes('text-foreground') ?? false;
  }
}
