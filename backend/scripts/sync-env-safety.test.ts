// @vitest-environment node

import {describe, expect, it} from 'vitest';

import {
  describeProductionSource,
  describeProductionTarget,
  parseSyncEnvArgs,
  validateProductionSyncEnvironment,
} from './sync-env-safety';

const prodEnv = {
  CONVEX_DEPLOY_KEY: 'prod-deploy-key',
  SITE_URL: 'https://example.com',
};

describe('parseSyncEnvArgs', () => {
  it('treats help as non-mutating even when appended to the prod script', () => {
    expect(
      parseSyncEnvArgs(['--prod', '--confirm', '--', '--help']),
    ).toMatchObject({
      errors: [],
      shouldPrintHelp: true,
    });
  });

  it('rejects unsupported arguments before any sync can run', () => {
    expect(
      parseSyncEnvArgs(['--prod', '--confirm', '--deployment', 'prod']),
    ).toMatchObject({
      errors: ['Unsupported argument(s): --deployment, prod'],
      shouldPrintHelp: false,
    });
  });
});

describe('validateProductionSyncEnvironment', () => {
  it('allows GitHub Actions production environment secrets', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        BRAKET_DEPLOY_ENV: 'production',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      }),
    ).toEqual([]);
  });

  it('rejects GitHub Actions without the production deployment sentinel', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      }),
    ).toEqual([
      'GitHub Actions production sync requires BRAKET_DEPLOY_ENV=production.',
      'Production sync must run from GitHub Actions production deployment or from a local Doppler prd environment.',
    ]);
  });

  it('allows a local operator using Doppler prd', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        DOPPLER_CONFIG: 'prd',
        DOPPLER_INJECTED: '1',
      }),
    ).toEqual([]);
  });

  it('requires local production sync to be inside the Doppler-injected prd env', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        DOPPLER_CONFIG: 'prd',
      }),
    ).toContain(
      'Production sync must run from GitHub Actions production deployment or from a local Doppler prd environment.',
    );
  });

  it('rejects local or staging Doppler configs', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        DOPPLER_CONFIG: 'local',
        DOPPLER_INJECTED: '1',
      }),
    ).toEqual([
      'DOPPLER_CONFIG must be prd for production sync; received local.',
      'Production sync must run from GitHub Actions production deployment or from a local Doppler prd environment.',
    ]);
  });

  it('requires CONVEX_DEPLOY_KEY for production targeting', () => {
    expect(
      validateProductionSyncEnvironment({
        BRAKET_DEPLOY_ENV: 'production',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        SITE_URL: 'https://example.com',
      }),
    ).toContain(
      'CONVEX_DEPLOY_KEY is required so the Convex CLI targets the approved production deployment.',
    );
  });

  it('rejects local production URLs', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        BRAKET_DEPLOY_ENV: 'production',
        CI: 'true',
        CONVEX_SITE_URL: 'http://127.0.0.1:3211',
        GITHUB_ACTIONS: 'true',
      }),
    ).toContain(
      'CONVEX_SITE_URL must not point at a local URL for production sync.',
    );
  });

  it('rejects localhost CORS in production sync', () => {
    expect(
      validateProductionSyncEnvironment({
        ...prodEnv,
        ALLOW_LOCALHOST_CORS: 'true',
        BRAKET_DEPLOY_ENV: 'production',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      }),
    ).toContain(
      'ALLOW_LOCALHOST_CORS must be unset or false for production sync.',
    );
  });
});

describe('production sync descriptions', () => {
  it('describes GitHub Actions as the source', () => {
    expect(
      describeProductionSource({
        BRAKET_DEPLOY_ENV: 'production',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      }),
    ).toBe('GitHub Actions production environment');
  });

  it('does not describe generic GitHub Actions as a production source', () => {
    expect(describeProductionSource({CI: 'true', GITHUB_ACTIONS: 'true'})).toBe(
      'unverified environment',
    );
  });

  it('describes the production deploy-key target without printing the key', () => {
    expect(describeProductionTarget(prodEnv)).toBe(
      'production deployment selected by CONVEX_DEPLOY_KEY',
    );
  });
});
