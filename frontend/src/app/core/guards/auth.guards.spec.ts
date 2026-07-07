import {describe, expect, it, beforeEach, vi} from 'vitest';
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

function createAuthStub(peek: CachedSessionPeek, settled = false) {
  const scheduleOptimisticReconciliation = vi.fn();
  const stub = {
    peekCachedSession: () => peek,
    scheduleOptimisticReconciliation,
    // Settle state consumed by the fast-path gate and by waitForAuthSettled$.
    authSettled: signal(settled),
    user: signal(undefined),
    isAuthenticated: () => false,
  } as unknown as AuthService;
  return {stub, scheduleOptimisticReconciliation};
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

function configure(peek: CachedSessionPeek, settled = false) {
  const {stub, scheduleOptimisticReconciliation} = createAuthStub(
    peek,
    settled,
  );
  TestBed.configureTestingModule({
    providers: [provideRouter([]), {provide: AuthService, useValue: stub}],
  });
  return {scheduleOptimisticReconciliation};
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

  it('optimistically matches and schedules reconciliation when a credential is present', () => {
    const {scheduleOptimisticReconciliation} = configure(HAS_SESSION);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(result).toBe(true);
    expect(scheduleOptimisticReconciliation).toHaveBeenCalledTimes(1);
  });

  it('defers to the async settle when state is not synchronously known', () => {
    const {scheduleOptimisticReconciliation} = configure(UNKNOWN);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(isObservable(result)).toBe(true);
    expect(scheduleOptimisticReconciliation).not.toHaveBeenCalled();
  });

  it('ignores the peek once auth has settled — live state is authoritative', () => {
    const {scheduleOptimisticReconciliation} = configure(HAS_SESSION, true);
    const result = TestBed.runInInjectionContext(() =>
      authenticatedMatch(...matchArgs),
    );
    expect(isObservable(result)).toBe(true);
    expect(scheduleOptimisticReconciliation).not.toHaveBeenCalled();
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

  it('optimistically allows and schedules reconciliation when a credential is present', () => {
    const {scheduleOptimisticReconciliation} = configure(HAS_SESSION);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(result).toBe(true);
    expect(scheduleOptimisticReconciliation).toHaveBeenCalledTimes(1);
  });

  it('defers to the async settle when state is not synchronously known', () => {
    const {scheduleOptimisticReconciliation} = configure(UNKNOWN);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(isObservable(result)).toBe(true);
    expect(scheduleOptimisticReconciliation).not.toHaveBeenCalled();
  });

  it('ignores the peek once auth has settled — live state is authoritative', () => {
    const {scheduleOptimisticReconciliation} = configure(LOGGED_OUT, true);
    const result = TestBed.runInInjectionContext(() =>
      authGuard(...activateArgs),
    );
    expect(isObservable(result)).toBe(true);
    expect(scheduleOptimisticReconciliation).not.toHaveBeenCalled();
  });
});
