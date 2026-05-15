// @vitest-environment node

import {createPrivateKey, createSign, createVerify} from 'crypto';

import {describe, expect, it} from 'vitest';

import {buildEnv, DEFAULT_CONVEX_LOCAL_BACKEND_RELEASE} from './shared';

describe('local Convex backend release', () => {
  it('pins the E2E backend binary instead of following latest', () => {
    expect(DEFAULT_CONVEX_LOCAL_BACKEND_RELEASE).toBe(
      'precompiled-2026-05-12-cadb2c2',
    );
  });
});

describe('buildEnv', () => {
  it('generates stable paired E2E JWT key material for the current process', () => {
    const ports = {convex: 3210, convexSite: 3211, app: 4201};

    const first = buildEnv('e2e', ports);
    const second = buildEnv('e2e', ports);

    expect(first.JWT_PRIVATE_KEY).toBe(second.JWT_PRIVATE_KEY);
    expect(first.JWKS).toBe(second.JWKS);
    expect(first.TOKEN_DIGEST_SECRET).toBe(
      'test-token-digest-secret-for-local-e2e-only-not-secure',
    );
    expect(createPrivateKey(first.JWT_PRIVATE_KEY).asymmetricKeyType).toBe(
      'rsa',
    );

    const jwks = JSON.parse(first.JWKS) as {
      keys: [{kty: 'RSA'; n: string; e: string}];
    };
    const publicKey = {
      kty: jwks.keys[0].kty,
      n: jwks.keys[0].n,
      e: jwks.keys[0].e,
    };

    const signer = createSign('RSA-SHA256');
    signer.update('e2e-jwt-key-material');
    signer.end();
    const signature = signer.sign(first.JWT_PRIVATE_KEY);

    const verifier = createVerify('RSA-SHA256');
    verifier.update('e2e-jwt-key-material');
    verifier.end();

    expect(verifier.verify({key: publicKey, format: 'jwk'}, signature)).toBe(
      true,
    );
  });
});
