import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthConvexTokenStorageService } from './auth-convex-token-storage.service';

function jwtWithPayload(payload: Record<string, unknown>): string {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encodedPayload}.signature`;
}

describe('AuthConvexTokenStorageService', () => {
  let service: AuthConvexTokenStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), AuthConvexTokenStorageService],
    });
    service = TestBed.inject(AuthConvexTokenStorageService);
  });

  it('clears all Convex auth token storage keys', () => {
    localStorage.setItem('__convexAuthJWT', 'jwt');
    localStorage.setItem('__convexAuthRefreshToken', 'refresh');
    localStorage.setItem('__convexAuthOAuthVerifier', 'verifier');

    service.clear();

    expect(localStorage.getItem('__convexAuthJWT')).toBeNull();
    expect(localStorage.getItem('__convexAuthRefreshToken')).toBeNull();
    expect(localStorage.getItem('__convexAuthOAuthVerifier')).toBeNull();
  });

  it('purges expired Convex auth tokens', () => {
    localStorage.setItem(
      '__convexAuthJWT',
      jwtWithPayload({
        iss: 'https://example.convex.cloud',
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    );
    localStorage.setItem('__convexAuthRefreshToken', 'refresh');

    service.purgeStaleSession();

    expect(localStorage.getItem('__convexAuthJWT')).toBeNull();
    expect(localStorage.getItem('__convexAuthRefreshToken')).toBeNull();
  });
});
