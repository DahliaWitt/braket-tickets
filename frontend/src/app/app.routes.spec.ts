import {TestBed} from '@angular/core/testing';
import {Router, type CanActivateFn, type Routes} from '@angular/router';
import {AuthService} from '@/core/services/auth.service';
import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {routes} from './app.routes';
import {ADMIN_ROUTES} from '@/features/admin/admin.routes';
import {COMMUNITY_ADMIN_ROUTES} from '@/features/admin/community-admin.routes';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {SCANNER_ROUTES} from '@/features/admin/scanner.routes';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {computed, signal, type Signal} from '@angular/core';
import {firstValueFrom, type Observable} from 'rxjs';

describe('app.routes', () => {
  const layoutRoute = routes.find((r) => r.path === '' && r.children);
  const layoutChildren = layoutRoute?.children ?? [];

  const adminShellRoute: Routes[number] | undefined = ADMIN_ROUTES[0];
  const adminChildren = adminShellRoute?.children ?? [];

  const communityAdminShellRoute: Routes[number] | undefined =
    COMMUNITY_ADMIN_ROUTES[0];
  const communityAdminChildren = communityAdminShellRoute?.children ?? [];

  let mockRouter: {createUrlTree: Mock; navigate: Mock};
  let mockAuthService: {
    isAuthenticated: Mock;
    userRole: Mock;
    authInitialized: ReturnType<typeof signal<boolean>>;
    user: ReturnType<typeof signal<object | null>>;
    isSyncingUser: ReturnType<typeof signal<boolean>>;
    authSyncFailed: ReturnType<typeof signal<boolean>>;
    authSettled: Signal<boolean>;
    peekCachedSession: Mock;
    scheduleOptimisticReconciliation: Mock;
  };
  let mockToastService: {
    error: Mock;
    show: Mock;
    success: Mock;
  };

  beforeEach(() => {
    vi.useRealTimers();
    mockRouter = {
      createUrlTree: vi.fn((segments: string[]) => ({path: segments[0]})),
      navigate: vi.fn(),
    };

    mockAuthService = {
      isAuthenticated: vi.fn(),
      userRole: vi.fn(),
      authInitialized: signal(true),
      user: signal<object | null>(null),
      isSyncingUser: signal(false),
      authSyncFailed: signal(false),
      // crossDomain/E2E-off shape: guards always defer to the async settle.
      peekCachedSession: vi.fn(() => ({
        known: false,
        hasCredential: false,
        session: null,
      })),
      scheduleOptimisticReconciliation: vi.fn(),
      // Mirrors the real settle predicate; lazy so it can close over the mock.
      authSettled: computed(() => {
        if (!mockAuthService.authInitialized()) return false;
        if (!mockAuthService.isAuthenticated()) return true;
        if (mockAuthService.user()) return true;
        return mockAuthService.authSyncFailed();
      }),
    };

    mockToastService = {
      error: vi.fn(),
      show: vi.fn(),
      success: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        {provide: Router, useValue: mockRouter},
        {provide: AuthService, useValue: mockAuthService},
        {provide: BraToastService, useValue: mockToastService},
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('routes configuration', () => {
    it('should have a redirect tombstone for /dashboard to /', () => {
      const dashboardRoute = layoutChildren.find((r) => r.path === 'dashboard');
      expect(dashboardRoute).toBeDefined();
      expect(dashboardRoute?.redirectTo).toBe('/');
      expect(dashboardRoute?.loadComponent).toBeUndefined();
    });

    it.each(['join/:token', 'apply/:token'])(
      'should redirect %s to /invite/:token',
      (path) => {
        const route = routes.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route?.pathMatch).toBe('full');

        const redirectFn = route?.redirectTo as ({
          params,
        }: {
          params: Record<string, string>;
        }) => string;
        expect(typeof redirectFn).toBe('function');
        expect(redirectFn({params: {token: 'abc123'}})).toBe('/invite/abc123');
      },
    );

    it('should redirect /c/:slug to /events?community=:slug', () => {
      const route = routes.find((r) => r.path === 'c/:slug');
      expect(route).toBeDefined();
      expect(route?.pathMatch).toBe('full');

      const redirectFn = route?.redirectTo as ({
        params,
      }: {
        params: Record<string, string>;
      }) => string;
      expect(typeof redirectFn).toBe('function');
      expect(redirectFn({params: {slug: 'test-slug'}})).toBe(
        '/events?community=test-slug',
      );
    });

    it('should redirect /communities/:slug to /events?community=:slug', () => {
      const route = routes.find((r) => r.path === 'communities/:slug');
      expect(route).toBeDefined();
      expect(route?.pathMatch).toBe('full');

      const redirectFn = route?.redirectTo as ({
        params,
      }: {
        params: Record<string, string>;
      }) => string;
      expect(typeof redirectFn).toBe('function');
      expect(redirectFn({params: {slug: 'test-slug'}})).toBe(
        '/events?community=test-slug',
      );
    });

    it('lazy-loads scanner routes at /scanner', async () => {
      const scannerRoute = routes.find((r) => r.path === 'scanner');
      expect(scannerRoute).toBeDefined();
      await expect(scannerRoute?.loadChildren?.()).resolves.toBe(
        SCANNER_ROUTES,
      );
    });

    it('does not expose the help center route', () => {
      const helpRoute = layoutChildren.find((r) => r.path === 'help');
      expect(helpRoute).toBeUndefined();
    });

    it('registers authenticated signed-in guest-list routes', () => {
      const listRoute = layoutChildren.find((r) => r.path === 'guest-lists');
      const manageRoute = layoutChildren.find(
        (r) => r.path === 'guest-lists/:assignmentId',
      );

      expect(listRoute?.canActivate).toEqual(expect.any(Array));
      expect(manageRoute?.canActivate).toEqual(expect.any(Array));
      expect(listRoute?.loadComponent).toEqual(expect.any(Function));
      expect(manageRoute?.loadComponent).toEqual(expect.any(Function));
    });

    it('keeps the accountless guest-list entry route outside auth guards', () => {
      const route = routes.find((r) => r.path === 'guest-list/manage');

      expect(route).toBeDefined();
      expect(route?.canActivate).toBeUndefined();
      expect(route?.canMatch).toBeUndefined();
      expect(route?.loadComponent).toEqual(expect.any(Function));
    });
  });

  describe('SCANNER_ROUTES', () => {
    it('guards the scanner shell and lazy-loads the check-in page', () => {
      const scannerShellRoute = SCANNER_ROUTES[0];
      expect(scannerShellRoute?.path).toBe('');
      expect(scannerShellRoute?.canActivate).toHaveLength(1);
      expect(scannerShellRoute?.loadComponent).toEqual(expect.any(Function));
    });
  });

  describe('ADMIN_ROUTES', () => {
    it('has a wildcard catch-all redirecting to /not-found', () => {
      const wildcardChild = adminChildren.find((r) => r.path === '**');
      expect(wildcardChild).toBeDefined();
      expect(wildcardChild?.redirectTo).toBe('/not-found');
    });
  });

  describe('admin tab canMatch guard', () => {
    function getAdminTabGuard() {
      const tabChild = adminChildren.find((r) => r.path === ':tab');
      return tabChild?.canMatch?.[0] as (
        route: unknown,
        segments: {path: string}[],
      ) => boolean;
    }

    it.each(['communities'])('allows valid tab "%s"', (tab) => {
      const guard = getAdminTabGuard();
      expect(guard({}, [{path: tab}])).toBe(true);
    });

    it.each(['nonexistent', 'settings', 'reminders', ''])(
      'rejects invalid tab "%s"',
      (tab) => {
        const guard = getAdminTabGuard();
        expect(guard({}, [{path: tab}])).toBe(false);
      },
    );

    it('rejects empty segments', () => {
      const guard = getAdminTabGuard();
      expect(guard({}, [])).toBe(false);
    });
  });

  describe('adminGuard', () => {
    function getAdminGuard() {
      return adminShellRoute?.canActivate?.[0];
    }

    it('shows an access denied toast and redirects non-root admins to home', async () => {
      const guard = getAdminGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set({_id: 'user-1'});
      mockAuthService.userRole.mockReturnValue('community_admin');

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {}} as never,
          {
            url: '/admin/communities',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/'});
      expect(mockToastService.error).toHaveBeenCalledWith('Access denied');
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
    });
  });

  describe('COMMUNITY_ADMIN_ROUTES', () => {
    it('provides community context at the shell route', () => {
      expect(communityAdminShellRoute?.providers).toContain(
        CommunityContextService,
      );
    });

    it('has a wildcard catch-all redirecting to /not-found', () => {
      const wildcardChild = communityAdminChildren.find((r) => r.path === '**');
      expect(wildcardChild).toBeDefined();
      expect(wildcardChild?.redirectTo).toBe('/not-found');
    });
  });

  describe('community-admin tab canMatch guard', () => {
    function getCommunityAdminTabGuard() {
      const tabChild = communityAdminChildren.find((r) => r.path === ':tab');
      return tabChild?.canMatch?.[0] as (
        route: unknown,
        segments: {path: string}[],
      ) => boolean;
    }

    it.each([
      'magic-links',
      'pending',
      'history',
      'members',
      'events',
      'audit-log',
      'settings',
      'shared-vetting',
    ])('allows valid tab "%s"', (tab) => {
      const guard = getCommunityAdminTabGuard();
      expect(guard({}, [{path: tab}])).toBe(true);
    });

    it.each(['nonexistent', 'communities', 'admin', ''])(
      'rejects invalid tab "%s"',
      (tab) => {
        const guard = getCommunityAdminTabGuard();
        expect(guard({}, [{path: tab}])).toBe(false);
      },
    );

    it('rejects empty segments', () => {
      const guard = getCommunityAdminTabGuard();
      expect(guard({}, [])).toBe(false);
    });
  });

  describe('communityAdminGuard', () => {
    function getCommunityAdminGuard() {
      return communityAdminShellRoute?.canActivate?.[0];
    }

    it('shows an access denied toast and redirects non-community admins to home', async () => {
      const guard = getCommunityAdminGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set({_id: 'user-1'});
      mockAuthService.userRole.mockReturnValue('user');

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {}} as never,
          {
            url: '/community-admin/events',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/'});
      expect(mockToastService.error).toHaveBeenCalledWith('Access denied');
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
    });
  });

  describe('authGuard', () => {
    function getAuthGuard() {
      const homeAuthRoute = layoutChildren.find(
        (r) => r.path === '' && r.canMatch,
      );
      return homeAuthRoute?.canActivate?.[0];
    }

    it('allows authenticated users once the user query resolves', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set(null);

      const resultPromise = TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {}} as never,
          {
            url: '/dashboard',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      queueMicrotask(() => {
        mockAuthService.user.set({_id: 'user-1'});
      });

      await expect(resultPromise).resolves.toBe(true);
    });

    it('keeps waiting while authenticated user sync is still in progress', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set(null);
      mockAuthService.isSyncingUser.set(true);

      let settled = false;
      const resultPromise = TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {}} as never,
          {
            url: '/dashboard',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      }).then((result) => {
        settled = true;
        return result;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      expect(mockRouter.createUrlTree).not.toHaveBeenCalled();

      mockAuthService.isSyncingUser.set(false);
      mockAuthService.user.set({_id: 'user-1'});

      await expect(resultPromise).resolves.toBe(true);
    });

    it('fails closed to the public home route when user sync fails mid-session', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set(null);
      mockAuthService.isSyncingUser.set(true);
      mockAuthService.authSyncFailed.set(true);

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {foo: 'bar'}} as never,
          {
            url: '/dashboard',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/'});
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
    });

    it('redirects authenticated users to public home when sync fails without a user', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set(null);
      mockAuthService.authSyncFailed.set(true);

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {foo: 'bar'}} as never,
          {
            url: '/dashboard',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/'});
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/']);
    });

    it('redirects unauthenticated users to login with returnUrl', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(false);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set(null);

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {foo: 'bar'}} as never,
          {
            url: '/tickets',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/login'});
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login'], {
        queryParams: {foo: 'bar', returnUrl: '/tickets'},
      });
    });

    it('redirects authenticated users with incomplete social signup to completion', async () => {
      const guard = getAuthGuard();
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.authInitialized.set(true);
      mockAuthService.user.set({
        _id: 'user-1',
        socialSignupCompletionRequired: true,
      });

      const result = await TestBed.runInInjectionContext(() => {
        const guardResult = (guard as CanActivateFn)?.(
          {queryParams: {}} as never,
          {
            url: '/dashboard',
          } as never,
        ) as Observable<unknown>;
        return firstValueFrom(guardResult);
      });

      expect(result).toEqual({path: '/confirm/social-signup-complete'});
      expect(mockRouter.createUrlTree).toHaveBeenCalledWith(
        ['/confirm/social-signup-complete'],
        {
          queryParams: {returnUrl: '/dashboard'},
        },
      );
    });
  });
});
