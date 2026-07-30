import {ComponentHarness, type TestElement} from '@angular/cdk/testing';
import {ImportSurfaceComponentHarness} from '@/features/admin/import/import-surface.component.harness';

export class GuestListAssignmentsHarness extends ComponentHarness {
  static hostSelector = 'app-guest-list-assignments';

  private readonly overview = this.locatorFor(
    '[data-testid="guest-list-overview"]',
  );
  private readonly rows = this.locatorForAll(
    '[data-testid="guest-list-assignment-row"]',
  );
  private readonly revokeButtons = this.locatorForAll(
    '[data-testid="revoke-assignment"]',
  );
  private readonly revokeWarning = this.locatorForOptional(
    '[data-testid="revoke-assignment-warning"]',
  );
  private readonly confirmRevokeButton = this.locatorForOptional(
    '[data-testid="confirm-revoke-assignment"]',
  );
  private readonly cancelRevokeButton = this.locatorForOptional(
    '[data-testid="cancel-revoke-assignment"]',
  );
  private readonly searchInput = this.locatorFor(
    '[data-testid="assignment-member-search"]',
  );
  private readonly searchButton = this.locatorFor(
    '[data-testid="assignment-member-search-button"]',
  );
  private readonly searchResults = this.locatorForAll(
    '[data-testid="assignment-member-result"]',
  );
  private readonly searchResultsList = this.locatorForOptional(
    '[data-testid="assignment-member-results"]',
  );
  private readonly displayNameInput = this.locatorFor(
    '[data-testid="assignment-display-name"]',
  );
  private readonly emailInput = this.locatorFor(
    '[data-testid="assignment-email"]',
  );
  private readonly roleSelect = this.locatorFor(
    '[data-testid="assignment-role"]',
  );
  private readonly grantInput = this.locatorFor(
    '[data-testid="assignment-grant-override"]',
  );
  private readonly inviteButton = this.locatorFor(
    '[data-testid="create-assignment"]',
  );
  private readonly grantOverrideError = this.locatorForOptional(
    '[data-testid="assignment-grant-override-error"]',
  );
  private readonly identityErrors = this.locatorForAll(
    '[data-testid="assignment-identity-error"]',
  );
  private readonly importButton = this.locatorFor(
    '[data-testid="import-staff-assignments"]',
  );
  private readonly importSurface = this.locatorForOptional(
    ImportSurfaceComponentHarness,
  );
  private readonly editGrantButtons = this.locatorForAll(
    '[data-testid="edit-assignment-grant"]',
  );
  private readonly editGrantInput = this.locatorForOptional(
    '[data-testid="edit-assignment-grant-input"]',
  );
  private readonly saveGrantButton = this.locatorForOptional(
    '[data-testid="save-assignment-grant"]',
  );
  private readonly grantWarning = this.locatorForOptional(
    '[data-testid="grant-reduction-warning"]',
  );
  private readonly confirmGrantButton = this.locatorForOptional(
    '[data-testid="confirm-grant-reduction"]',
  );
  private readonly cancelGrantButton = this.locatorForOptional(
    '[data-testid="cancel-grant-reduction"]',
  );
  private readonly expandButtons = this.locatorForAll(
    '[data-testid="expand-assignment-guests"]',
  );
  private readonly sourcedGuestRows = this.locatorForAll(
    '[data-testid="sourced-guest-row"]',
  );
  private readonly sourcedGuestLoadMore = this.locatorForOptional(
    '[data-testid="load-more-sourced-guests"]',
  );
  private readonly retrySourcedGuests = this.locatorForOptional(
    '[data-testid="retry-sourced-guests"]',
  );
  private readonly actionError = this.locatorForOptional(
    '[data-testid="guest-list-assignment-action-error"]',
  );
  private readonly loadMore = this.locatorForOptional(
    '[data-testid="load-more-assignments"]',
  );

  async getOverviewText(): Promise<string> {
    return (await this.overview()).text();
  }

  async getRowTexts(): Promise<string[]> {
    return Promise.all((await this.rows()).map((row) => row.text()));
  }

  async clickRevoke(index = 0): Promise<void> {
    const button = (await this.revokeButtons())[index];
    if (!button) throw new Error(`No revoke button at index ${index}`);
    await button.click();
  }

  async getRevokeWarningText(): Promise<string | null> {
    const warning = await this.revokeWarning();
    return warning ? (await warning.text()).trim() : null;
  }

  async clickConfirmRevoke(): Promise<void> {
    const button = await this.confirmRevokeButton();
    if (!button) throw new Error('Revoke warning is not open');
    await button.click();
  }

  async getRevokeConfirmationState(): Promise<{
    confirmDisabled: boolean;
    confirmBusy: boolean;
    cancelDisabled: boolean;
  }> {
    const confirm = await this.confirmRevokeButton();
    const cancel = await this.cancelRevokeButton();
    if (!confirm || !cancel) throw new Error('Revoke warning is not open');
    return {
      confirmDisabled: (await confirm.getAttribute('disabled')) !== null,
      confirmBusy: (await confirm.getAttribute('aria-busy')) === 'true',
      cancelDisabled: (await cancel.getAttribute('disabled')) !== null,
    };
  }

  async searchMembers(term: string): Promise<void> {
    const input = await this.searchInput();
    await input.clear();
    await input.sendKeys(term);
    await (await this.searchButton()).click();
  }

  async selectSearchResult(index = 0): Promise<void> {
    const result = (await this.searchResults())[index];
    if (!result) throw new Error(`No member result at index ${index}`);
    await result.click();
  }

  async getSearchResultSemantics(): Promise<{
    listTag: string | null;
    resultRole: string | null;
  }> {
    const list = await this.searchResultsList();
    const result = (await this.searchResults())[0];
    return {
      listTag: list
        ? String(await list.getProperty('tagName')).toLowerCase()
        : null,
      resultRole: result ? await result.getAttribute('role') : null,
    };
  }

  private async setInput(
    locator: () => Promise<TestElement>,
    value: string,
  ): Promise<void> {
    const input = await locator();
    await input.clear();
    await input.sendKeys(value);
  }

  async setDisplayName(value: string): Promise<void> {
    await this.setInput(this.displayNameInput, value);
  }

  async setEmail(value: string): Promise<void> {
    await this.setInput(this.emailInput, value);
  }

  async setRole(value: 'artist' | 'staff'): Promise<void> {
    const select = await this.roleSelect();
    await select.selectOptions(value === 'artist' ? 0 : 1);
    await select.dispatchEvent('input');
    await select.dispatchEvent('change');
  }

  async setGrantOverride(value: string): Promise<void> {
    await this.setInput(this.grantInput, value);
  }

  async clickInvite(): Promise<void> {
    await (await this.inviteButton()).click();
  }

  async getInviteState(): Promise<{
    disabled: boolean;
    overrideError: string | null;
  }> {
    const button = await this.inviteButton();
    const error = await this.grantOverrideError();
    return {
      disabled: (await button.getAttribute('disabled')) !== null,
      overrideError: error ? (await error.text()).trim() : null,
    };
  }

  async getIdentityErrors(): Promise<string[]> {
    return Promise.all(
      (await this.identityErrors()).map(async (error) =>
        (await error.text()).trim(),
      ),
    );
  }

  async clickImportStaff(): Promise<void> {
    await (await this.importButton()).click();
  }

  async getImportSurface(): Promise<ImportSurfaceComponentHarness | null> {
    return this.importSurface();
  }

  async clickEditGrant(index = 0): Promise<void> {
    const button = (await this.editGrantButtons())[index];
    if (!button) throw new Error(`No edit grant button at index ${index}`);
    await button.click();
  }

  async setEditedGrant(value: string): Promise<void> {
    const input = await this.editGrantInput();
    if (!input) throw new Error('Grant input is not open');
    await input.clear();
    await input.sendKeys(value);
  }

  async clickSaveGrant(): Promise<void> {
    const button = await this.saveGrantButton();
    if (!button) throw new Error('Save grant button is not open');
    await button.click();
  }

  async getGrantWarningText(): Promise<string | null> {
    const warning = await this.grantWarning();
    return warning ? (await warning.text()).trim() : null;
  }

  async clickConfirmGrantReduction(): Promise<void> {
    const button = await this.confirmGrantButton();
    if (!button) throw new Error('Grant warning is not open');
    await button.click();
  }

  async clickCancelGrantReduction(): Promise<void> {
    const button = await this.cancelGrantButton();
    if (!button) throw new Error('Grant warning is not open');
    await button.click();
  }

  async getGrantConfirmationState(): Promise<{
    confirmDisabled: boolean;
    confirmBusy: boolean;
    cancelDisabled: boolean;
  }> {
    const confirm = await this.confirmGrantButton();
    const cancel = await this.cancelGrantButton();
    if (!confirm || !cancel) throw new Error('Grant warning is not open');
    return {
      confirmDisabled: (await confirm.getAttribute('disabled')) !== null,
      confirmBusy: (await confirm.getAttribute('aria-busy')) === 'true',
      cancelDisabled: (await cancel.getAttribute('disabled')) !== null,
    };
  }

  async getGrantWarningRole(): Promise<string | null> {
    const warning = await this.grantWarning();
    return warning?.getAttribute('role') ?? null;
  }

  async isGrantWarningFocused(): Promise<boolean> {
    const warning = await this.grantWarning();
    return warning?.isFocused() ?? false;
  }

  async isCancelGrantFocused(): Promise<boolean> {
    const button = await this.cancelGrantButton();
    return button?.isFocused() ?? false;
  }

  async dismissGrantWarningWithEscape(): Promise<void> {
    const button = await this.cancelGrantButton();
    if (!button) throw new Error('Grant warning is not open');
    await button.dispatchEvent('keydown', {key: 'Escape'});
  }

  async isSaveGrantFocused(): Promise<boolean> {
    const button = await this.saveGrantButton();
    return button?.isFocused() ?? false;
  }

  async isRowFocused(index = 0): Promise<boolean> {
    const row = (await this.rows())[index];
    if (!row) throw new Error(`No assignment row at index ${index}`);
    return row.isFocused();
  }

  async clickExpandGuests(index = 0): Promise<void> {
    const button = (await this.expandButtons())[index];
    if (!button) throw new Error(`No expand button at index ${index}`);
    await button.click();
  }

  async getSourcedGuestTexts(): Promise<string[]> {
    return Promise.all(
      (await this.sourcedGuestRows()).map((row) => row.text()),
    );
  }

  async clickLoadMoreSourcedGuests(): Promise<void> {
    const button = await this.sourcedGuestLoadMore();
    if (!button) throw new Error('No sourced guest load more button');
    await button.click();
  }

  async hasSourcedGuestLoadMore(): Promise<boolean> {
    return (await this.sourcedGuestLoadMore()) !== null;
  }

  async hasSourcedGuestRetry(): Promise<boolean> {
    return (await this.retrySourcedGuests()) !== null;
  }

  async clickRetrySourcedGuests(): Promise<void> {
    const button = await this.retrySourcedGuests();
    if (!button) throw new Error('No sourced guest retry button');
    await button.click();
  }

  async getActionErrorText(): Promise<string | null> {
    const error = await this.actionError();
    return error ? (await error.text()).trim() : null;
  }

  async clickLoadMore(): Promise<void> {
    const button = await this.loadMore();
    if (!button) throw new Error('No load more button');
    await button.click();
  }

  async hasLoadMore(): Promise<boolean> {
    return (await this.loadMore()) !== null;
  }
}
