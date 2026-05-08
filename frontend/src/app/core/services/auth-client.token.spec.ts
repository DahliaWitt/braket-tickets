import {inject} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {AUTH_CLIENT} from './auth-client.token';

describe('AUTH_CLIENT', () => {
  it('provides a safe shared test double by default', async () => {
    TestBed.configureTestingModule({});

    const authClient = TestBed.runInInjectionContext(() => inject(AUTH_CLIENT));

    expect(vi.isMockFunction(authClient.getSession)).toBe(true);
    await expect(authClient.getSession()).resolves.toEqual({
      data: null,
      error: null,
    });
  });
});
