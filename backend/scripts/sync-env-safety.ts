export interface ParsedSyncEnvArgs {
  errors: string[];
  hasConfirm: boolean;
  isDev: boolean;
  isProd: boolean;
  shouldPrintHelp: boolean;
}

type EnvMap = Record<string, string | undefined>;

const KNOWN_FLAGS = new Set([
  '--',
  '--confirm',
  '--dev',
  '--help',
  '--prod',
  '-h',
]);

const LOCAL_URL_KEYS = [
  'AUTH_BASE_URL',
  'CONVEX_SITE_URL',
  'SITE_URL',
] as const;

const PRODUCTION_DEPLOY_ENV = 'production';

export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function parseSyncEnvArgs(args: readonly string[]): ParsedSyncEnvArgs {
  const argSet = new Set(args);
  const shouldPrintHelp = argSet.has('--help') || argSet.has('-h');
  const isDev = argSet.has('--dev');
  const isProd = argSet.has('--prod');
  const hasConfirm = argSet.has('--confirm');
  const errors: string[] = [];

  if (shouldPrintHelp) {
    return {errors, hasConfirm, isDev, isProd, shouldPrintHelp};
  }

  const unknownArgs = args.filter((arg) => !KNOWN_FLAGS.has(arg));
  if (unknownArgs.length > 0) {
    errors.push(`Unsupported argument(s): ${unknownArgs.join(', ')}`);
  }

  if ((isDev && isProd) || (!isDev && !isProd)) {
    errors.push('Please specify exactly one mode flag: --dev or --prod.');
  }

  return {errors, hasConfirm, isDev, isProd, shouldPrintHelp};
}

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function describeProductionSource(env: EnvMap): string {
  if (
    isTruthy(env['CI']) &&
    isTruthy(env['GITHUB_ACTIONS']) &&
    env['BRAKET_DEPLOY_ENV'] === PRODUCTION_DEPLOY_ENV
  ) {
    return 'GitHub Actions production environment';
  }
  if (env['DOPPLER_CONFIG'] === 'prd' && isTruthy(env['DOPPLER_INJECTED'])) {
    return 'Doppler prd';
  }
  return 'unverified environment';
}

export function describeProductionTarget(env: EnvMap): string {
  const deploymentUrl = env['PROD_CONVEX_URL'] ?? env['CONVEX_URL'];
  if (deploymentUrl) {
    return `${deploymentUrl} via CONVEX_DEPLOY_KEY`;
  }
  return 'production deployment selected by CONVEX_DEPLOY_KEY';
}

export function validateProductionSyncEnvironment(env: EnvMap): string[] {
  const errors: string[] = [];
  const isGithubActions =
    isTruthy(env['CI']) && isTruthy(env['GITHUB_ACTIONS']);
  const isGithubProductionActions =
    isGithubActions && env['BRAKET_DEPLOY_ENV'] === PRODUCTION_DEPLOY_ENV;
  const isDopplerPrd =
    env['DOPPLER_CONFIG'] === 'prd' && isTruthy(env['DOPPLER_INJECTED']);

  if (isGithubActions && env['BRAKET_DEPLOY_ENV'] !== PRODUCTION_DEPLOY_ENV) {
    errors.push(
      'GitHub Actions production sync requires BRAKET_DEPLOY_ENV=production.',
    );
  }

  if (env['DOPPLER_CONFIG'] && env['DOPPLER_CONFIG'] !== 'prd') {
    errors.push(
      `DOPPLER_CONFIG must be prd for production sync; received ${env['DOPPLER_CONFIG']}.`,
    );
  }

  if (!isGithubProductionActions && !isDopplerPrd) {
    errors.push(
      'Production sync must run from GitHub Actions production deployment or from a local Doppler prd environment.',
    );
  }

  if (!env['CONVEX_DEPLOY_KEY']) {
    errors.push(
      'CONVEX_DEPLOY_KEY is required so the Convex CLI targets the approved production deployment.',
    );
  }

  if (isTruthy(env['ALLOW_LOCALHOST_CORS'])) {
    errors.push(
      'ALLOW_LOCALHOST_CORS must be unset or false for production sync.',
    );
  }

  for (const key of LOCAL_URL_KEYS) {
    const value = env[key];
    if (value && isLocalHttpUrl(value)) {
      errors.push(`${key} must not point at a local URL for production sync.`);
    }
  }

  return errors;
}
