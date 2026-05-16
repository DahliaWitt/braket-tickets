import {execFileSync} from 'node:child_process';

import type {AppEnvironment} from '../src/environments/environment.model';

export type FrontendRuntimeMode =
  | 'development'
  | 'preview'
  | 'production'
  | 'test'
  | 'e2e';

const DEFAULT_LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const DEFAULT_LOCAL_CONVEX_SITE_URL = 'http://127.0.0.1:3211';
const DEFAULT_BUILD_TIMESTAMP = 'local';

function getEnv(env: NodeJS.ProcessEnv, key: string, fallback = ''): string {
  const value = env[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function hasEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key];
  return typeof value === 'string' && value !== '';
}

function deriveConvexSiteUrl(convexUrl: string): string {
  if (convexUrl.includes('127.0.0.1:3210')) {
    return DEFAULT_LOCAL_CONVEX_SITE_URL;
  }

  return convexUrl.replace('.convex.cloud', '.convex.site');
}

function assertNotProd(
  convexUrl: string,
  context: string,
  env: NodeJS.ProcessEnv,
): void {
  const prodConvexUrl = getEnv(env, 'PROD_CONVEX_URL');

  if (prodConvexUrl === '' || convexUrl !== prodConvexUrl) {
    return;
  }

  throw new Error(
    `[runtime-config] SAFETY ABORT: ${context} resolved to the production Convex URL (${convexUrl}).`,
  );
}

function getGitInfo(env: NodeJS.ProcessEnv): {
  commitHash: string;
  branch: string;
} {
  const commitHashFromEnv = getEnv(env, 'GITHUB_SHA');
  const branchFromEnv = getEnv(env, 'GITHUB_REF_NAME');

  if (commitHashFromEnv !== '' || branchFromEnv !== '') {
    return {
      commitHash: (commitHashFromEnv || 'unknown').slice(0, 7),
      branch: branchFromEnv || 'unknown',
    };
  }

  try {
    const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      env,
    })
      .trim()
      .slice(0, 7);
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      env,
    }).trim();

    return {commitHash, branch};
  } catch {
    return {commitHash: 'unknown', branch: 'unknown'};
  }
}

function getBuildMeta(env: NodeJS.ProcessEnv): AppEnvironment['build'] {
  const gitInfo = getGitInfo(env);

  return {
    commitHash: gitInfo.commitHash,
    branch: gitInfo.branch,
    timestamp: getEnv(env, 'BUILD_TIMESTAMP', DEFAULT_BUILD_TIMESTAMP),
  };
}

export function createFrontendRuntimeConfig(
  mode: FrontendRuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const build = getBuildMeta(env);
  const prodConvexUrl = getEnv(env, 'PROD_CONVEX_URL');

  switch (mode) {
    case 'development': {
      const convexUrl = getEnv(env, 'CONVEX_URL', DEFAULT_LOCAL_CONVEX_URL);
      if (hasEnv(env, 'CONVEX_URL')) {
        assertNotProd(convexUrl, 'development CONVEX_URL', env);
      }

      return {
        production: false,
        convexUrl,
        convexSiteUrl: getEnv(
          env,
          'CONVEX_SITE_URL',
          deriveConvexSiteUrl(convexUrl),
        ),
        isE2E: false,
        build,
        stripe: {
          publishableKey: getEnv(env, 'STRIPE_PUBLISHABLE_KEY'),
          mockPayments: false,
        },
        sentryDsn: getEnv(env, 'SENTRY_DSN'),
        sentryEnvironment: 'development',
        enableSentry: false,
        enableSentryReplay: false,
        sentryReplaySessionSampleRate: 0,
        sentryReplayOnErrorSampleRate: 0,
      };
    }
    case 'preview': {
      const convexUrl = getEnv(env, 'CONVEX_URL', DEFAULT_LOCAL_CONVEX_URL);
      if (hasEnv(env, 'CONVEX_URL')) {
        assertNotProd(convexUrl, 'preview CONVEX_URL', env);
      }

      const sentryDsn = getEnv(env, 'SENTRY_DSN');

      return {
        production: true,
        convexUrl,
        convexSiteUrl: getEnv(
          env,
          'CONVEX_SITE_URL',
          deriveConvexSiteUrl(convexUrl),
        ),
        isE2E: false,
        build,
        stripe: {
          publishableKey: getEnv(env, 'STRIPE_PUBLISHABLE_KEY'),
          mockPayments: false,
        },
        sentryDsn,
        sentryEnvironment: 'preview',
        enableSentry: sentryDsn !== '',
        enableSentryReplay: sentryDsn !== '',
        sentryReplaySessionSampleRate: sentryDsn !== '' ? 0.05 : 0,
        sentryReplayOnErrorSampleRate: sentryDsn !== '' ? 1 : 0,
      };
    }
    case 'production': {
      const convexUrl = getEnv(env, 'CONVEX_URL', prodConvexUrl);
      const sentryDsn = getEnv(env, 'SENTRY_DSN');

      return {
        production: true,
        convexUrl,
        convexSiteUrl: getEnv(
          env,
          'CONVEX_SITE_URL',
          deriveConvexSiteUrl(convexUrl),
        ),
        isE2E: false,
        build,
        stripe: {
          publishableKey: getEnv(env, 'STRIPE_PUBLISHABLE_KEY'),
          mockPayments: false,
        },
        sentryDsn,
        sentryEnvironment: 'production',
        enableSentry: sentryDsn !== '',
        enableSentryReplay: sentryDsn !== '',
        sentryReplaySessionSampleRate: sentryDsn !== '' ? 0.05 : 0,
        sentryReplayOnErrorSampleRate: sentryDsn !== '' ? 1 : 0,
      };
    }
    case 'test': {
      const convexUrl = getEnv(env, 'CONVEX_URL', DEFAULT_LOCAL_CONVEX_URL);
      if (hasEnv(env, 'CONVEX_URL')) {
        assertNotProd(convexUrl, 'test CONVEX_URL', env);
      }

      return {
        production: true,
        convexUrl,
        convexSiteUrl: getEnv(
          env,
          'CONVEX_SITE_URL',
          deriveConvexSiteUrl(convexUrl),
        ),
        isE2E: false,
        build,
        stripe: {
          publishableKey: getEnv(env, 'STRIPE_PUBLISHABLE_KEY'),
          mockPayments: false,
        },
        sentryDsn: getEnv(env, 'SENTRY_DSN'),
        sentryEnvironment: 'test',
        enableSentry: false,
        enableSentryReplay: false,
        sentryReplaySessionSampleRate: 0,
        sentryReplayOnErrorSampleRate: 0,
      };
    }
    case 'e2e': {
      const convexUrl = getEnv(env, 'CONVEX_URL', DEFAULT_LOCAL_CONVEX_URL);
      if (hasEnv(env, 'CONVEX_URL')) {
        assertNotProd(convexUrl, 'e2e CONVEX_URL', env);
      }

      return {
        production: false,
        convexUrl,
        convexSiteUrl: getEnv(
          env,
          'CONVEX_SITE_URL',
          DEFAULT_LOCAL_CONVEX_SITE_URL,
        ),
        isE2E: true,
        build: {
          ...build,
          timestamp: getEnv(env, 'BUILD_TIMESTAMP', 'e2e'),
        },
        stripe: {
          publishableKey: getEnv(env, 'STRIPE_PUBLISHABLE_KEY', 'pk_test_mock'),
          mockPayments: true,
        },
        sentryDsn: getEnv(env, 'SENTRY_DSN'),
        sentryEnvironment: 'e2e',
        enableSentry: false,
        enableSentryReplay: false,
        sentryReplaySessionSampleRate: 0,
        sentryReplayOnErrorSampleRate: 0,
      };
    }
  }
}

export function createAngularDefineArgs(
  mode: FrontendRuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    '--define',
    `__BRAKET_RUNTIME__=${JSON.stringify(createFrontendRuntimeConfig(mode, env))}`,
  ];
}

export function createVitestDefine(
  mode: FrontendRuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    __BRAKET_RUNTIME__: JSON.stringify(createFrontendRuntimeConfig(mode, env)),
  };
}
