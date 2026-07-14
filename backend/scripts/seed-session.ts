export const DEV_SEED_ENV_VARS = [
  'DEV_SEED',
  'DEV_SEED_TOKEN',
  'DEV_SEED_EXPIRES_AT',
] as const;

export type DevSeedEnvVar = (typeof DEV_SEED_ENV_VARS)[number];

type LocalSeedEnvTarget = {
  kind: 'local';
  url: string;
  adminKey: string;
};

type RemoteSeedEnvTarget = {
  kind: 'remote';
  deployment: string;
};

export type SeedEnvTarget = LocalSeedEnvTarget | RemoteSeedEnvTarget;

export type SeedCleanupTarget =
  | (LocalSeedEnvTarget & {
      dopplerConfig?: never;
      dopplerProject?: never;
    })
  | (RemoteSeedEnvTarget & {
      dopplerConfig?: string;
      dopplerProject?: string;
    });

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

export function convexEnvTargetArgs(
  target: SeedEnvTarget,
  adminKeyOverride?: string,
): string[] {
  if (target.kind === 'remote') {
    return [];
  }

  return [
    '--admin-key',
    adminKeyOverride ?? target.adminKey,
    '--url',
    target.url,
  ];
}

export function manualEnvRemoveCommand(
  name: DevSeedEnvVar,
  target: SeedCleanupTarget,
): string {
  if (target.kind === 'remote' && target.dopplerConfig) {
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
      ...convexEnvTargetArgs(target),
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
    ...convexEnvTargetArgs(
      target,
      target.kind === 'local' ? '<local-admin-key>' : undefined,
    ),
  ]
    .map(shellQuote)
    .join(' ');
}

export function getConvexCloudDeploymentName(convexUrl: string): string | null {
  try {
    const url = new URL(convexUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const match = /^([a-z0-9-]+)\.convex\.cloud$/u.exec(url.hostname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

type ResolveSeedEnvTargetOptions = {
  convexUrl: string;
  isLocal: boolean;
  adminKey?: string;
  deployKey?: string;
  allowedRemoteDeployments: readonly string[];
};

type DeploymentKeyIdentity = {
  type: 'dev' | 'prod' | 'preview';
  deployment: string;
};

/**
 * Parse the current Convex deployment-scoped key format without retaining or
 * returning the secret token: `<type>:<deployment-name>|<token>`.
 *
 * Project keys select a deployment dynamically, while legacy and malformed
 * keys do not give this script enough trustworthy identity information. All
 * of those shapes intentionally return null and are rejected by the caller.
 */
function getDeploymentKeyIdentity(
  deployKey: string | undefined,
): DeploymentKeyIdentity | null {
  if (!deployKey) {
    return null;
  }

  const match = /^(dev|prod|preview):([a-z0-9-]+)\|[^|\s]+$/u.exec(deployKey);
  if (!match) {
    return null;
  }

  return {
    type: match[1] as DeploymentKeyIdentity['type'],
    deployment: match[2]!,
  };
}

/**
 * Build the only target shapes accepted by Convex env mutation helpers.
 * Remote targets are returned only after the URL, allowlist, key type, and
 * key-encoded deployment all agree. This guard must run before any DEV_SEED
 * env set/remove operation.
 */
export function resolveSeedEnvTarget({
  convexUrl,
  isLocal,
  adminKey,
  deployKey,
  allowedRemoteDeployments,
}: ResolveSeedEnvTargetOptions): SeedEnvTarget {
  if (isLocal) {
    if (!adminKey) {
      throw new Error('Local seed env target requires an admin key');
    }
    return {kind: 'local', url: convexUrl, adminKey};
  }

  const urlDeployment = getConvexCloudDeploymentName(convexUrl);
  if (!urlDeployment) {
    throw new Error(
      'Refusing to enable DEV_SEED: target URL is not a recognized Convex cloud deployment',
    );
  }
  if (!allowedRemoteDeployments.includes(urlDeployment)) {
    throw new Error(
      `Refusing to enable DEV_SEED on non-allowlisted remote deployment ${urlDeployment}`,
    );
  }

  const keyIdentity = getDeploymentKeyIdentity(deployKey);
  if (!keyIdentity) {
    throw new Error(
      'Remote seed env changes require a current deployment-scoped CONVEX_DEPLOY_KEY',
    );
  }
  if (keyIdentity.type !== 'dev') {
    throw new Error(
      'Remote seed env changes require a dev deployment-scoped CONVEX_DEPLOY_KEY',
    );
  }
  if (keyIdentity.deployment !== urlDeployment) {
    throw new Error(
      `CONVEX_DEPLOY_KEY deployment ${keyIdentity.deployment} does not match target URL deployment ${urlDeployment}`,
    );
  }

  return {kind: 'remote', deployment: urlDeployment};
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
