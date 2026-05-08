import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  computed,
  effect,
} from '@angular/core';
import {
  FormField,
  form,
  minLength,
  maxLength,
  required,
  email,
} from '@angular/forms/signals';
import {RouterLink} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

import {type MaybeFieldTree} from '@angular/forms/signals';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';
import {logger} from '@/utils/logger';
import {injectMutation, injectQuery} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {toast} from 'ngx-sonner';
import {readInputChecked} from '@ui/utils/dom-event';
import {cleanErrorMessage, samePendingEmail} from './account.utils';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
  notBlank,
} from '@/utils/signal-form';
import {
  type ExternalAuth,
  type ProviderStatus,
  type SocialProvider,
  CONNECTED_PROVIDERS,
} from '@/features/auth/models/external-auth.model';

type EmailPreferences = FunctionReturnType<
  typeof api.marketing.emails.getUserPreferences
>;

type EmailPreference = EmailPreferences[number];

interface PendingEmailOverride {
  value: string | null;
  expectedServerValue: string | null;
  previousServerValue: string | null;
}

interface EmailPreferenceOverride {
  operationId: number;
  previousValue: boolean;
  expectedServerValue: boolean;
}

interface EmailPreferenceRollback {
  organizerId: string;
  operationId: number;
  previousOverride: EmailPreferenceOverride | undefined;
}

@Component({
  selector: 'app-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    ZardInputDirective,
  ],
  templateUrl: './account.component.html',
})
export class AccountComponent {
  auth = inject(AuthService);
  readonly connectedProviders = CONNECTED_PROVIDERS;

  readonly externalAuths = signal<ExternalAuth[]>([]);
  readonly providerLoading = signal(false);
  readonly providerWarning = signal('');
  readonly setPasswordVisible = signal(false);
  readonly setPasswordConfirmVisible = signal(false);

  readonly setPasswordModel = signal({
    password: '',
    confirmPassword: '',
  });

  readonly setPasswordForm = form(this.setPasswordModel, (f) => {
    required(f.password);
    minLength(f.password, 8);
    maxLength(f.password, 72);
    required(f.confirmPassword);
    maxLength(f.confirmPassword, 72);
  });

  readonly setPasswordLoading = signal(false);
  readonly setPasswordMessage = signal('');
  readonly setPasswordError = signal('');
  readonly setPasswordPasswordsMismatch = computed(() => {
    const password = this.setPasswordForm.password().value();
    const confirmPassword = this.setPasswordForm.confirmPassword().value();
    return password && confirmPassword && password !== confirmPassword;
  });
  readonly setPasswordSubmitBlockerMessage = computed(() =>
    this.setPasswordPasswordsMismatch() ? 'Passwords do not match.' : '',
  );

  readonly connectedProviderStatuses = computed(() =>
    CONNECTED_PROVIDERS.map((providerRow): ProviderStatus => {
      const account = this.externalAuths().find(
        (auth) => auth.provider === providerRow.provider,
      );
      if (account) {
        const hasProviderError = this.isProviderError(
          providerRow.provider,
          account,
        );
        return {
          provider: providerRow.provider,
          state: hasProviderError ? 'error' : 'linked',
          providerId: account.providerId,
          connectedEmail: account.providerEmail,
          emailVerified: account.isEmailVerified,
        };
      }

      return {
        provider: providerRow.provider,
        state: 'unlinked',
      };
    }),
  );

  readonly isSocialOnly = computed(() => {
    const hasPassword = this.externalAuths().some(
      (auth) => auth.provider === 'credential',
    );
    const hasConnectedSocialProvider = this.connectedProviderStatuses().some(
      (status) => this.isProviderConnectedStatus(status),
    );
    return !hasPassword && hasConnectedSocialProvider;
  });

  constructor() {
    void this.refreshProviderStates();
  }

  async refreshProviderStates(): Promise<void> {
    this.providerLoading.set(true);
    this.providerWarning.set('');
    try {
      const methods = await this.auth.getExternalAuths();
      this.externalAuths.set(methods);
    } catch (err: unknown) {
      logger.error('Failed to load connected social accounts', err);
      this.providerWarning.set('Unable to load connected accounts right now.');
    } finally {
      this.providerLoading.set(false);
    }
  }

  providerStatusFor(provider: SocialProvider): ProviderStatus {
    return (
      this.connectedProviderStatuses().find(
        (status) => status.provider === provider,
      ) ?? {
        provider,
        state: 'unlinked',
      }
    );
  }

  providerMessage(provider: SocialProvider): string {
    const status = this.providerStatusFor(provider);
    if (status.state === 'unavailable') return 'Provider unavailable.';

    if (status.state === 'error') {
      if (status.emailVerified === false) {
        return 'This social connection is not verified and cannot be used right now.';
      }
      return 'This connection is not available right now.';
    }

    if (status.state !== 'linked') {
      return 'Not linked';
    }

    const baseMessage = this.connectedProviderMessage(provider, status);
    if (!this.canUnlinkProvider(provider)) {
      return `${baseMessage} Add a password or another provider before disconnecting this login method.`;
    }
    return baseMessage;
  }

  isProviderUnavailable(provider: SocialProvider): boolean {
    return this.providerStatusFor(provider).state === 'unavailable';
  }

  isProviderLinked(provider: SocialProvider): boolean {
    return this.providerStatusFor(provider).state === 'linked';
  }

  isProviderConnected(provider: SocialProvider): boolean {
    return (
      this.providerStatusFor(provider).state === 'linked' ||
      this.providerStatusFor(provider).state === 'error'
    );
  }

  canUnlinkProvider(provider: SocialProvider): boolean {
    const providerState = this.providerStatusFor(provider).state;
    if (providerState !== 'linked' && providerState !== 'error') return false;

    const hasPassword = this.externalAuths().some(
      (auth) => auth.provider === 'credential',
    );
    if (hasPassword) return true;

    const remainingUsableCount = this.connectedProviderStatuses().filter(
      (status) => status.provider !== provider && this.isProviderUsable(status),
    ).length;

    return remainingUsableCount > 0;
  }

  async onLinkSocial(provider: SocialProvider): Promise<void> {
    this.providerWarning.set('');
    if (this.isProviderConnected(provider) || this.providerLoading()) {
      return;
    }
    this.providerLoading.set(true);
    try {
      await this.auth.linkSocial(provider);
      await this.refreshProviderStates();
    } catch (err: unknown) {
      this.providerWarning.set('Unable to connect provider right now.');
      logger.error('Failed to start provider linking flow', err);
    } finally {
      this.providerLoading.set(false);
    }
  }

  async onUnlinkSocial(provider: SocialProvider): Promise<void> {
    this.providerWarning.set('');
    if (
      !this.canUnlinkProvider(provider) ||
      this.isProviderUnavailable(provider)
    ) {
      if (
        !this.canUnlinkProvider(provider) &&
        this.isProviderConnected(provider)
      ) {
        this.providerWarning.set('Cannot remove the last login method.');
      }
      return;
    }
    this.providerLoading.set(true);
    try {
      await this.auth.unlinkAccount(
        provider,
        this.providerStatusFor(provider).providerId,
      );
      await this.refreshProviderStates();
    } catch (err: unknown) {
      this.providerWarning.set('Unable to unlink provider.');
      logger.error('Failed to unlink provider', err);
    } finally {
      this.providerLoading.set(false);
    }
  }

  async onSetPassword(): Promise<void> {
    if (
      !this.isSocialOnly() ||
      this.setPasswordForm().invalid() ||
      this.setPasswordPasswordsMismatch()
    ) {
      return;
    }
    this.setPasswordLoading.set(true);
    this.setPasswordMessage.set('');
    this.setPasswordError.set('');

    try {
      const values = this.setPasswordModel();
      await this.auth.setPassword(values.password, values.confirmPassword);
      this.setPasswordMessage.set(
        'Password set. You can now sign in with email and password.',
      );
      this.setPasswordModel.set({password: '', confirmPassword: ''});
      await this.refreshProviderStates();
    } catch (err: unknown) {
      this.setPasswordError.set(
        cleanErrorMessage(err, 'Failed to set password.'),
      );
    } finally {
      this.setPasswordLoading.set(false);
    }
  }

  private isProviderError(
    _provider: SocialProvider,
    account: ExternalAuth,
  ): boolean {
    return account.isEmailVerified === false;
  }

  private isProviderUsable(status: ProviderStatus): boolean {
    return status.state === 'linked';
  }

  private isProviderConnectedStatus(status: ProviderStatus): boolean {
    return status.state === 'linked' || status.state === 'error';
  }

  providerStatusLabel(provider: SocialProvider): string {
    const status = this.providerStatusFor(provider);
    if (status.state === 'linked') {
      return 'Connected';
    }
    if (status.state === 'unavailable') {
      return 'Unavailable';
    }
    if (status.state === 'error') {
      return 'Error';
    }
    return 'Not linked';
  }

  private connectedProviderMessage(
    _provider: SocialProvider,
    status: Pick<ProviderStatus, 'connectedEmail' | 'emailVerified'>,
  ): string {
    if (status.connectedEmail) {
      return `Connected as ${status.connectedEmail}.`;
    }

    return 'Connected.';
  }

  readonly passwordModel = signal({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  f = form(this.passwordModel, (f) => {
    required(f.oldPassword);
    maxLength(f.oldPassword, 72); // bcrypt limit
    required(f.newPassword);
    minLength(f.newPassword, 8);
    maxLength(f.newPassword, 72); // bcrypt limit
    required(f.confirmPassword);
    maxLength(f.confirmPassword, 72); // bcrypt limit
  });

  readonly passwordsMismatch = computed(() => {
    const newPassword = this.f.newPassword().value();
    const confirmPassword = this.f.confirmPassword().value();
    return newPassword && confirmPassword && newPassword !== confirmPassword;
  });
  readonly passwordSubmitBlockerMessage = computed(() =>
    this.passwordsMismatch() ? 'Passwords do not match.' : '',
  );

  readonly submitted = signal(false);

  isFieldInvalid<T>(field: MaybeFieldTree<T>, submitted = false): boolean {
    // Account forms disable submit immediately, so dirty invalid fields must surface errors
    // before blur/submit to avoid silent failure states.
    // `submitted` is passed per-form so that one form's submit state cannot contaminate
    // the error display of a sibling form (BRA-357).
    return isSignalFormFieldInvalid(field, submitted, {includeDirty: true});
  }

  hasError<T>(field: MaybeFieldTree<T>, errorKind: string): boolean {
    return signalFormFieldHasError(field, errorKind);
  }

  readonly passwordLoading = signal(false);
  readonly passwordError = signal('');

  // Password visibility signals
  readonly oldPasswordVisible = signal(false);
  readonly newPasswordVisible = signal(false);
  readonly confirmPasswordVisible = signal(false);

  readonly emailLoading = signal(false);
  readonly emailMessage = signal('');
  readonly emailError = signal('');
  readonly cancelEmailLoading = signal(false);
  readonly cancelEmailError = signal('');
  private readonly pendingEmailOverride = signal<PendingEmailOverride | null>(
    null,
  );

  readonly pendingEmail = computed(() => {
    const override = this.pendingEmailOverride();
    if (override) {
      return override.value;
    }
    return this.auth.user()?.pendingEmail ?? null;
  });

  readonly emailFormModel = signal({newEmail: ''});
  emailForm = form(this.emailFormModel, (f) => {
    required(f.newEmail);
    email(f.newEmail);
  });

  readonly emailSameAsCurrent = computed(() => {
    const newEmail = this.emailFormModel().newEmail.trim().toLowerCase();
    const currentEmail = (this.auth.user()?.email ?? '').trim().toLowerCase();
    return newEmail.length > 0 && newEmail === currentEmail;
  });

  readonly profileFormModel = signal({name: ''});
  profileForm = form(this.profileFormModel, (f) => {
    required(f.name);
    notBlank(f.name);
    // BRA-93: Enforce 100 character max length to match backend limit
    maxLength(f.name, 100);
  });
  readonly profileLoading = signal(false);
  readonly profileMessage = signal('');
  readonly profileError = signal('');

  // Email preferences
  readonly emailPrefs = injectQuery(
    api.marketing.emails.getUserPreferences,
    () => ({}),
  );
  readonly globalOptOutQuery = injectQuery(
    api.marketing.emails.getGlobalOptOutStatus,
    () => ({}),
  );
  private readonly emailPrefOverrides = signal<
    ReadonlyMap<string, EmailPreferenceOverride>
  >(new Map());
  private readonly globalOptOutOverride =
    signal<EmailPreferenceOverride | null>(null);
  readonly displayedEmailPrefs = computed<EmailPreferences>(() => {
    const prefs = this.emailPrefs.data() ?? [];
    const overrides = this.emailPrefOverrides();
    if (overrides.size === 0) {
      return prefs;
    }
    return prefs.map((pref: EmailPreference) => {
      const override = overrides.get(pref.organizerId);
      return override === undefined
        ? pref
        : {...pref, optedIn: override.expectedServerValue};
    });
  });
  readonly hasGlobalMarketingOptOut = computed(
    () =>
      this.globalOptOutOverride()?.expectedServerValue ??
      this.globalOptOutQuery.data() ??
      false,
  );
  readonly hasAnyOptedIn = computed(() =>
    this.displayedEmailPrefs().some((p: EmailPreference) => p.optedIn),
  );
  readonly enabledCommunityCount = computed(
    () =>
      this.displayedEmailPrefs().filter((p: EmailPreference) => p.optedIn)
        .length,
  );
  readonly updatePref = injectMutation(
    api.marketing.emails.updateMarketingPreference,
  );
  readonly unsubAllMutation = injectMutation(
    api.marketing.emails.unsubscribeAll,
  );
  readonly clearGlobalOptOut = injectMutation(
    api.marketing.emails.clearGlobalMarketingOptOut,
  );
  readonly reEnableAllMarketing = injectMutation(
    api.marketing.emails.reEnableAll,
  );
  readonly unsubAllLoading = signal(false);
  readonly reEnableMarketingLoading = signal(false);
  private emailPreferenceOperationSeq = 0;
  private readonly rejectedEmailPreferenceOperationIds = new Set<number>();

  onToggleEmailPref(event: Event, organizerId: string): void {
    const checked = readInputChecked(event.target);
    if (checked === null) return;
    void this.toggleEmailPref(organizerId, checked);
  }

  async toggleEmailPref(organizerId: string, optedIn: boolean) {
    const operationId = this.nextEmailPreferenceOperationId();
    const previousOverride = this.emailPrefOverrides().get(organizerId);
    const currentPref = this.displayedEmailPrefs().find(
      (pref: EmailPreference) => pref.organizerId === organizerId,
    );
    this.emailPrefOverrides.update((current) => {
      const next = new Map(current);
      next.set(organizerId, {
        operationId,
        previousValue: currentPref?.optedIn ?? !optedIn,
        expectedServerValue: optedIn,
      });
      return next;
    });

    try {
      await this.updatePref.mutate({
        organizerId: organizerId as Id<'organizers'>,
        optedIn,
      });
      toast.success(
        optedIn
          ? 'Marketing preference enabled.'
          : 'Marketing preference disabled.',
      );
    } catch (err) {
      this.markEmailPreferenceOperationRejected(operationId);
      this.rollbackEmailPreferenceOverrides([
        {organizerId, operationId, previousOverride},
      ]);
      logger.error('Failed to update email preference', err);
      toast.error('Something went wrong. Please try again.');
    }
  }

  async unsubscribeFromAll() {
    const operationId = this.nextEmailPreferenceOperationId();
    const previousOverrides = this.emailPrefOverrides();
    const previousGlobalOptOut = this.globalOptOutOverride();
    const currentPrefs = this.displayedEmailPrefs();
    const preferenceRollbacks = currentPrefs
      .filter((pref: EmailPreference) => !pref.isAdmin)
      .map((pref: EmailPreference) => ({
        organizerId: pref.organizerId,
        operationId,
        previousOverride: previousOverrides.get(pref.organizerId),
      }));

    this.globalOptOutOverride.set({
      operationId,
      previousValue: this.hasGlobalMarketingOptOut(),
      expectedServerValue: true,
    });
    this.emailPrefOverrides.update((current) => {
      const next = new Map(current);
      for (const pref of currentPrefs) {
        if (pref.isAdmin) continue;
        next.set(pref.organizerId, {
          operationId,
          previousValue: pref.optedIn,
          expectedServerValue: false,
        });
      }
      return next;
    });

    this.unsubAllLoading.set(true);
    try {
      await this.unsubAllMutation.mutate({});
      toast.success('Unsubscribed from all marketing emails.');
    } catch (err) {
      this.markEmailPreferenceOperationRejected(operationId);
      this.rollbackEmailPreferenceOverrides(preferenceRollbacks);
      this.rollbackGlobalOptOutOverride(operationId, previousGlobalOptOut);
      logger.error('Failed to unsubscribe all', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      this.unsubAllLoading.set(false);
    }
  }

  async reEnableMarketingEmails(): Promise<void> {
    if (this.reEnableMarketingLoading()) return;

    const operationId = this.nextEmailPreferenceOperationId();
    const previousGlobalOptOut = this.globalOptOutOverride();
    const currentPrefs = this.displayedEmailPrefs();
    const shouldReEnableExistingPrefs = this.enabledCommunityCount() === 0;
    const prefsToReEnable = shouldReEnableExistingPrefs
      ? currentPrefs.filter((pref: EmailPreference) => !pref.optedIn)
      : [];
    const preferenceRollbacks = prefsToReEnable.map(
      (pref: EmailPreference) => ({
        organizerId: pref.organizerId,
        operationId,
        previousOverride: this.emailPrefOverrides().get(pref.organizerId),
      }),
    );

    this.globalOptOutOverride.set({
      operationId,
      previousValue: this.hasGlobalMarketingOptOut(),
      expectedServerValue: false,
    });
    if (prefsToReEnable.length > 0) {
      this.emailPrefOverrides.update((current) => {
        const next = new Map(current);
        for (const pref of prefsToReEnable) {
          next.set(pref.organizerId, {
            operationId,
            previousValue: pref.optedIn,
            expectedServerValue: true,
          });
        }
        return next;
      });
    }

    this.reEnableMarketingLoading.set(true);
    try {
      if (shouldReEnableExistingPrefs) {
        await this.reEnableAllMarketing.mutate({});
      } else {
        await this.clearGlobalOptOut.mutate({});
      }
      toast.success(
        shouldReEnableExistingPrefs
          ? 'Marketing emails re-enabled.'
          : 'Marketing opt-out default cleared.',
      );
    } catch (err) {
      this.markEmailPreferenceOperationRejected(operationId);
      this.rollbackEmailPreferenceOverrides(preferenceRollbacks);
      this.rollbackGlobalOptOutOverride(operationId, previousGlobalOptOut);
      logger.error('Failed to re-enable marketing emails', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      this.reEnableMarketingLoading.set(false);
    }
  }

  // Effect to initialize profile form when user data loads
  // Uses a signal to track initialization state for proper reactivity
  private readonly profileInitialized = signal(false);
  private profileEffect = effect(() => {
    const user = this.auth.user();
    const initialized = this.profileInitialized();
    if (user && !initialized) {
      // Update the form model with user's name
      this.profileFormModel.set({
        name: user.name || '',
      });
      this.profileInitialized.set(true);
    }
  });

  private readonly pendingEmailOverrideEffect = effect(() => {
    const override = this.pendingEmailOverride();
    if (!override) return;

    const user = this.auth.user();
    const serverValue = user?.pendingEmail ?? null;
    if (
      samePendingEmail(user?.email ?? null, override.expectedServerValue) ||
      samePendingEmail(serverValue, override.expectedServerValue) ||
      !samePendingEmail(serverValue, override.previousServerValue)
    ) {
      this.pendingEmailOverride.set(null);
    }
  });

  private readonly emailPreferenceOverrideEffect = effect(() => {
    const overrides = this.emailPrefOverrides();
    if (overrides.size === 0) return;

    const serverPrefs = this.emailPrefs.data();
    if (!serverPrefs) return;

    const serverPrefsByOrganizer = new Map(
      serverPrefs.map((pref: EmailPreference) => [
        String(pref.organizerId),
        pref.optedIn,
      ]),
    );
    const next = new Map(overrides);
    for (const [organizerId, override] of overrides) {
      const serverValue = serverPrefsByOrganizer.get(organizerId);
      if (
        serverValue === undefined ||
        serverValue === override.expectedServerValue ||
        serverValue !== override.previousValue
      ) {
        next.delete(organizerId);
      }
    }

    if (next.size !== overrides.size) {
      this.emailPrefOverrides.set(next);
    }
  });

  private readonly globalOptOutOverrideEffect = effect(() => {
    const override = this.globalOptOutOverride();
    if (!override) return;

    const serverValue = this.globalOptOutQuery.data();
    if (serverValue === undefined) return;

    if (
      serverValue === override.expectedServerValue ||
      serverValue !== override.previousValue
    ) {
      this.globalOptOutOverride.set(null);
    }
  });

  async onUpdatePassword() {
    this.submitted.set(true);
    if (this.f().invalid() || this.passwordsMismatch()) {
      logger.warn('[onUpdatePassword] Validation failed:', {
        invalid: this.f().invalid(),
        mismatch: this.passwordsMismatch(),
      });
      return;
    }
    this.passwordError.set('');
    this.passwordLoading.set(true);

    const formValue = this.passwordModel();

    try {
      await this.auth.updatePassword(
        formValue.oldPassword,
        formValue.newPassword,
        formValue.confirmPassword,
      );
      this.passwordModel.set({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      toast.success('Password updated successfully. Please log in again.');
      // Do not await logout/navigation here. If routing stalls, keep UI responsive.
      void this.auth.logout();
    } catch (err: unknown) {
      const message = cleanErrorMessage(err, 'Failed to update password');
      this.passwordError.set(message);
      toast.error(message);
    } finally {
      this.passwordLoading.set(false);
    }
  }

  async onRequestEmailChange() {
    if (this.emailForm().invalid() || this.emailSameAsCurrent()) return;
    this.emailMessage.set('');
    this.emailError.set('');
    this.emailLoading.set(true);
    const requestedEmail = this.emailFormModel().newEmail.trim();
    try {
      await this.auth.requestEmailChange(requestedEmail);
      this.pendingEmailOverride.set({
        value: requestedEmail,
        expectedServerValue: requestedEmail,
        previousServerValue: this.auth.user()?.pendingEmail ?? null,
      });
      this.emailMessage.set(
        'Check current inbox first, then verify the new inbox email.',
      );
      this.emailFormModel.set({newEmail: ''});
    } catch (err: unknown) {
      this.emailError.set(
        cleanErrorMessage(err, 'Failed to request email change'),
      );
    } finally {
      this.emailLoading.set(false);
    }
  }

  async onCancelEmailChange() {
    if (this.cancelEmailLoading()) return;
    this.cancelEmailError.set('');
    this.cancelEmailLoading.set(true);
    try {
      const previousServerValue = this.auth.user()?.pendingEmail ?? null;
      await this.auth.cancelEmailChange();
      this.pendingEmailOverride.set({
        value: null,
        expectedServerValue: null,
        previousServerValue,
      });
      this.emailMessage.set('Email change request cancelled.');
      this.emailError.set('');
      toast.success('Email change request cancelled.');
    } catch (err: unknown) {
      this.cancelEmailError.set(
        cleanErrorMessage(err, 'Failed to cancel email change'),
      );
    } finally {
      this.cancelEmailLoading.set(false);
    }
  }

  async onUpdateProfile() {
    if (this.profileForm().invalid()) return;
    this.profileMessage.set('');
    this.profileError.set('');

    // Trim whitespace so the required validator catches whitespace-only names
    const trimmedName = this.profileFormModel().name.trim();
    if (trimmedName !== this.profileFormModel().name) {
      this.profileFormModel.set({name: trimmedName});
      // Mark field touched so isFieldInvalid() renders the required error
      // even without prior DOM interaction (defense-in-depth)
      const nameField = (
        this.profileForm as unknown as Record<string, MaybeFieldTree<unknown>>
      ).name;
      if (typeof nameField === 'function') {
        (nameField as () => {markAsTouched: () => void})().markAsTouched();
      }
    }
    if (!trimmedName) return;

    this.profileLoading.set(true);

    try {
      await this.auth.updateProfile({
        name: trimmedName,
      });
      this.profileMessage.set('Profile updated successfully!');
    } catch (err: unknown) {
      this.profileError.set(cleanErrorMessage(err, 'Failed to update profile'));
    } finally {
      this.profileLoading.set(false);
    }
  }

  private nextEmailPreferenceOperationId(): number {
    this.emailPreferenceOperationSeq += 1;
    return this.emailPreferenceOperationSeq;
  }

  private rollbackEmailPreferenceOverrides(
    rollbacks: readonly EmailPreferenceRollback[],
  ): void {
    this.emailPrefOverrides.update((current) => {
      const next = new Map(current);
      let changed = false;

      for (const rollback of rollbacks) {
        const currentOverride = next.get(rollback.organizerId);
        if (currentOverride?.operationId !== rollback.operationId) continue;

        if (
          this.isRestorableEmailPreferenceOverride(rollback.previousOverride)
        ) {
          next.set(rollback.organizerId, rollback.previousOverride);
        } else {
          next.delete(rollback.organizerId);
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }

  private rollbackGlobalOptOutOverride(
    operationId: number,
    previousOverride: EmailPreferenceOverride | null,
  ): void {
    const currentOverride = this.globalOptOutOverride();
    if (currentOverride?.operationId === operationId) {
      this.globalOptOutOverride.set(
        this.isRestorableEmailPreferenceOverride(previousOverride)
          ? previousOverride
          : null,
      );
    }
  }

  private markEmailPreferenceOperationRejected(operationId: number): void {
    this.rejectedEmailPreferenceOperationIds.add(operationId);
  }

  private isRestorableEmailPreferenceOverride(
    override: EmailPreferenceOverride | null | undefined,
  ): override is EmailPreferenceOverride {
    return (
      override !== null &&
      override !== undefined &&
      !this.rejectedEmailPreferenceOperationIds.has(override.operationId)
    );
  }
}
