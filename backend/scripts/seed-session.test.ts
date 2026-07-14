// @vitest-environment node

import {describe, expect, expectTypeOf, it, vi} from 'vitest';

import {
  convexEnvTargetArgs,
  createSeedEnvSession,
  getConvexCloudDeploymentName,
  manualEnvRemoveCommand,
  resolveSeedEnvTarget,
  type DevSeedEnvVar,
  type SeedCleanupTarget,
} from './seed-session';

describe('convexEnvTargetArgs', () => {
  it('lets the deployment-scoped deploy key select remote targets', () => {
    expect(
      convexEnvTargetArgs({
        kind: 'remote',
        deployment: 'bright-swordfish-194',
      }),
    ).toEqual([]);
  });

  it('keeps explicit credentials for local targets', () => {
    expect(
      convexEnvTargetArgs({
        kind: 'local',
        adminKey: 'local-admin-key',
        url: 'http://127.0.0.1:3210',
      }),
    ).toEqual([
      '--admin-key',
      'local-admin-key',
      '--url',
      'http://127.0.0.1:3210',
    ]);
  });
});

describe('resolveSeedEnvTarget', () => {
  const stagingUrl = 'https://bright-swordfish-194.convex.cloud';
  const allowedRemoteDeployments = ['bright-swordfish-194'] as const;

  it('accepts a matching current dev deployment key', () => {
    expect(
      resolveSeedEnvTarget({
        convexUrl: stagingUrl,
        isLocal: false,
        deployKey: 'dev:bright-swordfish-194|not-a-real-token',
        allowedRemoteDeployments,
      }),
    ).toEqual({kind: 'remote', deployment: 'bright-swordfish-194'});
  });

  it('rejects a deployment key for a different deployment without exposing its token', () => {
    const secretToken = 'do-not-print-this-token';
    let message = '';

    try {
      resolveSeedEnvTarget({
        convexUrl: stagingUrl,
        isLocal: false,
        deployKey: `dev:wrong-deployment-123|${secretToken}`,
        allowedRemoteDeployments,
      });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('does not match target URL deployment');
    expect(message).not.toContain(secretToken);
  });

  it('rejects production and preview deployment keys', () => {
    for (const deployKey of [
      'prod:modest-impala|not-a-real-token',
      'preview:bright-swordfish-194|not-a-real-token',
    ]) {
      expect(() =>
        resolveSeedEnvTarget({
          convexUrl: stagingUrl,
          isLocal: false,
          deployKey,
          allowedRemoteDeployments,
        }),
      ).toThrow('require a dev deployment-scoped CONVEX_DEPLOY_KEY');
    }
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-deploy-key'],
    ['project-scoped', 'project:identifier|not-a-real-token'],
    ['legacy deployment', 'bright-swordfish-194|not-a-real-token'],
  ])('rejects %s keys fail-closed', (_label, deployKey) => {
    expect(() =>
      resolveSeedEnvTarget({
        convexUrl: stagingUrl,
        isLocal: false,
        deployKey,
        allowedRemoteDeployments,
      }),
    ).toThrow('current deployment-scoped CONVEX_DEPLOY_KEY');
  });

  it('rejects a matching key when the URL deployment is not allowlisted', () => {
    expect(() =>
      resolveSeedEnvTarget({
        convexUrl: 'https://another-dev-123.convex.cloud',
        isLocal: false,
        deployKey: 'dev:another-dev-123|not-a-real-token',
        allowedRemoteDeployments,
      }),
    ).toThrow('non-allowlisted remote deployment');
  });

  it('rejects plaintext HTTP Convex cloud URLs before accepting the key', () => {
    expect(() =>
      resolveSeedEnvTarget({
        convexUrl: 'http://bright-swordfish-194.convex.cloud',
        isLocal: false,
        deployKey: 'dev:bright-swordfish-194|not-a-real-token',
        allowedRemoteDeployments,
      }),
    ).toThrow('not a recognized Convex cloud deployment');
  });

  it('preserves the explicit local URL and admin-key path without a deploy key', () => {
    expect(
      resolveSeedEnvTarget({
        convexUrl: 'http://127.0.0.1:3210',
        isLocal: true,
        adminKey: 'local-admin-key',
        allowedRemoteDeployments,
      }),
    ).toEqual({
      kind: 'local',
      url: 'http://127.0.0.1:3210',
      adminKey: 'local-admin-key',
    });
  });
});

describe('manualEnvRemoveCommand', () => {
  it('allows Doppler configuration only on remote cleanup targets', () => {
    expectTypeOf<{
      kind: 'remote';
      deployment: string;
      dopplerConfig: string;
    }>().toMatchTypeOf<SeedCleanupTarget>();
    expectTypeOf<{
      kind: 'local';
      url: string;
      adminKey: string;
      dopplerConfig: string;
    }>().not.toMatchTypeOf<SeedCleanupTarget>();
  });

  it('prints target-aware remote cleanup commands through Doppler', () => {
    expect(
      manualEnvRemoveCommand('DEV_SEED_TOKEN', {
        kind: 'remote',
        deployment: 'bright-swordfish-194',
        dopplerConfig: 'stg',
        dopplerProject: 'braket-tickets',
      }),
    ).toBe(
      'doppler run --project braket-tickets --config stg -- pnpm convex env remove DEV_SEED_TOKEN',
    );
  });

  it('quotes remote cleanup command parts that are not shell-safe', () => {
    expect(
      manualEnvRemoveCommand('DEV_SEED', {
        kind: 'remote',
        deployment: 'bright-swordfish-194',
        dopplerConfig: "stage's copy",
        dopplerProject: 'braket tickets',
      }),
    ).toBe(
      "doppler run --project 'braket tickets' --config 'stage'\\''s copy' -- pnpm convex env remove DEV_SEED",
    );
  });

  it('prints local cleanup commands with explicit URL and admin-key placeholder', () => {
    expect(
      manualEnvRemoveCommand('DEV_SEED_EXPIRES_AT', {
        kind: 'local',
        url: 'http://127.0.0.1:3210',
        adminKey: 'redacted',
      }),
    ).toBe(
      "pnpm convex env remove DEV_SEED_EXPIRES_AT --admin-key '<local-admin-key>' --url http://127.0.0.1:3210",
    );
  });
});

describe('createSeedEnvSession', () => {
  it('cleans up only env vars that were successfully set before setup failed', () => {
    const setEnv = vi.fn((name: DevSeedEnvVar) => {
      if (name === 'DEV_SEED_EXPIRES_AT') {
        throw new Error('set failed');
      }
    });
    const removeEnv = vi.fn<() => boolean>().mockReturnValue(true);
    const session = createSeedEnvSession({
      target: {
        kind: 'remote',
        deployment: 'bright-swordfish-194',
        dopplerConfig: 'stg',
      },
      setEnv,
      removeEnv,
    });

    session.set('DEV_SEED', 'true');
    session.set('DEV_SEED_TOKEN', 'token');
    expect(() => session.set('DEV_SEED_EXPIRES_AT', '123')).toThrow(
      'set failed',
    );

    expect(session.cleanup()).toEqual({
      ok: true,
      attempted: ['DEV_SEED', 'DEV_SEED_TOKEN'],
      failed: [],
      cleanupCommands: [],
    });
    expect(removeEnv).toHaveBeenCalledTimes(2);
    expect(removeEnv).toHaveBeenNthCalledWith(1, 'DEV_SEED');
    expect(removeEnv).toHaveBeenNthCalledWith(2, 'DEV_SEED_TOKEN');
  });

  it('attempts all cleanup removals and reports target-aware manual commands', () => {
    const removeEnv = vi.fn((name: DevSeedEnvVar) => name === 'DEV_SEED_TOKEN');
    const session = createSeedEnvSession({
      target: {
        kind: 'remote',
        deployment: 'bright-swordfish-194',
        dopplerConfig: 'stg',
        dopplerProject: 'braket-tickets',
      },
      setEnv: vi.fn(),
      removeEnv,
    });

    session.set('DEV_SEED', 'true');
    session.set('DEV_SEED_TOKEN', 'token');
    session.set('DEV_SEED_EXPIRES_AT', '123');

    expect(session.cleanup()).toEqual({
      ok: false,
      attempted: ['DEV_SEED', 'DEV_SEED_TOKEN', 'DEV_SEED_EXPIRES_AT'],
      failed: ['DEV_SEED', 'DEV_SEED_EXPIRES_AT'],
      cleanupCommands: [
        'doppler run --project braket-tickets --config stg -- pnpm convex env remove DEV_SEED',
        'doppler run --project braket-tickets --config stg -- pnpm convex env remove DEV_SEED_EXPIRES_AT',
      ],
    });
    expect(removeEnv).toHaveBeenCalledTimes(3);
  });

  it('keeps attempting cleanup after a remove callback throws', () => {
    const removeEnv = vi.fn((name: DevSeedEnvVar) => {
      if (name === 'DEV_SEED') {
        throw new Error('remove failed');
      }
      return true;
    });
    const session = createSeedEnvSession({
      target: {kind: 'remote', deployment: 'bright-swordfish-194'},
      setEnv: vi.fn(),
      removeEnv,
    });

    session.set('DEV_SEED', 'true');
    session.set('DEV_SEED_TOKEN', 'token');

    expect(session.cleanup()).toEqual({
      ok: false,
      attempted: ['DEV_SEED', 'DEV_SEED_TOKEN'],
      failed: ['DEV_SEED'],
      cleanupCommands: ['pnpm convex env remove DEV_SEED'],
    });
    expect(removeEnv).toHaveBeenCalledTimes(2);
  });

  it('is idempotent after cleanup', () => {
    const removeEnv = vi.fn<() => boolean>().mockReturnValue(true);
    const session = createSeedEnvSession({
      target: {kind: 'remote', deployment: 'bright-swordfish-194'},
      setEnv: vi.fn(),
      removeEnv,
    });

    session.set('DEV_SEED', 'true');

    expect(session.cleanup().ok).toBe(true);
    expect(session.cleanup()).toEqual({
      ok: true,
      attempted: [],
      failed: [],
      cleanupCommands: [],
    });
    expect(removeEnv).toHaveBeenCalledTimes(1);
  });
});

describe('getConvexCloudDeploymentName', () => {
  it('extracts deployment names from Convex cloud RPC URLs', () => {
    expect(
      getConvexCloudDeploymentName('https://bright-swordfish-194.convex.cloud'),
    ).toBe('bright-swordfish-194');
  });

  it('rejects local, plaintext, credentialed, and non-RPC URLs', () => {
    expect(getConvexCloudDeploymentName('http://127.0.0.1:3210')).toBeNull();
    expect(
      getConvexCloudDeploymentName('http://bright-swordfish-194.convex.cloud'),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName(
        'https://user:password@bright-swordfish-194.convex.cloud',
      ),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName(
        'https://bright-swordfish-194.convex.cloud:8443',
      ),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName(
        'https://bright-swordfish-194.convex.cloud/unexpected',
      ),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName(
        'https://bright-swordfish-194.convex.cloud?token=unexpected',
      ),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName(
        'https://bright-swordfish-194.convex.cloud#unexpected',
      ),
    ).toBeNull();
    expect(
      getConvexCloudDeploymentName('https://bright-swordfish-194.convex.site'),
    ).toBeNull();
  });
});
