const DEFAULT_POSTHOG_BACKEND_HOST = 'https://us.i.posthog.com';

export function resolveConvexEnvValue(
  key: string,
  env: NodeJS.ProcessEnv,
): string {
  const value = env[key];
  if (!value) {
    return '';
  }

  if (key !== 'POSTHOG_HOST') {
    return value;
  }

  return value.startsWith('/') ? DEFAULT_POSTHOG_BACKEND_HOST : value;
}
