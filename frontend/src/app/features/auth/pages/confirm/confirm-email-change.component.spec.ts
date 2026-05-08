import {type ComponentFixture} from '@angular/core/testing';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {ActivatedRoute, Router, convertToParamMap} from '@angular/router';
import {of, type Observable} from 'rxjs';
import {describe, expect, it, vi} from 'vitest';
import {AuthService} from '@/core/services/auth.service';
import {ConfirmEmailChangeComponentHarness} from './confirm-email-change.component.harness';
import {ConfirmEmailChangeComponent} from './confirm-email-change.component';

describe('ConfirmEmailChangeComponent', () => {
  let fixture: ComponentFixture<ConfirmEmailChangeComponent>;
  let harness: ConfirmEmailChangeComponentHarness;
  let mockRouter: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    events: Observable<unknown>;
  };
  let authServiceMock: {
    handleOAuthCallback: ReturnType<typeof vi.fn>;
    authInitialized: ReturnType<typeof signal<boolean>>;
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    user: ReturnType<
      typeof signal<{
        pendingEmail?: string;
      } | null>
    >;
  };

  function createMockActivatedRoute(params: Record<string, string> = {}) {
    return {
      queryParamMap: of(convertToParamMap(params)),
      snapshot: {
        queryParamMap: {
          get: (key: string) => params[key] ?? null,
        },
      },
    };
  }

  async function setupComponent(queryParams: Record<string, string> = {}) {
    mockRouter = {
      navigate: vi.fn().mockResolvedValue(true),
      createUrlTree: vi.fn().mockReturnValue({}),
      serializeUrl: vi.fn().mockReturnValue('/mock-url'),
      events: of({}) as never,
    };
    authServiceMock = {
      handleOAuthCallback: vi.fn().mockResolvedValue(undefined),
      authInitialized: signal(true),
      isAuthenticated: signal(true),
      user: signal(null),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmEmailChangeComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ActivatedRoute,
          useValue: createMockActivatedRoute(queryParams),
        },
        {provide: Router, useValue: mockRouter},
        {provide: AuthService, useValue: authServiceMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmEmailChangeComponent);
  }

  async function renderAndSettle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      ConfirmEmailChangeComponentHarness,
    );
  }

  it('should create', async () => {
    await setupComponent();
    await renderAndSettle();
    expect(harness).toBeTruthy();
  });

  it('should show error when no ott token is provided', async () => {
    await setupComponent();
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(await harness.isError()).toBe(true);
  });

  it('should not call auth services when no ott token is provided', async () => {
    await setupComponent();
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('should not claim "no token provided" when an unrecognized token param is present', async () => {
    await setupComponent({token: 'not-real'});
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(await harness.isError()).toBe(true);
    const errorText = await harness.getErrorText();
    expect(errorText).toContain('Invalid email change link');
    expect(errorText).not.toContain('No token provided');
  });

  it('should show pending when step-1 callback has no ott but pendingEmail remains on the user', async () => {
    await setupComponent();
    authServiceMock.user.set({pendingEmail: 'new-email@example.com'});
    await renderAndSettle();

    expect(await harness.isPending()).toBe(true);
    expect(await harness.isError()).toBe(false);
    expect(await harness.getPendingText()).toContain('Request confirmed');
  });

  it('should show pending when the current-inbox callback returns without an ott', async () => {
    await setupComponent({flow: 'email-change'});
    authServiceMock.isAuthenticated.set(false);
    authServiceMock.user.set(null);
    await renderAndSettle();

    expect(await harness.isPending()).toBe(true);
    expect(await harness.isError()).toBe(false);
    expect(await harness.getPendingText()).toContain('If you just confirmed');
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('should wait for auth state before resolving a no-ott step-1 callback', async () => {
    await setupComponent();
    authServiceMock.authInitialized.set(false);
    authServiceMock.user.set(null);
    await renderAndSettle();

    expect(await harness.isPending()).toBe(false);
    expect(await harness.isError()).toBe(false);

    authServiceMock.authInitialized.set(true);
    authServiceMock.user.set({pendingEmail: 'new-email@example.com'});
    await renderAndSettle();

    expect(await harness.isPending()).toBe(true);
    expect(await harness.isError()).toBe(false);
  });

  it('should show success when ott token is valid and email change is complete', async () => {
    await setupComponent({ott: 'valid-token'});
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(await harness.isSuccess()).toBe(true);
  });

  it('should show account link on success', async () => {
    await setupComponent({ott: 'valid-token'});
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(await harness.hasAccountLink()).toBe(true);
  });

  it('should navigate to /account once auth state is ready', async () => {
    await setupComponent({ott: 'valid-token'});
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('should wait for the user signal before navigating', async () => {
    await setupComponent({ott: 'valid-token'});
    await renderAndSettle();

    expect(mockRouter.navigate).not.toHaveBeenCalled();

    authServiceMock.user.set({});
    await renderAndSettle();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('should show pending state when account still has pendingEmail', async () => {
    await setupComponent({ott: 'valid-token'});
    authServiceMock.user.set({pendingEmail: 'new-email@example.com'});
    await renderAndSettle();

    expect(await harness.isPending()).toBe(true);
  });

  it('should process ott on callback', async () => {
    await setupComponent({ott: 'ott-token-123'});
    authServiceMock.user.set({});
    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).toHaveBeenCalledWith(
      'ott-token-123',
      {
        navigateOnSuccess: false,
        syncUserToApp: true,
      },
    );
  });

  it('should wait for auth readiness before navigating', async () => {
    await setupComponent({ott: 'valid-token'});
    authServiceMock.authInitialized.set(false);
    authServiceMock.isAuthenticated.set(false);
    authServiceMock.user.set(null);
    await renderAndSettle();

    expect(await harness.isSuccess()).toBe(false);
    expect(mockRouter.navigate).not.toHaveBeenCalled();

    authServiceMock.authInitialized.set(true);
    authServiceMock.isAuthenticated.set(true);
    authServiceMock.user.set({_id: 'user-1'} as unknown as {
      pendingEmail?: string;
    });
    await renderAndSettle();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('should show mapped error for token_expired', async () => {
    await setupComponent({error: 'token_expired'});
    await renderAndSettle();

    expect(await harness.getErrorText()).toContain('expired');
  });

  it('should show mapped error for invalid_token', async () => {
    await setupComponent({error: 'invalid_token'});
    await renderAndSettle();

    expect(await harness.getErrorText()).toContain('Invalid email change link');
  });

  it('should show generic fallback for unknown callback error', async () => {
    await setupComponent({error: 'unexpected'});
    await renderAndSettle();

    expect(await harness.getErrorText()).toBe('Failed to change email');
  });

  it('should render error icon in error state', async () => {
    await setupComponent({error: 'invalid_token'});
    await renderAndSettle();

    expect(await harness.isError()).toBe(true);
  });

  it('should show back to account link in error state', async () => {
    await setupComponent({error: 'invalid_token'});
    await renderAndSettle();

    expect(await harness.hasBackLink()).toBe(true);
  });
});
