import {describe, it, expect, afterEach, vi} from 'vitest';
import {
  isDevSeedEnvironment,
  isSeedAuthorized,
  isTestEnvironment,
  isUnitTestRuntime,
  looksLikeProductionFromContext,
  looksLikeProduction,
  looksLikeStagingFromContext,
  looksLikeStaging,
} from './environment';

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

describe('looksLikeStaging', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true for the known staging URL', () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';
    expect(looksLikeStaging()).toBe(true);
  });

  it('returns false for other .convex.cloud URLs', () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    expect(looksLikeStaging()).toBe(false);
  });

  it('does not match deployment names that merely contain the staging slug', () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194-copy.convex.cloud';
    expect(looksLikeStaging()).toBe(false);
  });

  it('returns false for localhost', () => {
    process.env['CONVEX_CLOUD_URL'] = 'http://localhost:3210';
    expect(looksLikeStaging()).toBe(false);
  });
});

describe('looksLikeProduction', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true for .convex.cloud URLs without dev or staging', () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    expect(looksLikeProduction()).toBe(true);
  });

  it('returns false for .convex.cloud URLs containing dev', () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-dev-abc123.convex.cloud';
    expect(looksLikeProduction()).toBe(false);
  });

  it('returns false for the known staging deployment', () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';
    expect(looksLikeProduction()).toBe(false);
  });

  it('returns true for cloud URLs that merely contain the staging slug', () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194-copy.convex.cloud';
    expect(looksLikeProduction()).toBe(true);
  });

  it('returns false for localhost URLs', () => {
    process.env['CONVEX_CLOUD_URL'] = 'http://localhost:3210';
    expect(looksLikeProduction()).toBe(false);
  });

  it('returns false when CONVEX_CLOUD_URL is unset', () => {
    delete process.env['CONVEX_CLOUD_URL'];
    expect(looksLikeProduction()).toBe(false);
  });

  it('returns false for empty CONVEX_CLOUD_URL', () => {
    process.env['CONVEX_CLOUD_URL'] = '';
    expect(looksLikeProduction()).toBe(false);
  });
});

function ctxWithDeploymentName(
  name: string | undefined,
): Parameters<typeof looksLikeStagingFromContext>[0] {
  return {
    meta: {
      getDeploymentMetadata: vi.fn(async () =>
        name === undefined
          ? undefined
          : {
              name,
              region: null,
              class: 's16' as const,
            },
      ),
    },
  } as unknown as Parameters<typeof looksLikeStagingFromContext>[0];
}

describe('looksLikeStagingFromContext', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true for the known staging deployment name', async () => {
    await expect(
      looksLikeStagingFromContext(
        ctxWithDeploymentName('bright-swordfish-194'),
      ),
    ).resolves.toBe(true);
  });

  it('returns false for non-staging deployment names', async () => {
    await expect(
      looksLikeStagingFromContext(ctxWithDeploymentName('ordinary-bison-123')),
    ).resolves.toBe(false);
  });

  it('falls back to URL-based staging detection when deployment name is unavailable', async () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';

    await expect(
      looksLikeStagingFromContext(ctxWithDeploymentName(undefined)),
    ).resolves.toBe(true);
  });

  it('falls back to false URL-based staging detection when deployment name is unavailable', async () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';

    await expect(
      looksLikeStagingFromContext(ctxWithDeploymentName(undefined)),
    ).resolves.toBe(false);
  });
});

describe('looksLikeProductionFromContext', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it.each([
    'local-braket-tickets',
    'anonymous-agent-123',
    'braket-dev-123',
    'bright-swordfish-194',
  ])('returns false for non-production deployment name %s', async (name) => {
    await expect(
      looksLikeProductionFromContext(ctxWithDeploymentName(name)),
    ).resolves.toBe(false);
  });

  it('returns true for production-like deployment names', async () => {
    await expect(
      looksLikeProductionFromContext(ctxWithDeploymentName('braket-abc123')),
    ).resolves.toBe(true);
  });

  it('falls back to URL-based production detection when deployment name is unavailable', async () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';

    await expect(
      looksLikeProductionFromContext(ctxWithDeploymentName(undefined)),
    ).resolves.toBe(true);
  });

  it('falls back to false URL-based production detection when deployment name is unavailable', async () => {
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';

    await expect(
      looksLikeProductionFromContext(ctxWithDeploymentName(undefined)),
    ).resolves.toBe(false);
  });
});

describe('isTestEnvironment', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true when IS_TEST=true and not production or staging', () => {
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'http://localhost:3210';
    expect(isTestEnvironment()).toBe(true);
  });

  it('returns true when IS_TEST=true and CONVEX_CLOUD_URL unset', () => {
    process.env['IS_TEST'] = 'true';
    delete process.env['CONVEX_CLOUD_URL'];
    expect(isTestEnvironment()).toBe(true);
  });

  it('returns false when IS_TEST is not set', () => {
    delete process.env['IS_TEST'];
    process.env['CONVEX_CLOUD_URL'] = 'http://localhost:3210';
    expect(isTestEnvironment()).toBe(false);
  });

  it('returns false when IS_TEST=false', () => {
    process.env['IS_TEST'] = 'false';
    expect(isTestEnvironment()).toBe(false);
  });

  it('returns false when IS_TEST=true but deployment looks like production', () => {
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    expect(isTestEnvironment()).toBe(false);
  });

  it('returns false when IS_TEST=true but deployment is staging', () => {
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';
    expect(isTestEnvironment()).toBe(false);
  });

  it('returns true when IS_TEST=true and deployment is dev cloud', () => {
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-dev-abc123.convex.cloud';
    expect(isTestEnvironment()).toBe(true);
  });

  it('logs error when IS_TEST=true but production detected', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';

    isTestEnvironment();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('IS_TEST=true on a production-like deployment'),
    );
    errorSpy.mockRestore();
  });

  it('logs error when IS_TEST=true on staging', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    process.env['IS_TEST'] = 'true';
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';

    isTestEnvironment();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('IS_TEST=true on a production-like deployment'),
    );
    errorSpy.mockRestore();
  });
});

describe('isDevSeedEnvironment', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true when DEV_SEED=true on localhost', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'http://localhost:3210';
    expect(isDevSeedEnvironment()).toBe(true);
  });

  it('returns true when DEV_SEED=true on staging', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';
    expect(isDevSeedEnvironment()).toBe(true);
  });

  it('returns false when DEV_SEED=true on unallowlisted dev cloud', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-dev-abc123.convex.cloud';
    expect(isDevSeedEnvironment()).toBe(false);
  });

  it('returns false when DEV_SEED is not set', () => {
    delete process.env['DEV_SEED'];
    expect(isDevSeedEnvironment()).toBe(false);
  });

  it('returns false when DEV_SEED=true but deployment looks like production', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    expect(isDevSeedEnvironment()).toBe(false);
  });

  it('returns false when production cloud URL is paired with localhost app URLs', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    process.env['SITE_URL'] = 'http://localhost:4200';
    process.env['AUTH_BASE_URL'] = 'http://127.0.0.1:4200';
    expect(isDevSeedEnvironment()).toBe(false);
  });

  it('returns false when the cloud URL only contains the staging slug', () => {
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194-copy.convex.cloud';
    expect(isDevSeedEnvironment()).toBe(false);
  });

  it('returns true when cloud identity is missing but local backend URLs are present', () => {
    process.env['DEV_SEED'] = 'true';
    delete process.env['CONVEX_CLOUD_URL'];
    process.env['CONVEX_SITE_URL'] = 'http://127.0.0.1:3211';
    expect(isDevSeedEnvironment()).toBe(true);
  });

  it('logs error when DEV_SEED=true on production', () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    process.env['DEV_SEED'] = 'true';
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';

    isDevSeedEnvironment();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'DEV_SEED=true on a deployment that is not explicitly seed-enabled',
      ),
    );
    errorSpy.mockRestore();
  });
});

describe('isUnitTestRuntime', () => {
  const originalEnv = {...process.env};

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('returns true when running under Vitest', () => {
    process.env['VITEST'] = 'true';
    expect(isUnitTestRuntime()).toBe(true);
  });

  it('does not trust NODE_ENV=test without Vitest', () => {
    process.env['VITEST'] = 'false';
    process.env['NODE_ENV'] = 'test';
    expect(isUnitTestRuntime()).toBe(false);
  });
});

describe('isSeedAuthorized', () => {
  const originalEnv = {...process.env};
  const now = 1_800_000_000_000;
  const token = 'seed-token-0123456789abcdef0123456789abcdef';

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  function setValidSeedEnv(): void {
    process.env['DEV_SEED'] = 'true';
    process.env['DEV_SEED_TOKEN'] = token;
    process.env['DEV_SEED_EXPIRES_AT'] = String(now + 60_000);
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194.convex.cloud';
  }

  it('accepts a valid staging seed token before expiry', () => {
    setValidSeedEnv();
    expect(isSeedAuthorized(token, now)).toBe(true);
  });

  it('accepts a valid local seed token before expiry', () => {
    setValidSeedEnv();
    process.env['CONVEX_CLOUD_URL'] = 'http://127.0.0.1:3210';
    expect(isSeedAuthorized(token, now)).toBe(true);
  });

  it('rejects a missing caller token', () => {
    setValidSeedEnv();
    expect(isSeedAuthorized('', now)).toBe(false);
  });

  it('rejects a wrong caller token', () => {
    setValidSeedEnv();
    expect(
      isSeedAuthorized('wrong-token-0123456789abcdef0123456789abcdef', now),
    ).toBe(false);
  });

  it('rejects an expired token', () => {
    setValidSeedEnv();
    process.env['DEV_SEED_EXPIRES_AT'] = String(now - 1);
    expect(isSeedAuthorized(token, now)).toBe(false);
  });

  it('rejects production-like deployments', () => {
    setValidSeedEnv();
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-abc123.convex.cloud';
    process.env['SITE_URL'] = 'http://localhost:4200';
    expect(isSeedAuthorized(token, now)).toBe(false);
  });

  it('rejects deployment names that merely contain the staging slug', () => {
    setValidSeedEnv();
    process.env['CONVEX_CLOUD_URL'] =
      'https://bright-swordfish-194-copy.convex.cloud';
    expect(isSeedAuthorized(token, now)).toBe(false);
  });

  it('rejects unknown cloud deployments', () => {
    setValidSeedEnv();
    process.env['CONVEX_CLOUD_URL'] = 'https://braket-dev-abc123.convex.cloud';
    expect(isSeedAuthorized(token, now)).toBe(false);
  });

  it('rejects missing deployment identity unless local URLs are present', () => {
    setValidSeedEnv();
    delete process.env['CONVEX_CLOUD_URL'];
    delete process.env['CONVEX_SITE_URL'];
    delete process.env['SITE_URL'];
    delete process.env['AUTH_BASE_URL'];
    delete process.env['E2E_CONVEX_SITE_URL'];
    expect(isSeedAuthorized(token, now)).toBe(false);
  });
});
