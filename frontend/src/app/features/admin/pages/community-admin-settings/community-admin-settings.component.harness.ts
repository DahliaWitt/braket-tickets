import {ComponentHarness, HarnessPredicate} from '@angular/cdk/testing';
import {ZardSelectComponentHarness} from '@/ui/components/primitives/select/select.component.harness';

export class CommunityAdminSettingsHarness extends ComponentHarness {
  static hostSelector = 'app-community-admin-settings';

  static with(
    options: {selector?: string} = {},
  ): HarnessPredicate<CommunityAdminSettingsHarness> {
    return new HarnessPredicate(CommunityAdminSettingsHarness, options);
  }

  // ─── Profile ───────────────────────────────────────
  private _profileName = this.locatorFor('[data-testid="profile-name"]');
  private _profileEmail = this.locatorFor('[data-testid="profile-email"]');
  private _profileContactInfo = this.locatorFor(
    '[data-testid="profile-contactInfo"]',
  );
  private _profileDescription = this.locatorFor(
    '[data-testid="profile-description"]',
  );
  private _profileWebsite = this.locatorFor('[data-testid="profile-website"]');
  private _profileSlug = this.locatorFor('[data-testid="profile-slug"]');
  private _statusDraft = this.locatorFor(
    '[data-testid="profile-status-draft"]',
  );
  private _statusPublished = this.locatorFor(
    '[data-testid="profile-status-published"]',
  );
  private _logoPreview = this.locatorForOptional(
    '[data-testid="logo-preview"]',
  );
  private _removeLogo = this.locatorForOptional('[data-testid="remove-logo"]');
  private _publicDirectoryToggle = this.locatorForOptional(
    '[data-testid="public-directory-toggle"]',
  );
  private _saveProfile = this.locatorFor('[data-testid="save-profile"]');
  private _logoLabel = this.locatorForOptional('label[for="logoUpload"]');
  private _logoUpload = this.locatorForOptional('[data-testid="logo-upload"]');
  private _profileStatusDraft = this.locatorForOptional(
    '[data-testid="profile-status-draft"]',
  );
  private _profileStatusPublishedEl = this.locatorForOptional(
    '[data-testid="profile-status-published"]',
  );

  // Section locators
  private _sectionProfile = this.locatorForOptional(
    '[data-testid="section-profile"]',
  );
  private _sectionPayments = this.locatorForOptional(
    '[data-testid="section-payments"]',
  );
  private _sectionVetting = this.locatorForOptional(
    '[data-testid="section-vetting"]',
  );
  private _sectionTeam = this.locatorForOptional(
    '[data-testid="section-team"]',
  );
  private _settingsSkeleton = this.locatorForOptional(
    '[data-testid="settings-skeleton"]',
  );

  async getProfileName(): Promise<string> {
    const el = await this._profileName();
    return (await el.getProperty<string>('value')) ?? '';
  }

  async setProfileName(value: string): Promise<void> {
    const el = await this._profileName();
    await el.clear();
    await el.sendKeys(value);
  }

  async getProfileEmail(): Promise<string> {
    const el = await this._profileEmail();
    return (await el.getProperty<string>('value')) ?? '';
  }

  async setProfileEmail(value: string): Promise<void> {
    const el = await this._profileEmail();
    await el.clear();
    await el.sendKeys(value);
  }

  async getProfileDescription(): Promise<string> {
    const el = await this._profileDescription();
    return (await el.getProperty<string>('value')) ?? '';
  }

  async setProfileDescription(value: string): Promise<void> {
    const el = await this._profileDescription();
    await el.clear();
    await el.sendKeys(value);
  }

  async getProfileSlug(): Promise<string> {
    const el = await this._profileSlug();
    return (await el.getProperty<string>('value')) ?? '';
  }

  async setProfileSlug(value: string): Promise<void> {
    const el = await this._profileSlug();
    await el.clear();
    await el.sendKeys(value);
  }

  async setStatusDraft(): Promise<void> {
    const btn = await this._statusDraft();
    await btn.click();
  }

  async setStatusPublished(): Promise<void> {
    const btn = await this._statusPublished();
    await btn.click();
  }

  async getDraftAriaPressed(): Promise<string | null> {
    const btn = await this._statusDraft();
    return btn.getAttribute('aria-pressed');
  }

  async getPublishedAriaPressed(): Promise<string | null> {
    const btn = await this._statusPublished();
    return btn.getAttribute('aria-pressed');
  }

  async isLogoVisible(): Promise<boolean> {
    const el = await this._logoPreview();
    return el !== null;
  }

  async removeLogo(): Promise<void> {
    const btn = await this._removeLogo();
    if (!btn) throw new Error('Remove logo button not found');
    await btn.click();
  }

  async isPublicDirectoryChecked(): Promise<boolean> {
    const el = await this._publicDirectoryToggle();
    if (!el) return false;
    return (await el.getProperty<boolean>('checked')) ?? false;
  }

  async togglePublicDirectory(): Promise<void> {
    const el = await this._publicDirectoryToggle();
    if (!el) throw new Error('Public directory toggle not found');
    await el.click();
  }

  async clickSaveProfile(): Promise<void> {
    const btn = await this._saveProfile();
    await btn.click();
  }

  async isSaveProfileDisabled(): Promise<boolean> {
    const btn = await this._saveProfile();
    return (await btn.getAttribute('disabled')) !== null;
  }

  async isPublishButtonDisabled(): Promise<boolean> {
    const el = await this._statusPublished();
    return (await el.getAttribute('disabled')) !== null;
  }

  private _publishBlockedWarning = this.locatorForOptional(
    '[data-testid="publish-blocked-warning"]',
  );

  async isPublishBlockedWarningVisible(): Promise<boolean> {
    return (await this._publishBlockedWarning()) !== null;
  }

  // ─── Char counters and validation errors ───────────
  private _profileNameCharCount = this.locatorForOptional(
    '[data-testid="profile-name-char-count"]',
  );
  private _profileNameMaxlengthError = this.locatorForOptional(
    '[data-testid="profile-name-maxlength"]',
  );
  private _profileDescriptionCharCount = this.locatorForOptional(
    '[data-testid="profile-description-char-count"]',
  );
  private _profileDescriptionMaxlengthError = this.locatorForOptional(
    '[data-testid="profile-description-maxlength"]',
  );

  async getNameCharCountText(): Promise<string | null> {
    const el = await this._profileNameCharCount();
    return el ? (await el.text()).trim() : null;
  }

  async getNameMaxlengthError(): Promise<string | null> {
    const el = await this._profileNameMaxlengthError();
    return el ? (await el.text()).trim() : null;
  }

  async getDescriptionCharCountText(): Promise<string | null> {
    const el = await this._profileDescriptionCharCount();
    return el ? (await el.text()).trim() : null;
  }

  async getDescriptionMaxlengthError(): Promise<string | null> {
    const el = await this._profileDescriptionMaxlengthError();
    return el ? (await el.text()).trim() : null;
  }

  async getNameInputMaxlength(): Promise<string | null> {
    const el = await this._profileName();
    return el.getAttribute('maxlength');
  }

  async getDescriptionInputMaxlength(): Promise<string | null> {
    const el = await this._profileDescription();
    return el.getAttribute('maxlength');
  }

  // ─── Payments / Stripe ─────────────────────────────
  // V2 note: the Express dashboard button + resume-onboarding button
  // were removed when the embedded Connect components replaced the
  // hosted redirect flows. Status and the "Connect with Stripe" button
  // remain; everything else is driven by the embedded component.
  private _stripeSection = this.locatorFor(
    '[data-testid="stripe-connect-section"]',
  );
  private _stripeConnectedStatus = this.locatorForOptional(
    '[data-testid="stripe-connected-status"]',
  );
  private _stripeOnboardingIncomplete = this.locatorForOptional(
    '[data-testid="stripe-onboarding-incomplete"]',
  );
  private _connectWithStripeBtn = this.locatorForOptional(
    '[data-testid="connect-with-stripe-btn"]',
  );
  private _stripeConnectEmbed = this.locatorForOptional(
    '[data-testid="stripe-connect-embed"]',
  );
  private _stripeError = this.locatorForOptional(
    '[data-testid="stripe-error"]',
  );

  async isStripeConnected(): Promise<boolean> {
    const el = await this._stripeConnectedStatus();
    return el !== null;
  }

  async isStripeOnboardingIncomplete(): Promise<boolean> {
    const el = await this._stripeOnboardingIncomplete();
    return el !== null;
  }

  async clickConnectWithStripe(): Promise<void> {
    const btn = await this._connectWithStripeBtn();
    if (!btn) throw new Error('Connect with Stripe button not found');
    await btn.click();
  }

  async clickContinueStripeOnboarding(): Promise<void> {
    const btn = await this.locatorForOptional(
      '[data-testid="continue-stripe-onboarding-btn"]',
    )();
    if (!btn) throw new Error('Continue Stripe onboarding button not found');
    await btn.click();
  }

  async hasStripeConnectEmbed(): Promise<boolean> {
    const el = await this._stripeConnectEmbed();
    return el !== null;
  }

  async getStripeError(): Promise<string | null> {
    const el = await this._stripeError();
    return el ? (await el.text()).trim() : null;
  }

  // ─── Vetting Questions ─────────────────────────────
  private _addQuestion = this.locatorFor('[data-testid="add-question"]');
  private _vettingQuestions = this.locatorForAll(
    '[data-testid="vetting-question"]',
  );
  private _vettingEmpty = this.locatorForOptional(
    '[data-testid="vetting-empty"]',
  );
  private _saveVetting = this.locatorForOptional(
    '[data-testid="save-vetting"]',
  );

  async clickAddQuestion(): Promise<void> {
    const btn = await this._addQuestion();
    await btn.click();
  }

  async getVettingQuestionCount(): Promise<number> {
    const els = await this._vettingQuestions();
    return els.length;
  }

  async isVettingEmpty(): Promise<boolean> {
    const el = await this._vettingEmpty();
    return el !== null;
  }

  async clickSaveVetting(): Promise<void> {
    const btn = await this._saveVetting();
    if (!btn) throw new Error('Save vetting button not found');
    await btn.click();
  }

  // ─── Team Management ───────────────────────────────
  private _adminEmailInput = this.locatorFor(
    '[data-testid="admin-email-input"]',
  );
  private _grantAdminBtn = this.locatorFor('[data-testid="grant-admin"]');
  private _adminList = this.locatorForOptional('[data-testid="admin-list"]');
  private _removeAdminBtns = this.locatorForAll('[data-testid="remove-admin"]');
  private _adminEmpty = this.locatorForOptional('[data-testid="admin-empty"]');

  private _scannerEmailInput = this.locatorFor(
    '[data-testid="scanner-email-input"]',
  );
  private _grantScannerBtn = this.locatorFor('[data-testid="grant-scanner"]');
  private _scannerList = this.locatorForOptional(
    '[data-testid="scanner-list"]',
  );
  private _removeScannerBtns = this.locatorForAll(
    '[data-testid="remove-scanner"]',
  );
  private _scannerEmpty = this.locatorForOptional(
    '[data-testid="scanner-empty"]',
  );
  private _doorStaffHelp = this.locatorForOptional(
    '[data-testid="door-staff-help"]',
  );

  async setAdminEmail(email: string): Promise<void> {
    const el = await this._adminEmailInput();
    await el.clear();
    await el.sendKeys(email);
  }

  async clickGrantAdmin(): Promise<void> {
    const btn = await this._grantAdminBtn();
    await btn.click();
  }

  async getAdminCount(): Promise<number> {
    const btns = await this._removeAdminBtns();
    return btns.length;
  }

  async isAdminListEmpty(): Promise<boolean> {
    const el = await this._adminEmpty();
    return el !== null;
  }

  async setScannerEmail(email: string): Promise<void> {
    const el = await this._scannerEmailInput();
    await el.clear();
    await el.sendKeys(email);
  }

  async clickGrantScanner(): Promise<void> {
    const btn = await this._grantScannerBtn();
    await btn.click();
  }

  async getScannerCount(): Promise<number> {
    const btns = await this._removeScannerBtns();
    return btns.length;
  }

  async isScannerListEmpty(): Promise<boolean> {
    const el = await this._scannerEmpty();
    return el !== null;
  }

  async getDoorStaffHelpText(): Promise<string | null> {
    const el = await this._doorStaffHelp();
    return el ? (await el.text()).trim() : null;
  }

  // ─── Notifications ─────────────────────────────────
  private _notificationsSection = this.locatorFor(
    '[data-testid="notifications-section"]',
  );
  private _digestHourSelect = this.locatorForOptional(
    '[data-testid="digest-hour-select"]',
  );
  private _saveNotificationsBtn = this.locatorFor(
    '[data-testid="save-notifications-btn"]',
  );

  async hasNotificationsSection(): Promise<boolean> {
    const el = await this._notificationsSection();
    return el !== null;
  }

  async hasDigestHourSelect(): Promise<boolean> {
    const el = await this._digestHourSelect();
    return el !== null;
  }

  async getNotificationModeSelect(): Promise<ZardSelectComponentHarness> {
    return this.locatorFor(ZardSelectComponentHarness)();
  }

  async selectNotifMode(mode: 'off' | 'all' | 'digest'): Promise<void> {
    const select = await this.getNotificationModeSelect();
    await select.selectOptionByValue(mode);
  }

  async getSelectedNotifMode(): Promise<string> {
    const select = await this.getNotificationModeSelect();
    const text = await select.getSelectedText();
    if (text.includes('Off')) return 'off';
    if (text.includes('All') || text.includes('immediate')) return 'all';
    if (text.includes('Daily digest')) return 'digest';
    return 'off';
  }

  async clickSaveNotifications(): Promise<void> {
    const btn = await this._saveNotificationsBtn();
    await btn.click();
  }

  async isSaveNotificationsDisabled(): Promise<boolean> {
    const btn = await this._saveNotificationsBtn();
    return (await btn.getAttribute('disabled')) !== null;
  }

  // ─── Aliases for test compatibility ───────────────────
  async typeInProfileName(value: string): Promise<void> {
    return this.setProfileName(value);
  }
  async getProfileNameValue(): Promise<string> {
    return this.getProfileName();
  }
  async getProfileEmailValue(): Promise<string> {
    return this.getProfileEmail();
  }
  async typeAdminEmail(email: string): Promise<void> {
    return this.setAdminEmail(email);
  }
  async clickSave(): Promise<void> {
    return this.clickSaveProfile();
  }
  async isSaveButtonDisabled(): Promise<boolean> {
    return this.isSaveProfileDisabled();
  }
  async clickProfileStatusPublished(): Promise<void> {
    return this.setStatusPublished();
  }
  async getQuestionCount(): Promise<number> {
    return this.getVettingQuestionCount();
  }

  // Section existence checks
  async hasSettingsSkeleton(): Promise<boolean> {
    return (await this._settingsSkeleton()) !== null;
  }
  async hasProfileSection(): Promise<boolean> {
    return (await this._sectionProfile()) !== null;
  }
  async hasPaymentsSection(): Promise<boolean> {
    return (await this._sectionPayments()) !== null;
  }
  async hasVettingSection(): Promise<boolean> {
    return (await this._sectionVetting()) !== null;
  }
  async hasTeamSection(): Promise<boolean> {
    return (await this._sectionTeam()) !== null;
  }
  async hasProfileDescription(): Promise<boolean> {
    return (
      (await this.locatorForOptional(
        '[data-testid="profile-description"]',
      )()) !== null
    );
  }
  async hasProfileWebsite(): Promise<boolean> {
    return (
      (await this.locatorForOptional('[data-testid="profile-website"]')()) !==
      null
    );
  }
  async hasProfileSlug(): Promise<boolean> {
    return (
      (await this.locatorForOptional('[data-testid="profile-slug"]')()) !== null
    );
  }
  async hasLogoUpload(): Promise<boolean> {
    return (await this._logoUpload()) !== null;
  }
  async hasPublicDirectoryToggle(): Promise<boolean> {
    return (await this._publicDirectoryToggle()) !== null;
  }
  async hasProfileStatusDraft(): Promise<boolean> {
    return (await this._profileStatusDraft()) !== null;
  }
  async hasProfileStatusPublished(): Promise<boolean> {
    return (await this._profileStatusPublishedEl()) !== null;
  }
  async hasVettingEmptyState(): Promise<boolean> {
    return (await this._vettingEmpty()) !== null;
  }
  async getVettingEmptyText(): Promise<string | null> {
    const el = await this._vettingEmpty();
    return el ? (await el.text()).trim() : null;
  }
  async hasAdminList(): Promise<boolean> {
    return (await this._adminList()) !== null;
  }
  async hasScannerList(): Promise<boolean> {
    return (await this._scannerList()) !== null;
  }
  async hasScannerEmptyState(): Promise<boolean> {
    return (await this._scannerEmpty()) !== null;
  }
  async getAdminListText(): Promise<string | null> {
    const el = await this._adminList();
    return el ? (await el.text()).trim() : null;
  }
  async getScannerListText(): Promise<string | null> {
    const el = await this._scannerList();
    return el ? (await el.text()).trim() : null;
  }
  async getLogoLabelFor(): Promise<string | null> {
    const el = await this._logoLabel();
    return el ? el.getAttribute('for') : null;
  }
  async getLogoUploadId(): Promise<string | null> {
    const el = await this._logoUpload();
    return el ? el.getAttribute('id') : null;
  }

  async getLogoUploadAccept(): Promise<string | null> {
    const el = await this._logoUpload();
    return el ? el.getAttribute('accept') : null;
  }

  async getProfileContactInfoValue(): Promise<string> {
    const el = await this.locatorForOptional(
      '[data-testid="profile-contactInfo"]',
    )();
    return el ? ((await el.getProperty<string>('value')) ?? '') : '';
  }

  async hasSaveVettingButton(): Promise<boolean> {
    return (await this._saveVetting()) !== null;
  }

  async isSaveVettingDisabled(): Promise<boolean> {
    const btn = await this._saveVetting();
    if (!btn) return true;
    return (await btn.getAttribute('disabled')) !== null;
  }

  // ─── Label associations (BRA-343) ─────────────────
  /** Returns true when both `<label for="inputId">` and `#inputId` exist in the DOM. */
  async hasLabelForInput(inputId: string): Promise<boolean> {
    const label = await this.locatorForOptional(`label[for="${inputId}"]`)();
    const input = await this.locatorForOptional(`#${inputId}`)();
    return label !== null && input !== null;
  }

  /** Returns the aria-label attribute value for the element identified by data-testid. */
  async getInputAriaLabel(testId: string): Promise<string | null> {
    const el = await this.locatorForOptional(`[data-testid="${testId}"]`)();
    return el ? el.getAttribute('aria-label') : null;
  }
}
