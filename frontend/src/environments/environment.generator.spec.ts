import {describe, expect, it} from 'vitest';

import {
  createAngularDefineArgs,
  createFrontendRuntimeConfig,
} from '../../scripts/runtime-config';

describe('runtime-config', () => {
  it('does not embed unrelated secrets into the public runtime config', () => {
    const environment = createFrontendRuntimeConfig('development', {
      CONVEX_URL: 'http://127.0.0.1:3210',
      CONVEX_SITE_URL: 'http://127.0.0.1:3211',
      PROD_CONVEX_URL: 'https://prod.convex.example',
      DEV_PASSWORD: 'super-secret-password',
      GITHUB_SHA: '1234567890abcdef',
      GITHUB_REF_NAME: 'test-branch',
    });

    const serializedEnvironment = JSON.stringify(environment);

    expect(serializedEnvironment).not.toContain('super-secret-password');
    expect(serializedEnvironment).not.toContain('DEV_PASSWORD');
  });

  it('creates an e2e config from the harness-provided Convex URLs', () => {
    const environment = createFrontendRuntimeConfig('e2e', {
      CONVEX_URL: 'http://127.0.0.1:4310',
      CONVEX_SITE_URL: 'http://127.0.0.1:4311',
      GITHUB_SHA: '1234567890abcdef',
      GITHUB_REF_NAME: 'test-branch',
    });

    expect(environment.production).toBe(false);
    expect(environment.isE2E).toBe(true);
    expect(environment.convexUrl).toBe('http://127.0.0.1:4310');
    expect(environment.convexSiteUrl).toBe('http://127.0.0.1:4311');
    expect(environment.stripe.mockPayments).toBe(true);
  });

  it('serializes the runtime config into Angular define arguments', () => {
    const defineArgs = createAngularDefineArgs('preview', {
      CONVEX_URL: 'http://127.0.0.1:3210',
      GITHUB_SHA: '1234567890abcdef',
      GITHUB_REF_NAME: 'preview-branch',
    });

    expect(defineArgs[0]).toBe('--define');
    expect(defineArgs[1]).toContain('__BRAKET_RUNTIME__=');
    expect(defineArgs[1]).toContain('"sentryEnvironment":"preview"');
  });
});
