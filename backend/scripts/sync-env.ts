/**
 * sync-env.ts — Sync process environment variables to a Convex deployment.
 *
 * Replaces scripts/sync-convex-env.js.
 *
 * Usage:
 *   tsx scripts/sync-env.ts (--dev | --prod) [--confirm]
 *
 *   --dev      Sync to the dev deployment (uses CONVEX_URL from env)
 *   --prod     Sync to production (requires GitHub Actions or Doppler prd)
 *   --confirm  Required for --prod execution; without it, runs a dry-run preview
 */

import {spawnSync} from 'child_process';
import {
  CONVEX_CLI,
  PROJECT_ROOT,
  ensureDopplerEnv,
} from '../../scripts/lib/shared.ts';
import {
  describeProductionSource,
  describeProductionTarget,
  parseSyncEnvArgs,
  validateProductionSyncEnvironment,
} from './sync-env-safety.ts';

// ── ANSI colors ────────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ── Key lists ──────────────────────────────────────────────────────────────────

const COMMON_SYNC_KEYS = [
  'AUTH_BASE_URL',
  // Incident kill switch for the haveIBeenPwned breach check (fails closed).
  // Optional: skipped when unset in Doppler. 'true' disables, 'false' re-enables.
  'AUTH_HIBP_DISABLED',
  'BETTER_AUTH_SECRET',
  'CONVEX_SITE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'SITE_URL',
  'TOKEN_DIGEST_SECRET',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'SMTP_FROM',
  'SMTP_HOST',
  'SMTP_PASS',
  'SMTP_PORT',
  'SMTP_REPLY_TO',
  'SMTP_USER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET_CONNECT',
  'STRIPE_WEBHOOK_SECRET_V2_EVENTS',
] as const;

const MODE_SYNC_KEYS = {
  dev: [...COMMON_SYNC_KEYS, 'ALLOW_LOCALHOST_CORS', 'IS_TEST'] as string[],
  prod: COMMON_SYNC_KEYS as unknown as string[],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function maskValue(value: string): string {
  if (value.length <= 6) return '****';
  return (
    value.slice(0, 3) +
    '*'.repeat(Math.min(value.length - 5, 20)) +
    value.slice(-2)
  );
}

function printUsage(): void {
  console.log('Usage: tsx scripts/sync-env.ts (--dev | --prod) [--confirm]');
  console.log('');
  console.log('Modes:');
  console.log('  --dev   Sync the current process env to Convex development');
  console.log('  --prod  Sync the current process env to Convex production');
  console.log('');
  console.log('Flags:');
  console.log(
    '  --confirm   Required for --prod execution (without it, runs a dry preview)',
  );
  console.log('');
  console.log('Production sync source requirements:');
  console.log(
    '  - GitHub Actions with production environment secrets and CONVEX_DEPLOY_KEY',
  );
  console.log('  - Local operator shell with DOPPLER_CONFIG=prd');
  console.log('');
  console.log('Examples:');
  console.log('  DOPPLER_CONFIG=prd pnpm sync:env:prod:preview');
  console.log('  DOPPLER_CONFIG=prd pnpm sync:env:prod');
}

// ── Argument parsing ───────────────────────────────────────────────────────────

const scriptArgs = process.argv.slice(2);
const parsedArgs = parseSyncEnvArgs(scriptArgs);

if (parsedArgs.shouldPrintHelp) {
  console.log('');
  printUsage();
  console.log('');
  process.exit(0);
}

if (parsedArgs.errors.length > 0) {
  for (const error of parsedArgs.errors) {
    console.error(error);
  }
  console.log('');
  printUsage();
  process.exit(1);
}

ensureDopplerEnv();

const {hasConfirm, isDev, isProd} = parsedArgs;
const modeLabel = isDev ? 'Development' : 'Production';
const modeSyncKeys = isDev ? MODE_SYNC_KEYS.dev : MODE_SYNC_KEYS.prod;

// ── Safety guards ──────────────────────────────────────────────────────────────

if (isDev) {
  const prodConvexUrl = process.env['PROD_CONVEX_URL'] ?? '';
  if (prodConvexUrl && process.env['CONVEX_URL'] === prodConvexUrl) {
    console.error(
      `${RED}SAFETY ABORT: The injected development environment contains the PRODUCTION Convex URL!${RESET}`,
    );
    console.error(`${RED}CONVEX_URL = ${process.env['CONVEX_URL']}${RESET}`);
    console.error(
      'This script syncs to the DEV deployment. Fix the injected environment and try again.',
    );
    process.exit(1);
  }
}

if (isProd) {
  const safetyErrors = validateProductionSyncEnvironment(process.env);
  if (safetyErrors.length > 0) {
    console.error(
      `${RED}SAFETY ABORT: Production sync source is unsafe.${RESET}`,
    );
    for (const error of safetyErrors) {
      console.error(`  - ${error}`);
    }
    console.error('');
    console.error(
      'Use GitHub Actions for production deploys, or run locally with DOPPLER_CONFIG=prd and an approved CONVEX_DEPLOY_KEY.',
    );
    process.exit(1);
  }
}

// ── Build list of keys to sync ─────────────────────────────────────────────────

const keysToSync: [string, string][] = modeSyncKeys.flatMap((key) => {
  const value = process.env[key] ?? '';
  return value ? [[key, value]] : [];
});

if (keysToSync.length === 0) {
  console.error(
    `No syncable variables were found for ${modeLabel.toLowerCase()} mode.`,
  );
  console.error(
    'Expected values in process.env. Run this script under Doppler or export the keys first.',
  );
  process.exit(1);
}

const targetLabel = isProd
  ? describeProductionTarget(process.env)
  : (process.env['CONVEX_URL'] ?? '(not set)');

// ── Display preview for prod ───────────────────────────────────────────────────

if (isProd) {
  console.log('');
  console.log(
    `${RED}${BOLD}  ╔══════════════════════════════════════════════╗${RESET}`,
  );
  console.log(
    `${RED}${BOLD}  ║     PRODUCTION CONVEX ENVIRONMENT SYNC       ║${RESET}`,
  );
  console.log(
    `${RED}${BOLD}  ╚══════════════════════════════════════════════╝${RESET}`,
  );
  console.log('');
  console.log(`  ${BOLD}Target:${RESET} ${RED}${targetLabel}${RESET}`);
  console.log(
    `  ${BOLD}Source:${RESET} ${describeProductionSource(process.env)}`,
  );
  console.log(
    `  ${BOLD}Keys:${RESET}   ${keysToSync.length} variables will be set`,
  );
  console.log('');
  console.log(`  ${YELLOW}Preview:${RESET}`);
  for (const [key, value] of keysToSync) {
    console.log(`    ${key} = ${maskValue(value)}`);
  }
  console.log('');
} else {
  console.log(`Syncing variables from process.env to Convex ${modeLabel}...`);
}

if (isProd && !hasConfirm) {
  console.log(`${YELLOW}  Dry run — no changes made.${RESET}`);
  console.log(
    `  To execute locally, run: ${BOLD}DOPPLER_CONFIG=prd pnpm sync:env:prod${RESET}`,
  );
  console.log('');
  process.exit(0);
}

// ── Sync ───────────────────────────────────────────────────────────────────────

function runSync(): void {
  if (isProd) {
    console.log('');
    console.log('  Syncing...');
  }

  for (const [key, value] of keysToSync) {
    if (isProd) {
      process.stdout.write(`  Setting ${key}... `);
    } else {
      console.log(`Setting ${key}...`);
    }

    const convexArgs = ['env', 'set', key];
    if (isProd) {
      convexArgs.push('--prod');
    }

    // Pass values over stdin to avoid shell escaping issues and length limits.
    const result = spawnSync(CONVEX_CLI, convexArgs, {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });

    if (result.status !== 0) {
      const exitCode = result.status ?? 1;
      if (isProd) {
        console.log(`FAILED (exit code ${String(exitCode)})`);
      } else {
        console.error(`Failed to set ${key} (exit code ${String(exitCode)})`);
      }
      if (result.stderr) {
        console.error(`    ${result.stderr.trim()}`);
      }
      if (result.stdout) {
        console.error(`    ${result.stdout.trim()}`);
      }
      if (result.signal) {
        console.error(`    Terminated by signal ${result.signal}`);
      }
      process.exit(exitCode);
    } else if (isProd) {
      console.log('OK');
    }
  }

  if (isProd) {
    console.log('');
    console.log('  Sync complete.');
  } else {
    console.log('Sync complete.');
  }
}

runSync();
