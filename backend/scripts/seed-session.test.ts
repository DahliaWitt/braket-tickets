// @vitest-environment node

import {describe, expect, it, vi} from 'vitest';

import {
  createSeedEnvSession,
  getConvexCloudDeploymentName,
  manualEnvRemoveCommand,
  type DevSeedEnvVar,
} from './seed-session';

describe('manualEnvRemoveCommand', () => {
  it('prints target-aware remote cleanup commands through Doppler', () => {
    expect(
      manualEnvRemoveCommand('DEV_SEED_TOKEN', {
        deployment: 'bright-swordfish-194',
        dopplerConfig: 'stg',
        dopplerProject: 'braket-tickets',
      }),
    ).toBe(
      'doppler run --project braket-tickets --config stg -- pnpm convex env remove DEV_SEED_TOKEN --deployment bright-swordfish-194',
    );
  });

  it('quotes remote cleanup command parts that are not shell-safe', () => {
    expect(
      manualEnvRemoveCommand('DEV_SEED', {
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
      target: {dopplerConfig: 'stg'},
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
      target: {dopplerConfig: 'stg', dopplerProject: 'braket-tickets'},
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
      target: {},
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
      target: {},
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

  it('rejects local and site URLs', () => {
    expect(getConvexCloudDeploymentName('http://127.0.0.1:3210')).toBeNull();
    expect(
      getConvexCloudDeploymentName('https://bright-swordfish-194.convex.site'),
    ).toBeNull();
  });
});
