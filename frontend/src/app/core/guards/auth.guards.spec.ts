import {describe, expect, it, beforeEach} from 'vitest';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type CanMatchFn,
  type Route,
  type RouterStateSnapshot,
  type UrlSegment,
} from '@angular/router';
import {isObservable} from 'rxjs';
import {authGuard, authenticatedMatch} from './auth.guards';
import {AuthService} from '@/core/services/auth.service';
import type {CachedSessionPeek} from '../../../lib/auth-storage';

interface AuthStub {
  peek: CachedSessionPeek;
}

function createAuthStub(peek: CachedSessionPeek) {
  return {
    peekCachedSession: () => peek,
    // Signals/accessors used only by the async settle fall-through path.
    authInitialized: signal(false),
    user: signal(undefined),
    authSyncFailed: signal(false),
    isAuthenticated: () => false,
  } as unknown as AuthService & AuthStub;
}

const LOGGED_OUT: CachedSessionPeek = {
  known: true,
  hasCredential: false,
  session: null,
};
const HAS_SESSION: CachedSessionPeek = {
  known: true,
  hasCredential: true,
  session: {user: {email: 'buyer@example.com'}},
};
const UNKNOWN: CachedSessionPeek = {
  known: false,
  hasCredential: false,
  session: null,
};

function configure(peek: CachedSessionPeek) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {provide: AuthService, useValue: createAuthStub(peek)},
    ],
  });
}

// CanMatchFn takes (route, segments, currentSnapshot); the guard reads none of
// them, so empty stubs suffice. Typed via Parameters to stay lockstep with the
// Angular signature.
const matchArgs: Parameters<CanMatchFn> = [
  {} as Route,
  [] as UrlSegment[],
  {} as Parameters<CanMatchFn>[2],
];
const activateArgs: [ActivatedRouteSnapshot, RouterStateSnapshot] = [
  {queryParams: {}} as unknown as ActivatedRouteSnapshot,
  {url: '/tickets'} as RouterStateSnapshot,
];

describe('authenticatedMatch', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('resolves false synchronously when provably logged out', () => {
    configure(LOGGED_OUT);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(result).toBe(false);
  });

  it('defers to the async settle when a cached session is present', () => {
    configure(HAS_SESSION);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(isObservable(result)).toBe(true);
  });

  it('defers to the async settle when state is not synchronously known', () => {
    configure(UNKNOWN);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(isObservable(result)).toBe(true);
  });
});

describe('authGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('redirects to login synchronously when provably logged out', () => {
    configure(LOGGED_OUT);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(result).toBeInstanceOf(UrlTree);
    const router = TestBed.inject(Router);
    const url = router.serializeUrl(result as UrlTree);
    expect(url).toContain('/login');
    expect(url).toContain('returnUrl');
  });

  it('defers to the async settle when a cached session is present', () => {
    configure(HAS_SESSION);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(isObservable(result)).toBe(true);
  });

  it('defers to the async settle when state is not synchronously known', () => {
    configure(UNKNOWN);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(isObservable(result)).toBe(true);
  });
});
