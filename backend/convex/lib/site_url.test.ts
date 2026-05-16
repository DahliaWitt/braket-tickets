import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

describe('resolveSiteUrl', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
    vi.resetModules();
    vi.doUnmock('./environment');
  });

  it('returns process.env.SITE_URL when set', async () => {
    process.env.SITE_URL = 'https://dev.braket.gay';
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('https://dev.braket.gay');
  });

  it('strips a single trailing slash', async () => {
    process.env.SITE_URL = 'https://braket.gay/';
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('https://braket.gay');
  });

  it('leaves a URL without a trailing slash untouched', async () => {
    process.env.SITE_URL = 'https://braket.gay';
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('https://braket.gay');
  });

  it('falls back to localhost when unset under vitest (isUnitTestRuntime)', async () => {
    delete process.env.SITE_URL;
    // Vitest sets VITEST=true, so isUnitTestRuntime() returns true by default.
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('http://localhost:4200');
  });

  it('falls back to localhost when unset under IS_TEST runtime', async () => {
    delete process.env.SITE_URL;
    vi.resetModules();
    vi.doMock('./environment', () => ({
      isUnitTestRuntime: () => false,
      isTestEnvironment: () => true,
    }));
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('http://localhost:4200');
  });

  it('throws when SITE_URL is unset outside any test environment', async () => {
    delete process.env.SITE_URL;
    vi.resetModules();
    vi.doMock('./environment', () => ({
      isUnitTestRuntime: () => false,
      isTestEnvironment: () => false,
    }));
    const {resolveSiteUrl} = await import('./site_url');
    expect(() => resolveSiteUrl()).toThrow(/SITE_URL is not set/);
  });
});

describe('resolveSiteUrl module-level behavior', () => {
  // Ensure resetModules restores the default module state for any downstream
  // tests that import resolveSiteUrl directly.
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('./environment');
  });

  it('re-imports cleanly after mocked runs', async () => {
    process.env.SITE_URL = 'https://example.test';
    const {resolveSiteUrl} = await import('./site_url');
    expect(resolveSiteUrl()).toBe('https://example.test');
  });
});
