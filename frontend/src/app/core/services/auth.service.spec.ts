import {TestBed} from '@angular/core/testing';
import {
  AuthService,
  SocialAuthBlockedError,
} from '@/core/services/auth.service';
import {Router} from '@angular/router';
import {vi, describe, it, expect, beforeEach, type Mock} from 'vitest';
import {signal} from '@angular/core';
import {CONVEX} from 'convex-angular';
import type * as ConvexAngular from 'convex-angular';
import {type UserModel} from '@/testing/user-model';
import {logger} from '@/utils/logger';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../testing/mock-types';
import {AUTH_CLIENT, type AuthClient} from './auth-client.token';
import {AUTH_SETTLE_TIMEOUT_MS} from './auth.service.helpers';
import {COMPROMISED_PASSWORD_MESSAGE} from '@shared/constants';
import {BraToastService} from '@ui/components/composites/toast/toast.service';

const authClient = {
  signIn: {
    email: vi.fn(),
    social: vi.fn(),
  },
  signUp: {
    email: vi.fn(),
  },
  verifyEmail: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn().mockResolvedValue({data: null, error: null}),
  $fetch: vi.fn(),
  convex: {
    token: vi.fn(),
  },
};

const {convexAuthState, injectAuthMock} = vi.hoisted(() => {
  const createSignal = <T>(initial: T) => {
    let value = initial;
    const read = (() => value) as (() => T) & {set: (next: T) => void};
    read.set = (next: T) => {
      value = next;
    };
    return read;
  };

  const convexAuthState = {
    status: createSignal<'loading' | 'authenticated' | 'unauthenticated'>(
      'authenticated',
    ),
    isAuthenticated: createSignal(true),
    isLoading: createSignal(false),
    error: createSignal<Error | undefined>(undefined),
  };

  const injectAuthMock = vi.fn(() => convexAuthState);
  return {convexAuthState, injectAuthMock};
});

vi.mock('convex-angular', async () => {
  type ConvexAngularModule = typeof ConvexAngular;
  const actual = await vi.importActual<ConvexAngularModule>('convex-angular');
  return {
    ...actual,
    injectAuth: injectAuthMock,
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let routerSpy: {navigate: Mock; navigateByUrl: Mock; url: string};
  let toastSpy: {error: Mock; success: Mock};
  let convexClientMock: MockConvexClient;
  let mutationMock: ReturnType<typeof vi.fn>;
  const userSignal = signal<UserModel | null>(null);
  const userLoadingSignal = signal(false);
  const scannerStaffSignal = signal<boolean | undefined>(undefined);
  const scannerStaffLoadingSignal = signal(false);

  type TestSession = {
    user: {email: string; name?: string; image?: string | null};
    session?: {id?: string | null} | null;
  } | null;
  interface AuthServiceInternals {
    setSessionState?: (value: TestSession) => void;
    session?: {
      set: (value: TestSession) => void;
    };
    authInitialized: {
      set: (value: boolean) => void;
    };
  }

  function setSession(session: TestSession): void {
    const internals = service as unknown as AuthServiceInternals;
    if (internals.setSessionState) {
      internals.setSessionState(session);
      return;
    }
    internals.session?.set(session);
  }

  function setAuthInitialized(initialized: boolean): void {
    (service as unknown as AuthServiceInternals).authInitialized.set(
      initialized,
    );
  }

  function attachTestQueries(target: AuthService): void {
    (target as unknown as {user: typeof userSignal}).user = userSignal;
    (
      target as unknown as {
        userQuery: {
          data: typeof userSignal;
          isLoading: typeof userLoadingSignal;
        };
      }
    ).userQuery = {
      data: userSignal,
      isLoading: userLoadingSignal,
    };
    (
      target as unknown as {
        scannerStaffQuery: {
          data: typeof scannerStaffSignal;
          isLoading: typeof scannerStaffLoadingSignal;
        };
      }
    ).scannerStaffQuery = {
      data: scannerStaffSignal,
      isLoading: scannerStaffLoadingSignal,
    };
  }

  beforeEach(() => {
    // Keep shared setup-file mock implementations intact; reset only call history here.
    vi.clearAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    injectAuthMock.mockReturnValue(convexAuthState);
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(authClient.signIn.social).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(authClient.verifyEmail).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(authClient.signOut).mockResolvedValue(undefined);
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(authClient.$fetch).mockResolvedValue(undefined);
    vi.mocked(authClient.convex.token).mockResolvedValue({
      data: {token: 'default-token'},
      error: null,
    });
    convexAuthState.status.set('authenticated');
    convexAuthState.isAuthenticated.set(true);
    convexAuthState.isLoading.set(false);
    convexAuthState.error.set(undefined);

    routerSpy = {
      navigate: vi.fn().mockResolvedValue(true),
      navigateByUrl: vi.fn().mockResolvedValue(true),
      url: '/',
    };
    toastSpy = {error: vi.fn(), success: vi.fn()};

    convexClientMock = createMockConvexClient();
    mutationMock = vi.fn().mockResolvedValue({
      status: 'synced',
      requiresSocialSignupCompletion: false,
    });
    convexClientMock.mutation = mutationMock;

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        {provide: Router, useValue: routerSpy},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: AUTH_CLIENT, useValue: authClient as unknown as AuthClient},
        {provide: BraToastService, useValue: toastSpy},
      ],
    });

    service = TestBed.inject(AuthService);

    // Manually override the query-backed signals for testing since injectQuery is hard to mock directly
    attachTestQueries(service);
    setSession(null);
    userLoadingSignal.set(false);
    scannerStaffSignal.set(undefined);
    scannerStaffLoadingSignal.set(false);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('auth state', () => {
    it('should compute isAuthenticated correctly', () => {
      userSignal.set(null);
      expect(service.isAuthenticated()).toBe(false);

      setSession({user: {email: 'test@example.com', name: 'Test'}});
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test',
        _creationTime: 123,
      } as UserModel);
      expect(service.isAuthenticated()).toBe(true);
    });

    it('should compute userRole correctly', () => {
      userSignal.set({
        _id: '1' as unknown,
        isRootAdmin: true,
      } as UserModel);
      expect(service.userRole()).toBe('root_admin');

      userSignal.set({
        _id: '2' as unknown,
        communityAdminOrganizerIds: ['org-1' as unknown],
      } as UserModel);
      expect(service.userRole()).toBe('community_admin');

      userSignal.set({_id: '3' as unknown} as UserModel);
      expect(service.userRole()).toBe('user');
    });
  });

  describe('loginWithPassword', () => {
    it('should call authClient.signIn.email and navigate on success', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      // After signIn.email, loginWithPassword calls getSession to ensure crossDomainClient stores the session
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test',
        _creationTime: 123,
      } as UserModel);

      await service.loginWithPassword('test@example.com', 'password');

      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
        callbackURL: `${window.location.origin}/`,
      });
      expect(authClient.getSession).toHaveBeenCalled();
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('retries session establishment when Better Auth has not settled yet', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession)
        .mockResolvedValueOnce({data: null, error: null})
        .mockResolvedValueOnce({data: mockSession, error: null});
      vi.mocked(authClient.getSession).mockClear();
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);

      await service.loginWithPassword('test@example.com', 'password');

      expect(authClient.getSession).toHaveBeenCalledTimes(2);
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('does not call syncCurrentUser during routine password login', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);
      mutationMock.mockRejectedValue(
        new Error('syncCurrentUser should not run during login'),
      );

      await service.loginWithPassword('test@example.com', 'password');

      expect(mutationMock).not.toHaveBeenCalled();
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('repairs a missing app user after password login when the user query is empty', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set(null);

      await service.loginWithPassword('test@example.com', 'password');

      await vi.waitFor(() => {
        expect(mutationMock).toHaveBeenCalledTimes(1);
      });
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('does not mark auth sync as failed when password login succeeds without client-owned sync', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);
      mutationMock.mockRejectedValue(
        new Error('syncCurrentUser should not run during login'),
      );

      await service.loginWithPassword('test@example.com', 'password');

      expect(mutationMock).not.toHaveBeenCalled();
      expect(service.authSyncFailed()).toBe(false);
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('preserves internal returnUrl query strings and fragments', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);

      await service.loginWithPassword(
        'test@example.com',
        'password',
        '/tickets?tab=buyers#details',
      );

      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
        callbackURL: `${window.location.origin}/tickets?tab=buyers#details`,
      });
      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith(
        '/tickets?tab=buyers#details',
      );
    });

    it('should throw error on failure', async () => {
      vi.mocked(authClient.signIn.email).mockResolvedValue({
        data: null,
        error: {message: 'Invalid credentials'} as Error,
      });

      await expect(
        service.loginWithPassword('test@e.com', 'p'),
      ).rejects.toThrow('Invalid email or password');
    });
  });

  describe('fetchAccessToken', () => {
    it('retries transient Better Auth token fetch failures', async () => {
      setSession({user: {email: 'test@example.com', name: 'Test User'}});
      vi.mocked(authClient.convex.token)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          data: {token: 'retry-token'},
          error: null,
        });

      await expect(
        service.fetchAccessToken({forceRefreshToken: false}),
      ).resolves.toBe('retry-token');
      expect(authClient.convex.token).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Token fetch attempt 1/5 failed; retrying',
        expect.any(TypeError),
      );
    });

    it('treats forceRefreshToken as an explicit stateless token fetch hint', async () => {
      setSession({user: {email: 'test@example.com', name: 'Test User'}});
      vi.mocked(authClient.convex.token).mockResolvedValueOnce({
        data: {token: 'fresh-token'},
        error: null,
      });

      await expect(
        service.fetchAccessToken({forceRefreshToken: true}),
      ).resolves.toBe('fresh-token');
      expect(logger.debug).toHaveBeenCalledWith(
        '[AuthService] forceRefreshToken requested; fetching a fresh Better Auth Convex token',
      );
    });

    it('returns null after a non-retryable token fetch failure', async () => {
      setSession({user: {email: 'test@example.com', name: 'Test User'}});
      const failure = new Error('permission denied');
      vi.mocked(authClient.convex.token).mockRejectedValueOnce(failure);

      await expect(
        service.fetchAccessToken({forceRefreshToken: true}),
      ).resolves.toBeNull();
      expect(authClient.convex.token).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Exception fetching Convex token from Better Auth:',
        failure,
      );
    });
  });

  describe('backend-owned sync bootstrap', () => {
    it('does not sync on bootstrap when the authenticated user query already resolved a user', async () => {
      const mockSession = {
        user: {email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      setAuthInitialized(true);
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);
      userLoadingSignal.set(false);
      mutationMock.mockClear();

      setSession(mockSession);

      await vi.waitFor(() => {
        expect(mutationMock).not.toHaveBeenCalled();
      });
    });

    it('does not attempt client-owned sync when the authenticated user query settles to null', async () => {
      const mockSession = {
        user: {email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      setAuthInitialized(true);
      userLoadingSignal.set(true);

      setSession(mockSession);
      await Promise.resolve();
      expect(mutationMock).not.toHaveBeenCalled();

      userLoadingSignal.set(false);
      userSignal.set(null);

      await vi.waitFor(() => {
        expect(mutationMock).not.toHaveBeenCalled();
      });
    });
  });

  describe('signup', () => {
    it('should call authClient.signUp.email and navigate on success', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@e.com', name: 'Name'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.convex.token).mockResolvedValue({
        data: {token: 'test-token'},
        error: null,
      });

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      expect(authClient.signUp.email).toHaveBeenCalledWith({
        email: 'test@e.com',
        password: 'pass',
        name: 'Name',
        callbackURL: `${window.location.origin}/confirm/verification`,
      });
      expect(routerSpy.navigate).toHaveBeenCalledWith(
        ['/login'],
        expect.any(Object),
      );
    });

    it('preserves an internal returnUrl through signup verification and login success state', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: null,
      });

      await service.signup(
        'invitee@example.com',
        'pass',
        'pass',
        'Invitee',
        '/admin-invite/invite-token',
      );

      expect(authClient.signUp.email).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        password: 'pass',
        name: 'Invitee',
        callbackURL: `${window.location.origin}/confirm/verification?returnUrl=%2Fadmin-invite%2Finvite-token`,
      });
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {
          registered: 'true',
          returnUrl: '/admin-invite/invite-token',
        },
      });
    });

    it('drops unsafe signup returnUrl values', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: null,
      });

      await service.signup(
        'invitee@example.com',
        'pass',
        'pass',
        'Invitee',
        'https://evil.example/admin-invite/token',
      );

      expect(authClient.signUp.email).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        password: 'pass',
        name: 'Invitee',
        callbackURL: `${window.location.origin}/confirm/verification`,
      });
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });

    it('should throw if passwords do not match', async () => {
      await expect(service.signup('a', 'b', 'c', 'd')).rejects.toThrow(
        'Passwords do not match',
      );
    });

    it('navigates to success page when email is already registered (prevents enumeration)', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: {message: 'User already exists'} as Error,
      });

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });

    it('navigates to success page when Better Auth reports duplicate user by code', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: {
          message: 'Failed to create user',
          code: 'FAILED_TO_CREATE_USER',
        } as Error & {code: string},
      });

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });

    it('maps a compromised-password rejection to the shared brand-voice message', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: {
          message: 'The password you entered has been compromised.',
          code: 'PASSWORD_COMPROMISED',
        } as Error & {code: string},
      });

      await expect(
        service.signup('test@e.com', 'breached-pass', 'breached-pass', 'Name'),
      ).rejects.toThrow(COMPROMISED_PASSWORD_MESSAGE);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('maps a thrown compromised-password rejection from the auth client', async () => {
      vi.mocked(authClient.signUp.email).mockRejectedValueOnce(
        Object.assign(new Error('Password compromised'), {
          code: 'PASSWORD_COMPROMISED',
        }),
      );

      await expect(
        service.signup('test@e.com', 'breached-pass', 'breached-pass', 'Name'),
      ).rejects.toThrow(COMPROMISED_PASSWORD_MESSAGE);
    });

    it('navigates to success page when duplicate signup throws from the auth client', async () => {
      vi.mocked(authClient.signUp.email).mockRejectedValueOnce(
        new Error('FAILED_TO_CREATE_USER: Failed to create user'),
      );

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });

    it('treats verification-required signup responses as successful registration', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: {message: 'Email verification required'} as Error,
      });

      await service.signup(
        'test@e.com',
        'pass',
        'pass',
        'Name',
        '/admin-invite/invite-token',
      );

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {
          registered: 'true',
          returnUrl: '/admin-invite/invite-token',
        },
      });
    });

    it('treats thrown verification-required signup responses as successful registration', async () => {
      vi.mocked(authClient.signUp.email).mockRejectedValueOnce(
        new Error('Email verification required'),
      );

      await service.signup(
        'test@e.com',
        'pass',
        'pass',
        'Name',
        '/admin-invite/invite-token',
      );

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {
          registered: 'true',
          returnUrl: '/admin-invite/invite-token',
        },
      });
    });

    it('navigates to success page when email is registered via social provider (prevents enumeration)', async () => {
      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: null,
        error: {
          message: 'Account with this email already exists via Discord',
        } as Error,
      });

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });

    it('repairs a missing app user after successful verified signup', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@e.com', name: 'Name'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.signUp.email).mockResolvedValue({
        data: {
          user: {emailVerified: true},
        },
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set(null);

      await service.signup('test@e.com', 'pass', 'pass', 'Name');

      await vi.waitFor(() => {
        expect(mutationMock).toHaveBeenCalledTimes(1);
      });
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: {registered: 'true'},
      });
    });
  });

  describe('logout', () => {
    it('should call authClient.signOut and navigate', async () => {
      vi.mocked(authClient.signOut).mockResolvedValue(undefined);

      await service.logout();

      expect(authClient.signOut).toHaveBeenCalled();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/'], {
        replaceUrl: true,
      });
    });
  });

  describe('session initialization', () => {
    it('ignores a stale initSession result after logout wins the race', async () => {
      const staleSession = {
        user: {id: '123', email: 'stale@example.com', name: 'Stale Session'},
        session: {id: 'session-123'},
      };
      let resolveGetSession:
        | ((value: {data: typeof staleSession; error: null}) => void)
        | undefined;
      const pendingGetSession = new Promise<{
        data: typeof staleSession;
        error: null;
      }>((resolve) => {
        resolveGetSession = resolve;
      });

      vi.mocked(authClient.getSession).mockReturnValueOnce(pendingGetSession);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          {provide: Router, useValue: routerSpy},
          {provide: CONVEX, useValue: convexClientMock},
          {provide: AUTH_CLIENT, useValue: authClient as unknown as AuthClient},
        ],
      });

      const pendingInitService = TestBed.inject(AuthService);
      attachTestQueries(pendingInitService);

      pendingInitService.logout();
      resolveGetSession?.({data: staleSession, error: null});

      await vi.waitFor(() => {
        expect(pendingInitService.authInitialized()).toBe(true);
      });

      expect(pendingInitService.isAuthenticated()).toBe(false);
      expect(pendingInitService.email()).toBeNull();
    });
  });

  describe('email', () => {
    it('prefers the synced app user email over the Better Auth session snapshot', () => {
      setSession({
        user: {email: 'session@example.com', name: 'Session User'},
        session: {id: 'session-123'},
      });
      userSignal.set({
        _id: 'user-1',
        email: 'app@example.com',
      } as UserModel);

      expect(service.email()).toBe('app@example.com');
    });
  });

  describe('missing app-user repair', () => {
    it('repairs a missing app user after refreshing an authenticated session', async () => {
      const session = {
        user: {email: 'session@example.com', name: 'Session User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.getSession).mockResolvedValue({
        data: session,
        error: null,
      });
      setAuthInitialized(true);
      userSignal.set(null);

      await service.refreshSessionFromServer({syncUser: false});

      await vi.waitFor(() => {
        expect(mutationMock).toHaveBeenCalledTimes(1);
      });
      expect(mutationMock.mock.calls.at(-1)?.[1]).toEqual({});
    });

    it('waits for a late-settling current-user query before repairing', async () => {
      vi.useFakeTimers();
      try {
        const session = {
          user: {email: 'session@example.com', name: 'Session User'},
          session: {id: 'session-123'},
        };

        vi.mocked(authClient.getSession).mockResolvedValue({
          data: session,
          error: null,
        });
        setAuthInitialized(true);
        userLoadingSignal.set(true);
        userSignal.set(null);

        await service.refreshSessionFromServer({syncUser: false});
        await vi.advanceTimersByTimeAsync(250);

        expect(mutationMock).not.toHaveBeenCalled();

        userLoadingSignal.set(false);
        await vi.advanceTimersByTimeAsync(1000);

        expect(mutationMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not repair when the refreshed app user is already loaded', async () => {
      const session = {
        user: {email: 'session@example.com', name: 'Session User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.getSession).mockResolvedValue({
        data: session,
        error: null,
      });
      setAuthInitialized(true);
      userSignal.set({
        _id: 'user-1',
        email: 'app@example.com',
      } as UserModel);

      await service.refreshSessionFromServer({syncUser: false});
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mutationMock).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent repair scheduling for the same session', async () => {
      vi.useFakeTimers();
      try {
        const session = {
          user: {email: 'session@example.com', name: 'Session User'},
          session: {id: 'session-123'},
        };

        vi.mocked(authClient.getSession).mockResolvedValue({
          data: session,
          error: null,
        });
        setAuthInitialized(true);
        userLoadingSignal.set(true);
        userSignal.set(null);

        await Promise.all([
          service.refreshSessionFromServer({syncUser: false}),
          service.refreshSessionFromServer({syncUser: false}),
        ]);

        await vi.advanceTimersByTimeAsync(250);
        expect(mutationMock).not.toHaveBeenCalled();

        userLoadingSignal.set(false);
        await vi.advanceTimersByTimeAsync(1000);

        expect(mutationMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry repair for the same refreshed session after a failure', async () => {
      const session = {
        user: {email: 'session@example.com', name: 'Session User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.getSession).mockResolvedValue({
        data: session,
        error: null,
      });
      mutationMock.mockRejectedValueOnce(new Error('repair failed'));
      setAuthInitialized(true);
      userSignal.set(null);

      await service.refreshSessionFromServer({syncUser: false});

      await vi.waitFor(() => {
        expect(mutationMock).toHaveBeenCalledTimes(1);
      });

      await service.refreshSessionFromServer({syncUser: false});
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mutationMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmVerification', () => {
    it('should verify email, refresh the session, and sync the user to Convex', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.verifyEmail).mockResolvedValue({
        data: null,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      vi.mocked(authClient.getSession).mockClear();
      mutationMock.mockResolvedValueOnce({
        status: 'synced',
        requiresSocialSignupCompletion: false,
      });

      await service.confirmVerification('verify-token');

      expect(authClient.verifyEmail).toHaveBeenCalledWith({
        query: {token: 'verify-token'},
      });
      expect(authClient.getSession).toHaveBeenCalledTimes(1);
      expect(mutationMock).toHaveBeenCalled();
      expect(mutationMock.mock.calls.at(-1)?.[1]).toEqual({});
    });

    it('retries session establishment after verification until Better Auth settles', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.verifyEmail).mockResolvedValue({
        data: null,
        error: null,
      });
      vi.mocked(authClient.getSession)
        .mockResolvedValueOnce({data: null, error: null})
        .mockResolvedValueOnce({data: mockSession, error: null});
      vi.mocked(authClient.getSession).mockClear();
      mutationMock.mockResolvedValueOnce({
        status: 'synced',
        requiresSocialSignupCompletion: false,
      });

      await expect(
        service.confirmVerification('verify-token'),
      ).resolves.toBeUndefined();
      expect(authClient.getSession).toHaveBeenCalledTimes(2);
      expect(mutationMock).toHaveBeenCalled();
    });

    it('fails verification when the user sync never settles (prevents /dashboard guard deadlock)', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };

      vi.mocked(authClient.verifyEmail).mockResolvedValue({
        data: null,
        error: null,
      });
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      mutationMock.mockRejectedValue(new Error('Unauthenticated'));

      await expect(service.confirmVerification('verify-token')).rejects.toThrow(
        'Unauthenticated',
      );
    });
  });

  describe('linkSocial', () => {
    it('passes a callback URL anchored to the current browser origin', async () => {
      mutationMock.mockResolvedValueOnce({
        url: 'https://provider.example.com/oauth',
      });
      const redirectSpy = vi
        .spyOn(
          service as unknown as {redirectToExternalUrl: (url: string) => void},
          'redirectToExternalUrl',
        )
        .mockImplementation(() => undefined);

      await service.linkSocial('google');

      const linkCall = mutationMock.mock.calls.at(-1);

      expect(linkCall).toBeDefined();
      expect(linkCall?.[1]).toEqual({
        provider: 'google',
        callbackURL: `${window.location.origin}/confirm/social-link?provider=google`,
      });
      expect(redirectSpy).toHaveBeenCalledWith(
        'https://provider.example.com/oauth',
      );
    });
  });

  describe('handleOAuthCallback', () => {
    it('returns onboarding completion state for a newly created social user', async () => {
      const mockSession = {
        user: {id: '123', email: 'test@example.com', name: 'Test User'},
        session: {id: 'session-123'},
      };
      vi.mocked(authClient.$fetch).mockResolvedValue(undefined);
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: mockSession,
        error: null,
      });
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
      } as UserModel);
      mutationMock.mockResolvedValueOnce({
        status: 'synced',
        requiresSocialSignupCompletion: true,
      });

      await expect(
        service.handleOAuthCallback('ott-token', {
          navigateOnSuccess: false,
          syncUserToApp: true,
        }),
      ).resolves.toEqual({requiresSocialSignupCompletion: true});

      expect(authClient.$fetch).toHaveBeenCalledWith(
        '/cross-domain/one-time-token/verify',
        {
          method: 'POST',
          body: {token: 'ott-token'},
        },
      );
    });

    it.each([
      {
        blockedReason: 'provider_email_missing' as const,
        expectedMessage:
          'This provider did not return an email address. Sign in with your existing account first, then link it from account settings.',
      },
      {
        blockedReason: 'provider_email_unverified' as const,
        expectedMessage:
          'This provider did not return a verified email address. Verify the provider email first or sign in with your existing account and link it manually.',
      },
    ])(
      'blocks a Discord OAuth callback when syncCurrentUser reports $blockedReason',
      async ({blockedReason, expectedMessage}) => {
        const mockSession = {
          user: {
            id: 'discord-user-123',
            email: 'discord-user@example.com',
            name: 'Discord User',
          },
          session: {id: 'session-123'},
        };

        vi.mocked(authClient.$fetch).mockResolvedValue(undefined);
        vi.mocked(authClient.getSession).mockResolvedValue({
          data: mockSession,
          error: null,
        });
        mutationMock.mockResolvedValueOnce({
          status: 'blocked',
          reason: blockedReason,
        });

        await expect(
          service.handleOAuthCallback('ott-token', {
            navigateOnSuccess: false,
            syncUserToApp: true,
          }),
        ).rejects.toEqual(new SocialAuthBlockedError(blockedReason));

        expect(authClient.$fetch).toHaveBeenCalledWith(
          '/cross-domain/one-time-token/verify',
          {
            method: 'POST',
            body: {token: 'ott-token'},
          },
        );
        expect(authClient.signOut).toHaveBeenCalledTimes(1);
        expect(service.isAuthenticated()).toBe(false);
        expect(service.email()).toBeNull();
        expect(routerSpy.navigate).not.toHaveBeenCalled();
        expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
        expect(expectedMessage).toBe(
          new SocialAuthBlockedError(blockedReason).message,
        );
      },
    );
  });

  describe('completeSocialSignupOnboarding', () => {
    it('calls the onboarding completion mutation without blocking on current-user refresh', async () => {
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test User',
        _creationTime: 123,
        termsAcceptedAt: Date.now(),
      } as UserModel);

      await service.completeSocialSignupOnboarding();

      const call = mutationMock.mock.calls.at(-1);
      expect(call).toBeDefined();
      expect(call?.[1]).toEqual({});
    });
  });

  describe('isScannerStaff', () => {
    it('should return false when not authenticated', () => {
      userSignal.set(null);
      expect(service.isScannerStaff()).toBe(false);
    });

    it('should return false by default (query returns undefined)', () => {
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test',
        _creationTime: 123,
      } as UserModel);
      expect(service.isScannerStaff()).toBe(false);
    });

    it('should return true when the scanner capability query resolves true', () => {
      setSession({user: {email: 'test@example.com', name: 'Test'}});
      userSignal.set({
        _id: '1' as unknown,
        name: 'Test',
        _creationTime: 123,
      } as UserModel);
      scannerStaffSignal.set(true);

      expect(service.isScannerStaff()).toBe(true);
    });
  });

  describe('isScannerStaffLoading', () => {
    it('should expose loading state from scanner staff query', () => {
      scannerStaffLoadingSignal.set(true);
      expect(service.isScannerStaffLoading()).toBe(true);
    });
  });

  describe('BroadcastChannel message validation', () => {
    /**
     * We need to intercept the BroadcastChannel constructor used by the service
     * so we can capture the onmessage handler it sets. vi.stubGlobal replaces the
     * global in a way that bare references in module code also see the stub.
     */
    let capturedOnMessage: ((event: MessageEvent) => void) | null;

    beforeEach(() => {
      capturedOnMessage = null;

      // Stub BroadcastChannel globally — affects bare `new BroadcastChannel()` calls in modules
      vi.stubGlobal(
        'BroadcastChannel',
        class MockBroadcastChannel {
          onmessage: ((event: MessageEvent) => void) | null = null;
          postMessage = vi.fn();
          close = vi.fn();

          constructor(_name: string) {
            // Capture the instance so tests can set onmessage and call handlers
            // The service sets onmessage after construction, so we proxy it
            Object.defineProperty(this, 'onmessage', {
              get: () => capturedOnMessage,
              set: (handler: ((event: MessageEvent) => void) | null) => {
                capturedOnMessage = handler;
              },
              configurable: true,
            });
          }
        },
      );

      // Re-create the service so it picks up the mocked BroadcastChannel
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          {provide: Router, useValue: routerSpy},
          {provide: CONVEX, useValue: convexClientMock},
          {provide: AUTH_CLIENT, useValue: authClient as unknown as AuthClient},
        ],
      });
      service = TestBed.inject(AuthService);
      attachTestQueries(service);
      (service as unknown as {user: typeof userSignal}).user = userSignal;
      setSession(null);
      userSignal.set(null);
      userLoadingSignal.set(false);
      scannerStaffSignal.set(undefined);
      scannerStaffLoadingSignal.set(false);
      vi.mocked(authClient.getSession).mockClear();

      vi.mocked(logger.warn).mockClear();
      vi.mocked(routerSpy.navigate).mockClear();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function dispatchMessage(data: unknown): void {
      expect(
        capturedOnMessage,
        'onmessage handler must be registered by service',
      ).not.toBeNull();
      capturedOnMessage!({data} as MessageEvent);
    }

    it('should process a valid LOGOUT message and clear auth state', async () => {
      vi.mocked(authClient.signOut).mockResolvedValue(undefined);

      dispatchMessage({type: 'LOGOUT'});

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/'], {
        replaceUrl: true,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should process a valid LOGIN message without warning', async () => {
      vi.mocked(authClient.getSession).mockResolvedValue({
        data: null,
        error: null,
      });

      dispatchMessage({type: 'LOGIN'});

      expect(logger.warn).not.toHaveBeenCalled();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('retries a slow LOGIN session refresh before repairing a missing app user', async () => {
      const session = {
        user: {email: 'session@example.com', name: 'Session User'},
        session: {id: 'session-123'},
      };

      vi.useFakeTimers();
      try {
        setAuthInitialized(true);
        setSession(session);
        userSignal.set(null);
        vi.mocked(authClient.getSession)
          .mockReset()
          .mockResolvedValueOnce({data: null, error: null})
          .mockResolvedValueOnce({data: null, error: null})
          .mockResolvedValueOnce({data: null, error: null})
          .mockResolvedValueOnce({data: null, error: null})
          .mockResolvedValueOnce({data: null, error: null})
          .mockResolvedValueOnce({data: session, error: null})
          .mockResolvedValue({data: null, error: null});

        dispatchMessage({type: 'LOGIN'});

        await vi.advanceTimersByTimeAsync(4000);

        await vi.waitFor(() => {
          expect(mutationMock).toHaveBeenCalledTimes(1);
        });
        expect(authClient.getSession).toHaveBeenCalledTimes(6);
        expect(logger.warn).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should reject null and log a warning', () => {
      dispatchMessage(null);

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'object',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('should reject undefined and log a warning', () => {
      dispatchMessage(undefined);

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'undefined',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('should reject an object with an unknown type and log a warning', () => {
      dispatchMessage({type: 'INVALID'});

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'object',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('should reject an object missing the type field and log a warning', () => {
      dispatchMessage({foo: 'bar'});

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'object',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('should reject a plain string and log a warning', () => {
      dispatchMessage('LOGOUT');

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'string',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('should reject a number and log a warning', () => {
      dispatchMessage(42);

      expect(logger.warn).toHaveBeenCalledWith(
        '[AuthService] Rejected invalid BroadcastChannel message:',
        'number',
      );
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });
  });

  describe('authSettled', () => {
    it('is false before initialization completes', () => {
      setAuthInitialized(false);
      expect(service.authSettled()).toBe(false);
    });

    it('is true when initialized and unauthenticated', () => {
      setSession(null);
      setAuthInitialized(true);
      expect(service.authSettled()).toBe(true);
    });

    it('is false when authenticated but the profile has not synced', () => {
      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set(null);
      setAuthInitialized(true);
      expect(service.authSettled()).toBe(false);
    });

    it('is true once the profile arrives', () => {
      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set({_id: 'u1' as unknown, _creationTime: 1} as UserModel);
      setAuthInitialized(true);
      expect(service.authSettled()).toBe(true);
    });

    it('is true when sync explicitly gave up', () => {
      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set(null);
      service.authSyncFailed.set(true);
      setAuthInitialized(true);
      expect(service.authSettled()).toBe(true);
    });
  });

  describe('scheduleOptimisticReconciliation', () => {
    async function settleAndFlush(): Promise<void> {
      // toObservable emissions ride on effect flushes; tick then drain the
      // promise chain inside the reconciliation.
      TestBed.tick();
      await vi.waitFor(() => {
        TestBed.tick();
        expect(service.authSettled()).toBe(true);
      });
      // Drain the .then chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    it('does nothing when the optimistic guess was correct', async () => {
      service.scheduleOptimisticReconciliation();

      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set({_id: 'u1' as unknown, _creationTime: 1} as UserModel);
      setAuthInitialized(true);
      await settleAndFlush();

      expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
      expect(toastSpy.error).not.toHaveBeenCalled();
    });

    it('re-runs guards and toasts when the session turned out stale', async () => {
      routerSpy.url = '/tickets';
      service.scheduleOptimisticReconciliation();

      setSession(null);
      setAuthInitialized(true);
      await settleAndFlush();

      await vi.waitFor(() => {
        expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/tickets', {
          replaceUrl: true,
        });
      });
      expect(toastSpy.error).toHaveBeenCalledWith(
        'session expired. please log in again.',
      );
    });

    it('re-runs guards without a toast when social signup completion is required', async () => {
      service.scheduleOptimisticReconciliation();

      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set({
        _id: 'u1' as unknown,
        _creationTime: 1,
        socialSignupCompletionRequired: true,
      } as unknown as UserModel);
      setAuthInitialized(true);
      await settleAndFlush();

      await vi.waitFor(() => {
        expect(routerSpy.navigateByUrl).toHaveBeenCalledTimes(1);
      });
      expect(toastSpy.error).not.toHaveBeenCalled();
    });

    it('is idempotent within one settle window', async () => {
      routerSpy.url = '/tickets';
      service.scheduleOptimisticReconciliation();
      service.scheduleOptimisticReconciliation();
      service.scheduleOptimisticReconciliation();

      setSession(null);
      setAuthInitialized(true);
      await settleAndFlush();

      await vi.waitFor(() => {
        expect(routerSpy.navigateByUrl).toHaveBeenCalled();
      });
      expect(routerSpy.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('recovers off the optimistic route when auth never settles', async () => {
      vi.useFakeTimers();
      try {
        routerSpy.url = '/tickets';
        // Authenticated, initialized, but the profile query never resolves and
        // sync never fails: authSettled would stay false indefinitely.
        setSession({user: {email: 'buyer@example.com'}});
        userSignal.set(null);
        setAuthInitialized(true);
        expect(service.authSettled()).toBe(false);

        service.scheduleOptimisticReconciliation();
        TestBed.tick(); // flush the (filtered-out) false emission

        await vi.advanceTimersByTimeAsync(AUTH_SETTLE_TIMEOUT_MS + 100);

        // The give-up latch forces settle and the guards are re-run, so the user
        // is recovered off the skeleton rather than stranded on it.
        expect(service.authSettled()).toBe(true);
        expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/tickets', {
          replaceUrl: true,
        });
        expect(toastSpy.error).toHaveBeenCalledWith(
          'could not confirm your session. please try again.',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the give-up latch on a fresh session so a later login is not bounced', async () => {
      // 1) A stall trips the timeout latch.
      vi.useFakeTimers();
      try {
        setSession({user: {email: 'buyer@example.com'}});
        userSignal.set(null);
        setAuthInitialized(true);
        service.scheduleOptimisticReconciliation();
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(AUTH_SETTLE_TIMEOUT_MS + 100);
        expect(service.authSettled()).toBe(true); // latched
      } finally {
        vi.useRealTimers();
      }

      // 2) A fresh session (re-login / refresh) arrives; its profile query is
      //    still pending. The latch must clear so guards wait rather than treat
      //    authenticated-without-profile as a failure and bounce the user.
      setSession({user: {email: 'buyer@example.com'}});
      userSignal.set(null);
      expect(service.authSettled()).toBe(false);

      // 3) Profile resolves → settles true, so protected routes are admitted.
      userSignal.set({
        _id: 'u1' as unknown,
        _creationTime: 1,
      } as unknown as UserModel);
      expect(service.authSettled()).toBe(true);
    });
  });
});
