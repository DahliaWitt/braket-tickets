export const DEV_SEED_ENV_VARS = [
  'DEV_SEED',
  'DEV_SEED_TOKEN',
  'DEV_SEED_EXPIRES_AT',
] as const;

export type DevSeedEnvVar = (typeof DEV_SEED_ENV_VARS)[number];

export type SeedCleanupTarget = {
  url?: string;
  adminKey?: string;
  deployment?: string;
  dopplerConfig?: string;
  dopplerProject?: string;
};

type SeedEnvSessionOptions = {
  target: SeedCleanupTarget;
  setEnv: (name: DevSeedEnvVar, value: string) => void;
  removeEnv: (name: DevSeedEnvVar) => boolean;
};

type CleanupResult = {
  ok: boolean;
  attempted: DevSeedEnvVar[];
  failed: DevSeedEnvVar[];
  cleanupCommands: string[];
};

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function manualEnvRemoveCommand(
  name: DevSeedEnvVar,
  target: SeedCleanupTarget,
): string {
  const deploymentArgs = target.deployment
    ? ['--deployment', target.deployment]
    : [];

  if (target.dopplerConfig) {
    return [
      'doppler',
      'run',
      '--project',
      target.dopplerProject ?? 'braket-tickets',
      '--config',
      target.dopplerConfig,
      '--',
      'pnpm',
      'convex',
      'env',
      'remove',
      name,
      ...deploymentArgs,
    ]
      .map(shellQuote)
      .join(' ');
  }

  return [
    'pnpm',
    'convex',
    'env',
    'remove',
    name,
    ...(target.adminKey ? ['--admin-key', '<local-admin-key>'] : []),
    ...(target.url ? ['--url', target.url] : []),
    ...deploymentArgs,
  ]
    .map(shellQuote)
    .join(' ');
}

export function getConvexCloudDeploymentName(convexUrl: string): string | null {
  try {
    const hostname = new URL(convexUrl).hostname;
    const match = /^([a-z0-9-]+)\.convex\.cloud$/u.exec(hostname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createSeedEnvSession({
  target,
  setEnv,
  removeEnv,
}: SeedEnvSessionOptions): {
  set: (name: DevSeedEnvVar, value: string) => void;
  cleanup: () => CleanupResult;
} {
  const enabled: DevSeedEnvVar[] = [];
  let cleaned = false;

  return {
    set(name, value) {
      if (cleaned) {
        throw new Error('Cannot set seed env vars after cleanup');
      }
      setEnv(name, value);
      enabled.push(name);
    },
    cleanup() {
      if (cleaned || enabled.length === 0) {
        cleaned = true;
        return {ok: true, attempted: [], failed: [], cleanupCommands: []};
      }
      cleaned = true;

      const attempted = [...enabled];
      const failed: DevSeedEnvVar[] = [];
      for (const name of attempted) {
        let removed: boolean;
        try {
          removed = removeEnv(name);
        } catch {
          failed.push(name);
          continue;
        }
        if (!removed) {
          failed.push(name);
        }
      }

      return {
        ok: failed.length === 0,
        attempted,
        failed,
        cleanupCommands: failed.map((name) =>
          manualEnvRemoveCommand(name, target),
        ),
      };
    },
  };
}
