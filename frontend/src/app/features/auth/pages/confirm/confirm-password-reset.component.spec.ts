import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {ConfirmPasswordResetComponent} from './confirm-password-reset.component';
import {ConfirmPasswordResetComponentHarness} from './confirm-password-reset.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {PasswordService} from '@/core/services/password.service';
import {
  provideRouter,
  ActivatedRoute,
  convertToParamMap,
} from '@angular/router';
import {of} from 'rxjs';
import {signal} from '@angular/core';
import {vi} from 'vitest';

describe('ConfirmPasswordResetComponent', () => {
  let component: ConfirmPasswordResetComponent;
  let fixture: ComponentFixture<ConfirmPasswordResetComponent>;
  type AuthServiceMock = Pick<
    AuthService,
    'confirmPasswordReset' | 'currentUser' | 'userRole'
  >;
  let authServiceMock: AuthServiceMock;
  let harness: ConfirmPasswordResetComponentHarness;

  const createComponent = async (
    token: string | null = 'validtoken12345678901234',
    error: string | null = null,
  ) => {
    const queryParams: Record<string, string> = {};
    if (token) {
      queryParams.token = token;
    }
    if (error) {
      queryParams.error = error;
    }

    authServiceMock = {
      confirmPasswordReset: vi.fn().mockResolvedValue(undefined),
      currentUser: signal(null),
      userRole: signal('user'),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmPasswordResetComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: authServiceMock},
        {provide: PasswordService, useValue: authServiceMock},
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap(queryParams)),
            snapshot: {
              queryParamMap: {
                get: (key: string) =>
                  key === 'token' ? token : key === 'error' ? error : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmPasswordResetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ConfirmPasswordResetComponentHarness,
    );
  };

  it('should create', async () => {
    await createComponent();
    expect(component).toBeTruthy();
  });

  describe('form validation', () => {
    it('should show password error when required field is empty', async () => {
      await createComponent();

      await component.onSubmit();
      fixture.detectChanges();

      expect(await harness.getPasswordErrorText()).toBeTruthy();
    });

    it('should reject password exceeding 72 characters (bcrypt limit)', async () => {
      await createComponent();

      component.resetModel.set({
        password: 'a'.repeat(73),
        passwordConfirm: 'a'.repeat(73),
      });
      fixture.detectChanges();

      expect(component.f().invalid()).toBe(true);
      const passwordErrors = component.f.password().errors();
      expect(passwordErrors.some((e) => e.kind === 'maxLength')).toBe(true);
    });

    it('should accept password at exactly 72 characters', async () => {
      await createComponent();

      component.resetModel.set({
        password: 'a'.repeat(72),
        passwordConfirm: 'a'.repeat(72),
      });
      fixture.detectChanges();

      expect(component.f().valid()).toBe(true);
    });

    it('should show password confirm error when passwords do not match', async () => {
      await createComponent();

      component.resetModel.set({
        password: 'password123',
        passwordConfirm: 'differentpass',
      });
      await component.onSubmit();
      fixture.detectChanges();

      expect(await harness.getPasswordConfirmErrorText()).toContain('match');
    });
  });

  describe('successful reset', () => {
    it('should call confirmPasswordReset with correct arguments', async () => {
      await createComponent('testtoken123456789012345');

      component.resetModel.set({
        password: 'newpassword123',
        passwordConfirm: 'newpassword123',
      });
      await component.onSubmit();
      await fixture.whenStable();

      expect(authServiceMock.confirmPasswordReset).toHaveBeenCalledWith(
        'testtoken123456789012345',
        'newpassword123',
        'newpassword123',
      );
    });

    it('should show success state after successful reset', async () => {
      await createComponent();

      component.resetModel.set({
        password: 'newpassword123',
        passwordConfirm: 'newpassword123',
      });
      await component.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isSuccess()).toBe(true);
      expect(await harness.hasLoginLink()).toBe(true);
    });
  });

  describe('failed reset', () => {
    it('should show error immediately when no token provided', async () => {
      await createComponent(null);

      expect(await harness.isError()).toBe(true);
      expect(await harness.getErrorText()).toContain('No token provided');
    });

    it('should not show form when no token provided', async () => {
      await createComponent(null);

      expect(await harness.hasSubmitButton()).toBe(false);
    });

    it('should show invalid-link state when the token is malformed', async () => {
      await createComponent('not-real');

      expect(await harness.isError()).toBe(true);
      expect(await harness.hasSubmitButton()).toBe(false);
      expect(await harness.getErrorText()).toContain('Invalid reset link');
    });

    it('should show invalid-link state when the callback marks the token invalid', async () => {
      await createComponent(null, 'INVALID_TOKEN');

      expect(await harness.isError()).toBe(true);
      expect(await harness.hasSubmitButton()).toBe(false);
      expect(await harness.getErrorText()).toContain('Invalid reset link');
    });

    it('should show error when reset fails', async () => {
      authServiceMock = {
        confirmPasswordReset: vi
          .fn()
          .mockRejectedValue(new Error('Token expired')),
        currentUser: signal(null),
        userRole: signal('user'),
      };

      await TestBed.configureTestingModule({
        imports: [ConfirmPasswordResetComponent],
        providers: [
          provideZonelessChangeDetection(),
          {provide: AuthService, useValue: authServiceMock},
          {provide: PasswordService, useValue: authServiceMock},
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              queryParamMap: of(
                convertToParamMap({token: 'expiredtoken123456789012'}),
              ),
              snapshot: {
                queryParamMap: {
                  get: () => 'expiredtoken123456789012',
                },
              },
            },
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ConfirmPasswordResetComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        ConfirmPasswordResetComponentHarness,
      );

      component.resetModel.set({
        password: 'newpassword123',
        passwordConfirm: 'newpassword123',
      });
      await component.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isError()).toBe(true);
      expect(await harness.getErrorText()).toContain('Token expired');
    });
  });
});
