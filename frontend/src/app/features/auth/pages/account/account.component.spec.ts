import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {AccountComponent} from './account.component';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {createMockConvexClient} from '../../../../../testing/mock-types';
import {provideRouter} from '@angular/router';
import {toast} from 'ngx-sonner';
import {AccountComponentHarness} from './account.component.harness';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {signal, provideZonelessChangeDetection} from '@angular/core';
import {ConvexError} from 'convex/values';
import {type MaybeFieldTree} from '@angular/forms/signals';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {type ExternalAuth} from '@/features/auth/models/external-auth.model';
import {api} from '@convex/_generated/api';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {createDeferred} from '@/testing/deferred';

/**
 * Helper to assert a field has a specific validation error.
 * Signal Forms fields are functions: component.fieldName().errors()
 */
function hasFieldError<T>(
  form: MaybeFieldTree<T>,
  fieldName: string,
  errorKind: string,
): boolean {
  try {
    // The form parameter is actually a wrapper (component.f or component.profileForm)
    // which may be a function or an object. We need to access the field as a property.
    const wrapper = form as unknown as Record<string, MaybeFieldTree<T>>;
    const fieldFn = wrapper[fieldName];

    if (typeof fieldFn !== 'function') return false;
    const fieldState = fieldFn();
    if (!fieldState) return false;
    const errorsSignal = Reflect.get(fieldState, 'errors');
    if (typeof errorsSignal !== 'function') return false;
    const errors = errorsSignal() as unknown;
    if (!errors || !Array.isArray(errors)) return false;
    return errors.some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'kind' in e &&
        Reflect.get(e, 'kind') === errorKind,
    );
  } catch {
    return false;
  }
}

function createEmailPrefsConvexMock(
  options: {
    prefs?: unknown[];
    globalOptOut?: boolean;
    mutation?: ReturnType<typeof vi.fn>;
    prefsError?: Error;
  } = {},
) {
  const baseConvex = createMockConvexClient();
  const mutateMock = options.mutation ?? vi.fn().mockResolvedValue(undefined);
  const prefs = options.prefs ?? [];
  const globalOptOut = options.globalOptOut ?? false;
  let preferencesOnData: ((value: unknown[]) => void) | null = null;
  let globalOptOutOnData: ((value: boolean) => void) | null = null;

  // Convex anyApi creates a new Proxy on each property access so reference identity and
  // _name inspection are both unreliable for differentiation. Instead we rely on the
  // stable class-field declaration order of the AccountComponent's two injectQuery calls:
  //   call 0 → getUserPreferences  (returns prefs array)
  //   call 1 → getGlobalOptOutStatus (returns boolean)
  // This assumption holds as long as no injectQuery call is inserted before these two in
  // the component. If the order ever changes, the tests that assert banner visibility will
  // fail loudly (not silently), surfacing the mismatch.
  let callCount = 0;
  const onUpdate = vi.fn(
    (
      _queryFn: unknown,
      _args: unknown,
      onData: (v: unknown) => void,
      onError?: (err: Error) => void,
    ) => {
      const index = callCount++;
      if (index === 1) {
        globalOptOutOnData = onData;
        onData(globalOptOut);
      } else if (options.prefsError) {
        onError?.(options.prefsError);
      } else {
        preferencesOnData = onData;
        onData(prefs);
      }
      return () => undefined;
    },
  );

  return {
    ...baseConvex,
    onUpdate,
    mutation: mutateMock,
    client: {
      ...baseConvex.client,
      query: vi.fn(),
      mutation: mutateMock,
      action: vi.fn(),
      onUpdate,
    },
    emitPreferences(nextPrefs: unknown[]) {
      preferencesOnData?.(nextPrefs);
    },
    emitGlobalOptOut(nextGlobalOptOut: boolean) {
      globalOptOutOnData?.(nextGlobalOptOut);
    },
  };
}

describe('AccountComponent', () => {
  let component: AccountComponent;
  let fixture: ComponentFixture<AccountComponent>;
  let harness: AccountComponentHarness;
  let authServiceMock: unknown;
  let currentAuthMock:
    | {
        user: ReturnType<
          typeof signal<{
            _id?: string;
            email: string;
            name?: string;
            hasPassword?: boolean;
            pendingEmail?: string;
          }>
        >;
        currentUser: ReturnType<typeof signal<Record<string, unknown>>>;
        userRole: ReturnType<typeof signal<string>>;
        requestEmailChange: ReturnType<typeof vi.fn>;
        cancelEmailChange: ReturnType<typeof vi.fn>;
        updatePassword: ReturnType<typeof vi.fn>;
        updateProfile: ReturnType<typeof vi.fn>;
        logout: ReturnType<typeof vi.fn>;
        getExternalAuths: ReturnType<typeof vi.fn>;
        linkSocial?: ReturnType<typeof vi.fn>;
        unlinkAccount?: ReturnType<typeof vi.fn>;
        setPassword?: ReturnType<typeof vi.fn>;
        authSettled: ReturnType<typeof signal<boolean>>;
      }
    | undefined;

  async function setupAccountComponent(
    overrides: {
      user?: {
        _id?: string;
        email: string;
        name?: string;
        hasPassword?: boolean;
        pendingEmail?: string;
      };
      authMethods?: () => Promise<ExternalAuth[]>;
      linkSocial?: ReturnType<typeof vi.fn>;
      unlinkAccount?: ReturnType<typeof vi.fn>;
      setPassword?: ReturnType<typeof vi.fn>;
      cancelEmailChange?: ReturnType<typeof vi.fn>;
      authSettled?: boolean;
    } = {},
  ) {
    const mock: {
      user: ReturnType<
        typeof signal<{
          _id?: string;
          email: string;
          name?: string;
          hasPassword?: boolean;
          pendingEmail?: string;
        }>
      >;
      currentUser: ReturnType<typeof signal<Record<string, unknown>>>;
      userRole: ReturnType<typeof signal<string>>;
      requestEmailChange: ReturnType<typeof vi.fn>;
      cancelEmailChange: ReturnType<typeof vi.fn>;
      updatePassword: ReturnType<typeof vi.fn>;
      updateProfile: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
      getExternalAuths: ReturnType<typeof vi.fn>;
      linkSocial?: ReturnType<typeof vi.fn>;
      unlinkAccount?: ReturnType<typeof vi.fn>;
      setPassword?: ReturnType<typeof vi.fn>;
      authSettled: ReturnType<typeof signal<boolean>>;
    } = {
      user: signal({
        _id: '123',
        email: 'test@example.com',
        name: 'Test User',
        ...(overrides.user || {}),
      }),
      currentUser: signal({
        _id: '123',
        email: 'test@example.com',
        name: 'Test User',
        ...(overrides.user || {}),
      }),
      userRole: signal('user'),
      authSettled: signal(overrides.authSettled ?? true),
      requestEmailChange: vi.fn().mockResolvedValue({}),
      cancelEmailChange:
        overrides.cancelEmailChange ?? vi.fn().mockResolvedValue({}),
      updatePassword: vi.fn().mockResolvedValue({}),
      updateProfile: vi.fn().mockResolvedValue({}),
      logout: vi.fn().mockResolvedValue({}),
      getExternalAuths: vi
        .fn()
        .mockResolvedValue((overrides.authMethods ?? (async () => []))()),
      linkSocial: overrides.linkSocial,
      unlinkAccount: overrides.unlinkAccount,
      setPassword: overrides.setPassword,
    };

    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: mock},
        {provide: CONVEX, useValue: createMockConvexClient()},
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AccountComponentHarness,
    );
    return {mock, fixture, component, harness};
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    ({
      mock: currentAuthMock,
      fixture,
      component,
      harness,
    } = await setupAccountComponent());
    authServiceMock = currentAuthMock;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display current email', async () => {
    const email = await harness.getCurrentEmail();
    expect(email).toContain('test@example.com');
  });

  it('renders the email preferences anchor target for manage-preferences links', async () => {
    const card = await harness.getEmailPreferencesCard();

    expect(await card?.getAttribute('id')).toBe('email-preferences');
  });

  describe('Password Form', () => {
    it('should have invalid form initially', () => {
      expect(component.f().invalid()).toBe(true);
    });

    it('should require all password fields', () => {
      const oldPasswordErrors = component.f.oldPassword().errors();
      const newPasswordErrors = component.f.newPassword().errors();
      const confirmPasswordErrors = component.f.confirmPassword().errors();
      expect(oldPasswordErrors.some((e) => e.kind === 'required')).toBe(true);
      expect(newPasswordErrors.some((e) => e.kind === 'required')).toBe(true);
      expect(confirmPasswordErrors.some((e) => e.kind === 'required')).toBe(
        true,
      );
    });

    it('should validate minimum password length', async () => {
      // Use harness to set password which will touch the field
      await harness.setNewPassword('short');
      // Submit form to trigger validation display
      component.submitted.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      // Check that the field has validation errors (minLength validator is active)
      const errors = component.f.newPassword().errors();
      expect(errors.length).toBeGreaterThan(0);
      // The field should be invalid when password is too short
      expect(component.f.newPassword().invalid()).toBe(true);
    });

    it('should validate password match', async () => {
      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'different123',
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.passwordsMismatch()).toBe(true);
    });

    it('should accept matching passwords', async () => {
      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.passwordsMismatch()).toBe(false);
      expect(component.f().valid()).toBe(true);
    });

    it('should call updatePassword on valid form submit', async () => {
      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();

      expect(
        (authServiceMock as {updatePassword: ReturnType<typeof vi.fn>})
          .updatePassword,
      ).toHaveBeenCalledWith('oldpass123', 'newpass123', 'newpass123');
    });

    it('should logout after successful password update', async () => {
      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (authServiceMock as {logout: ReturnType<typeof vi.fn>}).logout,
      ).toHaveBeenCalled();
    });

    it('should show success toast before logout on successful password update', async () => {
      const toastSuccess = vi.mocked(toast.success);
      toastSuccess.mockClear();

      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();

      expect(toastSuccess).toHaveBeenCalledWith(
        'password updated — log in again',
      );
    });

    it('should display error message on password update failure', async () => {
      (
        authServiceMock as {updatePassword: ReturnType<typeof vi.fn>}
      ).updatePassword.mockRejectedValueOnce(
        new Error('Current password incorrect'),
      );

      component.passwordModel.set({
        oldPassword: 'wrongpass',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.passwordError()).toBeTruthy();
      expect(component.passwordError()).toContain('Current password incorrect');
      expect(await harness.getPasswordError()).toContain(
        'Current password incorrect',
      );
      expect(toast.error).toHaveBeenCalledWith('Current password incorrect');
    });

    it('should clear password error when current password field is edited', async () => {
      (
        authServiceMock as {updatePassword: ReturnType<typeof vi.fn>}
      ).updatePassword.mockRejectedValueOnce(
        new Error('Current password is incorrect'),
      );

      component.passwordModel.set({
        oldPassword: 'wrongpass',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.passwordError()).toBeTruthy();

      // Edit the current password field via harness
      await harness.setOldPassword('different');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.passwordError()).toBe('');
    });

    it('should show min-length validation when new password is too short', async () => {
      await harness.setNewPassword('abc');
      component.submitted.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const validationMsg = await harness.getNewPasswordValidation();
      expect(validationMsg).toBeTruthy();
      expect(validationMsg).toContain('8 CHARACTERS');
    });

    it('should show min-length validation while typing a short new password before blur', async () => {
      await harness.setNewPasswordWithoutBlur('short');
      fixture.detectChanges();
      await fixture.whenStable();

      const validationMsg = await harness.getNewPasswordValidation();
      expect(validationMsg).toBeTruthy();
      expect(validationMsg).toContain('8 CHARACTERS');
    });

    it('should validate maximum password length of 72 characters (bcrypt limit)', async () => {
      component.passwordModel.set({
        oldPassword: 'a'.repeat(73),
        newPassword: 'a'.repeat(73),
        confirmPassword: 'a'.repeat(73),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();

      // Signal Forms: mark fields as touched to show validation errors
      const formSignals = [
        'oldPassword',
        'newPassword',
        'confirmPassword',
      ] as const;
      for (const fieldName of formSignals) {
        const field = (
          component.f as unknown as Record<string, MaybeFieldTree<unknown>>
        )[fieldName];
        if (field && typeof field === 'function') {
          field().markAsTouched();
        }
      }
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.f().invalid()).toBe(true);
      expect(hasFieldError(component.f, 'oldPassword', 'maxLength')).toBe(true);
      expect(hasFieldError(component.f, 'newPassword', 'maxLength')).toBe(true);
      expect(hasFieldError(component.f, 'confirmPassword', 'maxLength')).toBe(
        true,
      );
    });

    it('should accept passwords at exactly 72 characters', async () => {
      component.passwordModel.set({
        oldPassword: 'a'.repeat(72),
        newPassword: 'a'.repeat(72),
        confirmPassword: 'a'.repeat(72),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();

      const formSignals = [
        'oldPassword',
        'newPassword',
        'confirmPassword',
      ] as const;
      for (const fieldName of formSignals) {
        const field = (
          component.f as unknown as Record<string, MaybeFieldTree<unknown>>
        )[fieldName];
        if (field && typeof field === 'function') {
          field().markAsTouched();
        }
      }
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.f().valid()).toBe(true);
      expect(hasFieldError(component.f, 'oldPassword', 'maxLength')).toBe(
        false,
      );
      expect(hasFieldError(component.f, 'newPassword', 'maxLength')).toBe(
        false,
      );
      expect(hasFieldError(component.f, 'confirmPassword', 'maxLength')).toBe(
        false,
      );
    });

    it('should show maxLength validation message for new password', async () => {
      await harness.setNewPassword('a'.repeat(73));
      component.submitted.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const validationMsg = await harness.getNewPasswordMaxLengthValidation();
      expect(validationMsg).toBeTruthy();
      expect(validationMsg).toContain('72 CHARACTERS');
    });

    it('should not show min-length validation when new password meets minimum', async () => {
      await harness.setNewPassword('longpassword');
      component.submitted.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const validationMsg = await harness.getNewPasswordValidation();
      expect(validationMsg).toBeNull();
    });

    it('should show required validation for old password when touched and empty', async () => {
      await harness.setOldPassword('');
      component.f.oldPassword().markAsTouched();
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getOldPasswordRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('CURRENT PASSWORD IS REQUIRED');
    });

    it('should show required validation for new password when touched and empty', async () => {
      await harness.setNewPassword('');
      component.f.newPassword().markAsTouched();
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getNewPasswordRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('NEW PASSWORD IS REQUIRED');
    });

    it('should show required validation for confirm password when touched and empty', async () => {
      await harness.setConfirmPassword('');
      component.f.confirmPassword().markAsTouched();
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getConfirmPasswordRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('CONFIRM PASSWORD IS REQUIRED');
    });

    it('should show mismatch validation when passwords differ', async () => {
      await harness.setNewPassword('validpass1');
      await harness.setConfirmPassword('validpass2');
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getPasswordMismatchValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('PASSWORDS DO NOT MATCH');
      expect(await harness.isPasswordSubmitDisabled()).toBe(true);
      expect(await harness.getPasswordSubmitBlocker()).toContain(
        'Passwords do not match',
      );
    });

    it('should reset form after successful submission', async () => {
      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      const model = component.passwordModel();
      expect(model.oldPassword).toBe('');
      expect(model.newPassword).toBe('');
      expect(model.confirmPassword).toBe('');
    });

    it('should not show email required error after password form returns an error (BRA-357)', async () => {
      // Simulate wrong current password: updatePassword rejects
      (
        authServiceMock as {updatePassword: ReturnType<typeof vi.fn>}
      ).updatePassword.mockRejectedValueOnce(
        new Error('Current password incorrect'),
      );

      component.passwordModel.set({
        oldPassword: 'wrongpass',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      // Password error should be shown (correct behavior)
      expect(component.passwordError()).toBeTruthy();

      // Email form is untouched — its required error must NOT appear
      const emailRequiredMsg = await harness.getEmailRequiredValidation();
      expect(emailRequiredMsg).toBeNull();
    });
  });

  describe('Profile Form', () => {
    it('should show required validation when display name is cleared', async () => {
      component.profileFormModel.set({name: ''});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getProfileNameRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('DISPLAY NAME IS REQUIRED');
    });

    it('should show required validation immediately when display name is cleared before blur', async () => {
      await harness.setProfileNameWithoutBlur('');
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getProfileNameRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('DISPLAY NAME IS REQUIRED');
    });

    it('should not show required validation when display name is filled', async () => {
      component.profileFormModel.set({name: 'Test'});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getProfileNameRequiredValidation();
      expect(msg).toBeNull();
    });

    it('should reject whitespace-only display name and show required error', async () => {
      await harness.setProfileName('   ');
      await harness.submitProfile();
      fixture.detectChanges();
      await fixture.whenStable();

      // notBlank schema validator marks the form invalid — backend must not be called
      expect(
        (authServiceMock as {updateProfile: ReturnType<typeof vi.fn>})
          .updateProfile,
      ).not.toHaveBeenCalled();
      // Required validation error should be visible (notBlank raises 'required' error)
      const requiredMsg = await harness.getProfileNameRequiredValidation();
      expect(requiredMsg).toBeTruthy();
      expect(requiredMsg).toContain('DISPLAY NAME IS REQUIRED');
    });

    it('should trim leading/trailing whitespace before saving', async () => {
      await harness.setProfileName('  Valid Name  ');
      await harness.submitProfile();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        (authServiceMock as {updateProfile: ReturnType<typeof vi.fn>})
          .updateProfile,
      ).toHaveBeenCalledWith({name: 'Valid Name'});
      expect(await harness.getProfileNameValue()).toBe('Valid Name');
    });

    it('should validate maximum name length (BRA-93)', async () => {
      // Set name to 200 characters (exceeds 100 char limit)
      const longName = 'A'.repeat(200);
      component.profileFormModel.set({name: longName});
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();

      // Signal Forms: mark field as touched to show validation errors
      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      // Form should be invalid due to maxLength
      expect(component.profileForm().invalid()).toBe(true);

      // maxLength error should be present
      expect(hasFieldError(component.profileForm, 'name', 'maxLength')).toBe(
        true,
      );
    });

    it('should show maxLength validation message when display name exceeds 100 characters (BRA-333)', async () => {
      const longName = 'A'.repeat(101);
      component.profileFormModel.set({name: longName});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getProfileNameMaxLengthValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('100 CHARACTERS');
    });

    it('should not show maxLength validation when display name is within limit', async () => {
      component.profileFormModel.set({name: 'A'.repeat(100)});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getProfileNameMaxLengthValidation();
      expect(msg).toBeNull();
    });

    it('should accept name within 100 character limit', async () => {
      // Set name to 100 characters (at limit)
      const validName = 'A'.repeat(100);
      component.profileFormModel.set({name: validName});
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();

      const nameField = (
        component.profileForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).name;
      if (nameField && typeof nameField === 'function') {
        nameField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      // Form should be valid
      expect(component.profileForm().invalid()).toBe(false);

      // maxLength error should not be present
      expect(hasFieldError(component.profileForm, 'name', 'maxLength')).toBe(
        false,
      );
    });

    it('should call updateProfile and set success message on valid submit', async () => {
      component.profileFormModel.set({name: 'Updated Profile Name'});
      fixture.detectChanges();

      await component.onUpdateProfile();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (authServiceMock as {updateProfile: ReturnType<typeof vi.fn>})
          .updateProfile,
      ).toHaveBeenCalledWith({name: 'Updated Profile Name'});
      expect(component.profileMessage()).toBe('profile updated');
      expect(component.profileError()).toBe('');
    });

    it('should display clean message from ConvexError with string data (BRA-104)', async () => {
      const mock = authServiceMock as {updateProfile: ReturnType<typeof vi.fn>};
      mock.updateProfile.mockRejectedValueOnce(
        new ConvexError('Name exceeds maximum length of 100 characters'),
      );

      component.profileFormModel.set({name: 'Valid'});
      fixture.detectChanges();
      await component.onUpdateProfile();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.profileError()).toBe(
        'Name exceeds maximum length of 100 characters',
      );
    });

    it('should display clean message from ConvexError with { message } object data (BRA-104)', async () => {
      const mock = authServiceMock as {updateProfile: ReturnType<typeof vi.fn>};
      mock.updateProfile.mockRejectedValueOnce(
        new ConvexError({
          code: 'VALIDATION',
          message: 'Display name is required',
        }),
      );

      component.profileFormModel.set({name: 'Valid'});
      fixture.detectChanges();
      await component.onUpdateProfile();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.profileError()).toBe('Display name is required');
    });

    it('should not expose stack traces from serialized Convex errors (BRA-104)', async () => {
      const mock = authServiceMock as {updateProfile: ReturnType<typeof vi.fn>};
      const rawStackTrace =
        'Server Error\n\n[CONVEX M(users/profile:update)] Uncaught ConvexError: Name exceeds maximum length\n    at handler (../backend/convex/users/profile.ts:138:8)';
      mock.updateProfile.mockRejectedValueOnce(new Error(rawStackTrace));

      component.profileFormModel.set({name: 'Valid'});
      fixture.detectChanges();
      await component.onUpdateProfile();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.profileError()).toBe('Name exceeds maximum length');
      expect(component.profileError()).not.toContain(
        'backend/convex/users/profile.ts',
      );
      expect(component.profileError()).not.toContain('at handler');
    });

    it('should use fallback for ConvexError with unrecognized data shape (BRA-104)', async () => {
      const mock = authServiceMock as {updateProfile: ReturnType<typeof vi.fn>};
      mock.updateProfile.mockRejectedValueOnce(
        new ConvexError({code: 'UNKNOWN'}),
      );

      component.profileFormModel.set({name: 'Valid'});
      fixture.detectChanges();
      await component.onUpdateProfile();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.profileError()).toBe('Failed to update profile');
    });
  });

  describe('Optimistic activation window', () => {
    it('shows a skeleton and no editable profile form while auth is unsettled', async () => {
      await setupAccountComponent({authSettled: false});

      expect(await harness.hasLoadingSkeleton()).toBe(true);
      // The profile form must not render editable, or its populate-on-profile
      // effect would clobber any input typed during the optimistic window.
      expect(await harness.hasProfileNameInput()).toBe(false);
    });

    it('renders the editable profile form once auth has settled', async () => {
      await setupAccountComponent({authSettled: true});

      expect(await harness.hasLoadingSkeleton()).toBe(false);
      expect(await harness.hasProfileNameInput()).toBe(true);
      expect(await harness.profileNameLabelUsesForegroundToken()).toBe(true);
    });
  });

  describe('Loading States', () => {
    it('should set loading to true during password update', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      (
        authServiceMock as {updatePassword: ReturnType<typeof vi.fn>}
      ).updatePassword.mockReturnValueOnce(promise);

      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();
      const submitPromise = component.onUpdatePassword();
      fixture.detectChanges();

      // Check loading state synchronously after calling onUpdatePassword
      expect(component.passwordLoading()).toBe(true);

      resolvePromise!({});
      await submitPromise;
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.passwordLoading()).toBe(false);
    });

    it('should keep UI responsive if logout does not resolve', async () => {
      (
        authServiceMock as {updatePassword: ReturnType<typeof vi.fn>}
      ).updatePassword.mockResolvedValueOnce(undefined);
      (
        authServiceMock as {logout: ReturnType<typeof vi.fn>}
      ).logout.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          void resolve;
        }),
      );

      component.passwordModel.set({
        oldPassword: 'oldpass123',
        newPassword: 'newpass123',
        confirmPassword: 'newpass123',
      });
      fixture.detectChanges();

      await component.onUpdatePassword();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (authServiceMock as {logout: ReturnType<typeof vi.fn>}).logout,
      ).toHaveBeenCalled();
      expect(component.passwordLoading()).toBe(false);
      expect(component.passwordError()).toBe('');
    });
  });

  describe('Email Preferences', () => {
    it('should render the email preferences card', async () => {
      const card = await harness.getEmailPreferencesCard();
      expect(card).toBeTruthy();
    });

    it('should show "no communities" message when prefs data is empty', async () => {
      // Default mock: onUpdate never fires onData, query stays loading then resolves empty
      // Directly simulate the empty-data state via the component signal
      // The default mock returns [] effectively (no data callback fired).
      // We need a mock that fires onData([]).
      const convexWithEmptyPrefs = createEmailPrefsConvexMock();

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithEmptyPrefs},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const msg = await localHarness.getNoPrefsMessage();
      expect(msg).toContain("You're not a member of any communities yet");
    });

    it('should render the branded error state (not the empty state) when the prefs query fails', async () => {
      const convexWithPrefsError = createEmailPrefsConvexMock({
        prefsError: new Error('Server Error'),
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithPrefsError},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const errorText = await localHarness.getEmailPrefsErrorText();
      expect(errorText).toContain('hit a snag');
      expect(errorText).toContain("couldn't load your email preferences");
      expect(await localHarness.getNoPrefsMessage()).toBeNull();
      expect(await localHarness.getEmailPrefsList()).toBeNull();
    });

    it('should show prefs list when data is available', async () => {
      const prefs = [
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: true,
          isAdmin: false,
        },
        {
          organizerId: 'org2',
          organizerName: 'Community B',
          optedIn: false,
          isAdmin: false,
        },
      ];
      const convexWithPrefs = createEmailPrefsConvexMock({prefs});

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithPrefs},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const list = await localHarness.getEmailPrefsList();
      expect(list).toBeTruthy();
    });

    it('should show "Unsubscribe from all" button when at least one pref is opted in', async () => {
      const prefs = [
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: true,
          isAdmin: false,
        },
      ];
      const convexWithPrefs = createEmailPrefsConvexMock({prefs});

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithPrefs},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const btn = await localHarness.getUnsubAllButton();
      expect(btn).toBeTruthy();
    });

    it('should not show "Unsubscribe from all" when all prefs are opted out', async () => {
      const prefs = [
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: false,
          isAdmin: false,
        },
      ];
      const convexWithPrefs = createEmailPrefsConvexMock({prefs});

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithPrefs},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const btn = await localHarness.getUnsubAllButton();
      expect(btn).toBeNull();
    });

    it('should call updatePref.mutate when toggling a preference', async () => {
      const mutateMock = vi.fn().mockResolvedValue(undefined);
      // Spy on the updatePref mutation by overriding the convex service mutation
      const convexService = createEmailPrefsConvexMock({mutation: mutateMock});

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      const localComponent = localFixture.componentInstance;
      localFixture.detectChanges();
      await localFixture.whenStable();

      await localComponent.toggleEmailPref('org1', false);

      expect(mutateMock).toHaveBeenCalled();
      expect(
        functionReferenceMatches(
          mutateMock.mock.calls[0]?.[0],
          api.marketing.emails.updateMarketingPreference,
        ),
      ).toBe(true);
      expect(mutateMock.mock.calls[0]?.[1]).toEqual({
        organizerId: 'org1',
        optedIn: false,
      });
    });

    it('should immediately show an individual preference as off after toggling it off', async () => {
      const mutateMock = vi.fn().mockResolvedValue(undefined);
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);

      await localHarness.clickPreferenceToggle('org1');
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(mutateMock).toHaveBeenCalled();
      expect(
        functionReferenceMatches(
          mutateMock.mock.calls[0]?.[0],
          api.marketing.emails.updateMarketingPreference,
        ),
      ).toBe(true);
      expect(mutateMock.mock.calls[0]?.[1]).toEqual({
        organizerId: 'org1',
        optedIn: false,
      });
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(false);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'OFF',
      );
      expect(toast.success).toHaveBeenCalledWith(
        'Marketing preference disabled.',
      );

      convexService.emitPreferences([
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: false,
          isAdmin: false,
        },
      ]);
      localFixture.detectChanges();
      await localFixture.whenStable();

      convexService.emitPreferences([
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: true,
          isAdmin: false,
        },
      ]);
      localFixture.detectChanges();
      await localFixture.whenStable();

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'ON',
      );
    });

    it('should roll back an individual preference toggle when the mutation fails', async () => {
      const mutateMock = vi.fn().mockRejectedValue(new Error('Network error'));
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      await localHarness.clickPreferenceToggle('org1');
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(mutateMock).toHaveBeenCalled();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'ON',
      );
      expect(toast.error).toHaveBeenCalledWith(
        'Something went wrong. Please try again.',
      );
    });

    it('should preserve newer preference overrides when an earlier toggle fails', async () => {
      const firstMutation = createDeferred<void>();
      const secondMutation = createDeferred<void>();
      const mutateMock = vi
        .fn()
        .mockReturnValueOnce(firstMutation.promise)
        .mockReturnValueOnce(secondMutation.promise);
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      const localComponent = localFixture.componentInstance;
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const firstCall = localComponent.toggleEmailPref('org1', false);
      localFixture.detectChanges();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(false);

      const secondCall = localComponent.toggleEmailPref('org2', false);
      localFixture.detectChanges();
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(false);

      firstMutation.reject(new Error('first failed'));
      await firstCall;
      localFixture.detectChanges();
      await localFixture.whenStable();

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(false);

      secondMutation.resolve(undefined);
      await secondCall;
    });

    it('should not resurrect a failed older override when same preference toggles fail', async () => {
      const firstMutation = createDeferred<void>();
      const secondMutation = createDeferred<void>();
      const mutateMock = vi
        .fn()
        .mockReturnValueOnce(firstMutation.promise)
        .mockReturnValueOnce(secondMutation.promise);
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      const localComponent = localFixture.componentInstance;
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const firstCall = localComponent.toggleEmailPref('org1', false);
      localFixture.detectChanges();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(false);

      const secondCall = localComponent.toggleEmailPref('org1', true);
      localFixture.detectChanges();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);

      firstMutation.reject(new Error('first failed'));
      await firstCall;
      localFixture.detectChanges();
      await localFixture.whenStable();

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);

      secondMutation.reject(new Error('second failed'));
      await secondCall;
      localFixture.detectChanges();
      await localFixture.whenStable();

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'ON',
      );
    });

    it('should show success toast and call unsubAllMutation.mutate on unsubscribeFromAll', async () => {
      const mutateMock = vi.fn().mockResolvedValue(undefined);
      const convexService = createEmailPrefsConvexMock({mutation: mutateMock});
      const toastSuccess = vi.mocked(toast.success);

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      const localComponent = localFixture.componentInstance;
      localFixture.detectChanges();
      await localFixture.whenStable();

      toastSuccess.mockClear();
      await localComponent.unsubscribeFromAll();
      await localFixture.whenStable();

      expect(mutateMock).toHaveBeenCalled();
      expect(
        functionReferenceMatches(
          mutateMock.mock.calls[0]?.[0],
          api.marketing.emails.unsubscribeAll,
        ),
      ).toBe(true);
      expect(toastSuccess).toHaveBeenCalledWith(
        'Unsubscribed from all marketing emails.',
      );
    });

    it('should immediately show all community preferences as off after unsubscribing from all', async () => {
      const mutateMock = vi.fn().mockResolvedValue(undefined);
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const button = await localHarness.getUnsubAllButton();
      expect(button).not.toBeNull();
      await button?.click();
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(mutateMock).toHaveBeenCalled();
      expect(
        functionReferenceMatches(
          mutateMock.mock.calls[0]?.[0],
          api.marketing.emails.unsubscribeAll,
        ),
      ).toBe(true);
      expect(mutateMock.mock.calls[0]?.[1]).toEqual({});
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(false);
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(false);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'OFF',
      );
      expect(await localHarness.getPreferenceToggleText('org2')).toContain(
        'OFF',
      );
      expect(await localHarness.getUnsubAllButton()).toBeNull();

      convexService.emitPreferences([
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: false,
          isAdmin: false,
        },
        {
          organizerId: 'org2',
          organizerName: 'Community B',
          optedIn: false,
          isAdmin: false,
        },
      ]);
      convexService.emitGlobalOptOut(true);
      localFixture.detectChanges();
      await localFixture.whenStable();

      convexService.emitPreferences([
        {
          organizerId: 'org1',
          organizerName: 'Community A',
          optedIn: true,
          isAdmin: false,
        },
        {
          organizerId: 'org2',
          organizerName: 'Community B',
          optedIn: true,
          isAdmin: false,
        },
      ]);
      convexService.emitGlobalOptOut(false);
      localFixture.detectChanges();
      await localFixture.whenStable();

      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(true);
    });

    it('should show error toast when unsubscribeFromAll fails', async () => {
      const mutateMock = vi.fn().mockRejectedValue(new Error('Network error'));
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs: [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
        ],
      });
      const toastError = vi.mocked(toast.error);

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      const localComponent = localFixture.componentInstance;
      localFixture.detectChanges();
      await localFixture.whenStable();

      toastError.mockClear();
      await localComponent.unsubscribeFromAll();
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(toastError).toHaveBeenCalledWith(
        'Something went wrong. Please try again.',
      );
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
    });

    async function setupWithOptOut(prefs: unknown[], globalOptOut: boolean) {
      const convexService = createEmailPrefsConvexMock({prefs, globalOptOut});
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();
      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );
      return {convexService, localFixture, localHarness};
    }

    it('should not show banner when not globally opted out', async () => {
      const {localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
        ],
        false,
      );
      const banner = await localHarness.getGlobalOptOutBanner();
      expect(banner).toBeNull();
    });

    it('should show all-paused message when opted out with no communities enabled', async () => {
      const {localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: false,
            isAdmin: false,
          },
        ],
        true,
      );
      const banner = await localHarness.getGlobalOptOutBanner();
      expect(banner).toBeTruthy();
      const heading = await localHarness.getGlobalOptOutBannerHeading();
      expect(heading).toContain('Marketing emails are paused');
      const body = await localHarness.getGlobalOptOutBannerBody();
      expect(body).toContain('opted out of all community marketing emails');
      const btn = await localHarness.getReEnableMarketingButton();
      expect(await btn?.text()).toContain('Re-enable marketing emails');
    });

    it('should show some-enabled message when opted out but communities are re-enabled', async () => {
      const {localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: false,
            isAdmin: false,
          },
        ],
        true,
      );
      const banner = await localHarness.getGlobalOptOutBanner();
      expect(banner).toBeTruthy();
      const heading = await localHarness.getGlobalOptOutBannerHeading();
      expect(heading).toContain('Some communities are still enabled');
      const body = await localHarness.getGlobalOptOutBannerBody();
      expect(body).toContain(
        'opted out of marketing emails from new communities',
      );
      expect(body).toContain('1');
      expect(body).toContain('community is');
      const btn = await localHarness.getReEnableMarketingButton();
      expect(await btn?.text()).toContain('Clear opt-out default');
    });

    it('should show plural communities label when multiple are re-enabled', async () => {
      const {localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: true,
            isAdmin: false,
          },
        ],
        true,
      );
      const body = await localHarness.getGlobalOptOutBannerBody();
      expect(body).toContain('2');
      expect(body).toContain('communities are');
    });

    it('should re-enable visible community preferences when all marketing emails are paused', async () => {
      const {convexService, localFixture, localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: false,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: false,
            isAdmin: false,
          },
        ],
        true,
      );

      const button = await localHarness.getReEnableMarketingButton();
      expect(button).not.toBeNull();
      await button?.click();
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(convexService.mutation).toHaveBeenCalledTimes(1);
      expect(
        functionReferenceMatches(
          convexService.mutation.mock.calls[0]?.[0],
          api.marketing.emails.reEnableAll,
        ),
      ).toBe(true);
      expect(
        convexService.mutation.mock.calls.some((call) =>
          functionReferenceMatches(
            call[0],
            api.marketing.emails.updateMarketingPreference,
          ),
        ),
      ).toBe(false);
      expect(await localHarness.getGlobalOptOutBanner()).toBeNull();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(true);
      expect(toast.success).toHaveBeenCalledWith(
        'Marketing emails re-enabled.',
      );
    });

    it('should clear only the opt-out default when some communities are already enabled', async () => {
      const {convexService, localFixture, localHarness} = await setupWithOptOut(
        [
          {
            organizerId: 'org1',
            organizerName: 'Community A',
            optedIn: true,
            isAdmin: false,
          },
          {
            organizerId: 'org2',
            organizerName: 'Community B',
            optedIn: false,
            isAdmin: false,
          },
        ],
        true,
      );

      const button = await localHarness.getReEnableMarketingButton();
      expect(button).not.toBeNull();
      await button?.click();
      await localFixture.whenStable();
      localFixture.detectChanges();

      expect(convexService.mutation).toHaveBeenCalledTimes(1);
      expect(
        convexService.mutation.mock.calls.some((call) =>
          functionReferenceMatches(
            call[0],
            api.marketing.emails.updateMarketingPreference,
          ),
        ),
      ).toBe(false);
      expect(
        functionReferenceMatches(
          convexService.mutation.mock.calls[0]?.[0],
          api.marketing.emails.clearGlobalMarketingOptOut,
        ),
      ).toBe(true);
      expect(await localHarness.getGlobalOptOutBanner()).toBeNull();
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(false);
      expect(toast.success).toHaveBeenCalledWith(
        'Marketing opt-out default cleared.',
      );
    });

    it('should show ADMIN label and disable toggle for admin communities', async () => {
      const prefs = [
        {
          organizerId: 'org1',
          organizerName: 'Admin Community',
          optedIn: true,
          isAdmin: true,
        },
        {
          organizerId: 'org2',
          organizerName: 'Regular Community',
          optedIn: true,
          isAdmin: false,
        },
      ];
      const convexWithPrefs = createEmailPrefsConvexMock({prefs});

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexWithPrefs},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      // Admin community toggle is disabled and shows ADMIN label
      expect(await localHarness.isPreferenceToggleDisabled('org1')).toBe(true);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'ADMIN',
      );

      // Regular community toggle is enabled and shows ON label
      expect(await localHarness.isPreferenceToggleDisabled('org2')).toBe(false);
      expect(await localHarness.getPreferenceToggleText('org2')).toContain(
        'ON',
      );
    });

    it('should skip admin community preferences when unsubscribing from all', async () => {
      const mutateMock = vi.fn().mockResolvedValue(undefined);
      const prefs = [
        {
          organizerId: 'org1',
          organizerName: 'Admin Community',
          optedIn: true,
          isAdmin: true,
        },
        {
          organizerId: 'org2',
          organizerName: 'Regular Community',
          optedIn: true,
          isAdmin: false,
        },
      ];
      const convexService = createEmailPrefsConvexMock({
        mutation: mutateMock,
        prefs,
      });

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [AccountComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: CONVEX, useValue: convexService},
          provideRouter([]),
        ],
      }).compileComponents();

      const localFixture = TestBed.createComponent(AccountComponent);
      localFixture.detectChanges();
      await localFixture.whenStable();
      const localHarness = await TestbedHarnessEnvironment.harnessForFixture(
        localFixture,
        AccountComponentHarness,
      );

      const button = await localHarness.getUnsubAllButton();
      expect(button).not.toBeNull();
      await button?.click();
      await localFixture.whenStable();
      localFixture.detectChanges();

      // Admin community stays opted in
      expect(await localHarness.isPreferenceToggleChecked('org1')).toBe(true);
      expect(await localHarness.getPreferenceToggleText('org1')).toContain(
        'ADMIN',
      );
      // Regular community is unsubscribed
      expect(await localHarness.isPreferenceToggleChecked('org2')).toBe(false);
      expect(await localHarness.getPreferenceToggleText('org2')).toContain(
        'OFF',
      );
    });
  });

  describe('Social Providers', () => {
    it('should render connected provider sections for Google and Discord', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
          {
            id: 'discord-auth-id',
            provider: 'discord',
            providerId: 'acct-discord',
            providerEmail: 'user@discord.com',
            isEmailVerified: true,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getProviderStatus('google')).toContain('Connected');
      expect(await harness.getProviderStatus('discord')).toContain('Connected');
      expect(await harness.getProviderUnlinkButton('google')).toBeTruthy();
    });

    it('keeps a linked provider connected even when new linking is unavailable', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        authMethods: async () => [
          {
            id: 'discord-auth-id',
            provider: 'discord',
            providerId: 'acct-discord',
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getProviderStatus('discord')).toContain('Connected');
      expect(await harness.getProviderUnlinkButton('discord')).toBeTruthy();
      expect(await harness.getProviderMessage('discord')).toContain(
        'Add a password or another provider before disconnecting this login method.',
      );
    });

    it('should call linkSocial when a user connects an available provider', async () => {
      const linkSocial = vi.fn().mockResolvedValue(undefined);
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        linkSocial,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const connectButton = await harness.getProviderConnectButton('google');
      expect(connectButton).toBeTruthy();
      if (connectButton) {
        await connectButton.click();
      }

      expect(linkSocial).toHaveBeenCalledWith('google');
    });

    it('should surface a warning when provider is already linked elsewhere', async () => {
      const linkSocial = vi
        .fn()
        .mockRejectedValue(
          new Error(
            'This provider cannot be connected to this account right now.',
          ),
        );

      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        linkSocial,
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      const connectButton = await harness.getProviderConnectButton('google');
      expect(connectButton).toBeTruthy();
      if (connectButton) {
        await connectButton.click();
      }

      expect(linkSocial).toHaveBeenCalledWith('google');
      expect(await harness.getProviderWarningMessage()).toContain(
        'Unable to connect provider right now.',
      );
      expect(await harness.getProviderConnectButton('google')).toBeTruthy();
    });

    it('should block unlink when it is the last available login method', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      const unlinkButton = await harness.getProviderUnlinkButton('google');
      expect(unlinkButton).toBeTruthy();
      if (unlinkButton) {
        expect(await unlinkButton.isDisabled()).toBe(true);
      }
      expect(await harness.getProviderMessage('google')).toContain(
        'Add a password or another provider before disconnecting this login method.',
      );
    });

    it('treats error-state providers as unusable backups when deciding unlink eligibility', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
          {
            id: 'discord-auth-id',
            provider: 'discord',
            providerId: 'acct-discord',
            isEmailVerified: false,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      const googleUnlinkButton =
        await harness.getProviderUnlinkButton('google');
      expect(googleUnlinkButton).toBeTruthy();
      if (googleUnlinkButton) {
        expect(await googleUnlinkButton.isDisabled()).toBe(true);
      }
      expect(await harness.getProviderStatus('discord')).toContain('Error');
      expect(await harness.getProviderMessage('google')).toContain(
        'Add a password or another provider before disconnecting this login method.',
      );
    });

    it('allows unlinking an error-state provider when another linked provider remains', async () => {
      const unlinkAccount = vi.fn().mockResolvedValue(undefined);
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
          {
            id: 'discord-auth-id',
            provider: 'discord',
            providerId: 'acct-discord',
            isEmailVerified: false,
          },
        ],
        unlinkAccount,
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      const discordUnlinkButton =
        await harness.getProviderUnlinkButton('discord');
      expect(discordUnlinkButton).toBeTruthy();
      if (discordUnlinkButton) {
        expect(await discordUnlinkButton.isDisabled()).toBe(false);
        await discordUnlinkButton.click();
      }

      expect(unlinkAccount).toHaveBeenCalledWith('discord', 'acct-discord');
    });

    it('should show set-password form when account is social-only', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getSocialOnlyMessage()).toContain(
        'Set a password to secure your account',
      );
      expect(await harness.getSetPasswordMessage()).toBeNull();
    });

    it('should keep set-password recovery visible for social-only accounts with only error-state providers', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'discord-auth-id',
            provider: 'discord',
            providerId: 'acct-discord',
            isEmailVerified: false,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getProviderStatus('discord')).toContain('Error');
      expect(await harness.getSocialOnlyMessage()).toContain(
        'Set a password to secure your account',
      );
    });

    it('should call setPassword for social-only users', async () => {
      const setPassword = vi.fn().mockResolvedValue(undefined);
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
        ],
        setPassword,
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      await harness.setSetPassword('Password123!');
      await harness.setSetPasswordConfirm('Password123!');
      await harness.submitSetPassword();

      expect(setPassword).toHaveBeenCalledWith('Password123!', 'Password123!');
    });

    it('should show why social-only set-password submit is disabled when passwords differ', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      await harness.setSetPassword('Password123!');
      await harness.setSetPasswordConfirm('Different123!');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getSetPasswordMismatchValidation()).toContain(
        'PASSWORDS DO NOT MATCH',
      );
      expect(await harness.getSetPasswordSubmitBlocker()).toContain(
        'Passwords do not match',
      );
    });

    it('should set ph-no-capture on all password inputs', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        await harness.getPasswordInputAttribute('oldPassword', 'ph-no-capture'),
      ).toBe('true');
      expect(
        await harness.getPasswordInputAttribute('newPassword', 'ph-no-capture'),
      ).toBe('true');
      expect(
        await harness.getPasswordInputAttribute(
          'confirmPassword',
          'ph-no-capture',
        ),
      ).toBe('true');
    });

    it('should set ph-no-capture on set-password inputs for social-only users', async () => {
      await TestBed.resetTestingModule();
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {email: 'user@test.com', hasPassword: false},
        authMethods: async () => [
          {
            id: 'google-auth-id',
            provider: 'google',
            providerId: 'acct-google',
            providerEmail: 'user@gmail.com',
            isEmailVerified: true,
          },
        ],
      }));

      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        await harness.getPasswordInputAttribute(
          'set-password',
          'ph-no-capture',
        ),
      ).toBe('true');
      expect(
        await harness.getPasswordInputAttribute(
          'set-password-confirm',
          'ph-no-capture',
        ),
      ).toBe('true');
    });
  });

  describe('Email Form', () => {
    it('should show required validation when email is cleared after touch', async () => {
      component.emailFormModel.set({newEmail: ''});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const emailField = (
        component.emailForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).newEmail;
      if (emailField && typeof emailField === 'function') {
        emailField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailRequiredValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('EMAIL IS REQUIRED');
    });

    it('should show invalid email validation for malformed email', async () => {
      component.emailFormModel.set({newEmail: 'not-an-email'});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const emailField = (
        component.emailForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).newEmail;
      if (emailField && typeof emailField === 'function') {
        emailField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailInvalidValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain('ENTER A VALID EMAIL ADDRESS');
    });

    it('should not show validation when valid email is entered', async () => {
      component.emailFormModel.set({newEmail: 'valid@example.com'});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const emailField = (
        component.emailForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).newEmail;
      if (emailField && typeof emailField === 'function') {
        emailField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getEmailRequiredValidation()).toBeNull();
      expect(await harness.getEmailInvalidValidation()).toBeNull();
    });

    it('should have invalid form initially (empty)', () => {
      expect(component.emailForm().invalid()).toBe(true);
    });

    it('should require email field', () => {
      const emailErrors = component.emailForm.newEmail().errors();
      expect(emailErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should reject invalid email without @', () => {
      component.emailFormModel.set({newEmail: 'not-an-email'});
      fixture.detectChanges();
      expect(component.emailForm().invalid()).toBe(true);
      const emailErrors = component.emailForm.newEmail().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);
    });

    it('should reject invalid email without domain', () => {
      component.emailFormModel.set({newEmail: 'user@'});
      fixture.detectChanges();
      expect(component.emailForm().invalid()).toBe(true);
      const emailErrors = component.emailForm.newEmail().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);
    });

    it('should accept valid email', () => {
      component.emailFormModel.set({newEmail: 'valid@example.com'});
      fixture.detectChanges();
      expect(component.emailForm().valid()).toBe(true);
    });

    it('should display inline error on backend failure', async () => {
      (
        authServiceMock as {requestEmailChange: ReturnType<typeof vi.fn>}
      ).requestEmailChange.mockRejectedValueOnce(
        new Error('Email already taken'),
      );

      component.emailFormModel.set({newEmail: 'taken@example.com'});
      fixture.detectChanges();
      await component.onRequestEmailChange();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.emailError()).toBeTruthy();
      expect(component.emailError()).toContain('Email already taken');
    });

    it('should display rate limit error with retry timing when request is rate limited', async () => {
      (
        authServiceMock as {requestEmailChange: ReturnType<typeof vi.fn>}
      ).requestEmailChange.mockRejectedValueOnce(
        new ConvexError({
          kind: 'RateLimited',
          name: 'requestEmailChange',
          retryAfter: 1800000,
        }),
      );

      component.emailFormModel.set({newEmail: 'new@example.com'});
      fixture.detectChanges();
      await component.onRequestEmailChange();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.emailError()).toContain('Too many requests');
      expect(component.emailError()).toContain('30 minutes');
    });

    it('should show same-as-current error when new email matches current email after interaction', async () => {
      component.emailFormModel.set({newEmail: 'test@example.com'});
      const emailField = (
        component.emailForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).newEmail;
      if (emailField && typeof emailField === 'function') {
        emailField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailSameAsCurrentValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain(
        'NEW EMAIL MUST BE DIFFERENT FROM YOUR CURRENT EMAIL',
      );
    });

    it('should not show same-as-current error before field is touched', async () => {
      component.emailFormModel.set({newEmail: 'test@example.com'});
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailSameAsCurrentValidation();
      expect(msg).toBeNull();
    });

    it('should show same-as-current error for case-insensitive match after interaction', async () => {
      component.emailFormModel.set({newEmail: 'TEST@EXAMPLE.COM'});
      const emailField = (
        component.emailForm as unknown as Record<
          string,
          MaybeFieldTree<unknown>
        >
      ).newEmail;
      if (emailField && typeof emailField === 'function') {
        emailField().markAsTouched();
      }
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailSameAsCurrentValidation();
      expect(msg).toBeTruthy();
      expect(msg).toContain(
        'NEW EMAIL MUST BE DIFFERENT FROM YOUR CURRENT EMAIL',
      );
    });

    it('should not show same-as-current error for a different valid email', async () => {
      component.emailFormModel.set({newEmail: 'different@example.com'});
      fixture.detectChanges();
      await fixture.whenStable();

      const msg = await harness.getEmailSameAsCurrentValidation();
      expect(msg).toBeNull();
    });

    it('should disable REQUEST CHANGE button when new email matches current email', async () => {
      component.emailFormModel.set({newEmail: 'test@example.com'});
      fixture.detectChanges();
      await fixture.whenStable();

      const isEnabled = await harness.isEmailSubmitEnabled();
      expect(isEnabled).toBe(false);
    });

    it('should not call requestEmailChange when new email matches current email', async () => {
      component.emailFormModel.set({newEmail: 'test@example.com'});
      fixture.detectChanges();
      await component.onRequestEmailChange();
      await fixture.whenStable();

      const mock = authServiceMock as {
        requestEmailChange: ReturnType<typeof vi.fn>;
      };
      expect(mock.requestEmailChange).not.toHaveBeenCalled();
    });

    it('should display rate limit error with 1 minute wording when retryAfter is under a minute', async () => {
      (
        authServiceMock as {requestEmailChange: ReturnType<typeof vi.fn>}
      ).requestEmailChange.mockRejectedValueOnce(
        new ConvexError({
          kind: 'RateLimited',
          name: 'requestEmailChange',
          retryAfter: 30000,
        }),
      );

      component.emailFormModel.set({newEmail: 'new@example.com'});
      fixture.detectChanges();
      await component.onRequestEmailChange();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.emailError()).toContain('Too many requests');
      expect(component.emailError()).toContain('1 minute');
      expect(component.emailError()).not.toContain('1 minutes');
    });
  });

  describe('Pending Email Change', () => {
    it('should show pending banner when user has pendingEmail', async () => {
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const banner = await harness.getPendingEmailBanner();
      expect(banner).not.toBeNull();
    });

    it('should display the pending email address in the banner', async () => {
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const pendingAddress = await harness.getPendingEmailAddress();
      expect(pendingAddress).toContain('new@example.com');
    });

    it('should hide the email change form when pendingEmail is set', async () => {
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      // The request-email-change button should not be present when pending
      const el = fixture.nativeElement as HTMLElement;
      const requestBtn = el.querySelector('button[id="request-email-change"]');
      expect(requestBtn).toBeNull();
    });

    it('should not show pending banner when no pendingEmail', async () => {
      const banner = await harness.getPendingEmailBanner();
      expect(banner).toBeNull();
    });

    it('should clear requested pending state when the account email confirms first', async () => {
      component.emailFormModel.set({newEmail: 'new@example.com'});
      fixture.detectChanges();

      await component.onRequestEmailChange();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getPendingEmailAddress()).toContain(
        'new@example.com',
      );

      currentAuthMock?.user.set({
        _id: '123',
        email: 'new@example.com',
        name: 'Test User',
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getPendingEmailBanner()).toBeNull();
    });

    it('should show cancel button in pending banner', async () => {
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const cancelBtn = await harness.getCancelEmailChangeButton();
      expect(cancelBtn).not.toBeNull();
    });

    it('should call cancelEmailChange on cancel button click', async () => {
      const cancelFn = vi.fn().mockResolvedValue({});
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
        cancelEmailChange: cancelFn,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      await component.onCancelEmailChange();
      await fixture.whenStable();

      expect(cancelFn).toHaveBeenCalled();
    });

    it('should hide stale pending email state and confirm cancellation after cancel succeeds', async () => {
      const cancelFn = vi.fn().mockResolvedValue({});
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
        cancelEmailChange: cancelFn,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      await component.onCancelEmailChange();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cancelFn).toHaveBeenCalled();
      expect(await harness.getPendingEmailBanner()).toBeNull();
      expect(component.emailMessage()).toBe('Email change request cancelled.');
      expect(toast.success).toHaveBeenCalledWith(
        'Email change request cancelled.',
      );

      currentAuthMock?.user.set({
        _id: '123',
        email: 'test@example.com',
        name: 'Test User',
      });
      fixture.detectChanges();
      await fixture.whenStable();

      currentAuthMock?.user.set({
        _id: '123',
        email: 'test@example.com',
        name: 'Test User',
        pendingEmail: 'other@example.com',
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getPendingEmailAddress()).toContain(
        'other@example.com',
      );
    });

    it('should show error when cancel fails', async () => {
      const cancelFn = vi.fn().mockRejectedValue(new Error('Failed to cancel'));
      ({
        mock: currentAuthMock,
        fixture,
        component,
        harness,
      } = await setupAccountComponent({
        user: {
          _id: '123',
          email: 'test@example.com',
          name: 'Test User',
          pendingEmail: 'new@example.com',
        },
        cancelEmailChange: cancelFn,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      await component.onCancelEmailChange();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.cancelEmailError()).toBeTruthy();
      expect(component.cancelEmailError()).toContain('Failed to cancel');
    });
  });
});
