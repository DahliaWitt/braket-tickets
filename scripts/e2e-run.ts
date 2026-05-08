/**
 * e2e-run.ts — Run Playwright tests against an already-running E2E serve session.
 *
 * Replaces scripts/e2e-run.js.
 * Requires `pnpm test:e2e:serve` to be running in another terminal first.
 *
 * Usage:
 *   pnpm test:e2e:run
 *   pnpm test:e2e:run --grep "login"
 *   pnpm test:e2e:run e2e/auth.e2e-spec.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import {spawnSync, execFileSync} from 'child_process';

import {
  ensureDopplerEnv,
  LOCAL_DIR,
  PROJECT_ROOT,
  ADMIN_KEY,
  CONVEX_CLI,
  sleep,
} from './lib/shared';

ensureDopplerEnv();

// ── Read workspace from e2e-active symlink ─────────────────────────────────────

const activeLink = path.join(LOCAL_DIR, 'e2e-active');

if (!fs.existsSync(activeLink)) {
  console.error('ERROR: .convex-local/e2e-active symlink not found.');
  console.error('');
  console.error('Run `pnpm test:e2e:serve` first to start the E2E servers,');
  console.error('then use `pnpm test:e2e:run` in a separate terminal.');
  process.exit(1);
}

const workspaceDir = fs.realpathSync(activeLink);

function readWorkspaceFile(filename: string): string | null {
  const filePath = path.join(workspaceDir, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8').trim();
}

const convexUrl = readWorkspaceFile('convex-url');
const convexSiteUrl = readWorkspaceFile('convex-site-url');
const frontendPortStr = readWorkspaceFile('frontend-port');
const pidStr = readWorkspaceFile('pid');
const adminKey = readWorkspaceFile('admin-key') ?? ADMIN_KEY;

// ── Validate required files ────────────────────────────────────────────────────

if (!convexUrl || !convexSiteUrl || !frontendPortStr) {
  const missing = [
    !convexUrl && 'convex-url',
    !convexSiteUrl && 'convex-site-url',
    !frontendPortStr && 'frontend-port',
  ]
    .filter(Boolean)
    .join(', ');
  console.error(`ERROR: Missing workspace file(s): ${missing}`);
  console.error(`  Workspace dir: ${workspaceDir}`);
  console.error('');
  console.error('Restart `pnpm test:e2e:serve` before rerunning tests.');
  process.exit(1);
}

const e2ePort = parseInt(frontendPortStr, 10);

// ── Validate serve PID is alive ────────────────────────────────────────────────

if (!pidStr) {
  console.error('ERROR: Missing pid file in E2E workspace.');
  console.error('Restart `pnpm test:e2e:serve` before rerunning tests.');
  process.exit(1);
}

const pid = parseInt(pidStr, 10);
if (!Number.isInteger(pid) || pid <= 0) {
  console.error('ERROR: The active E2E serve pid is malformed.');
  console.error(`  pid: ${pidStr}`);
  console.error('Restart `pnpm test:e2e:serve` before rerunning tests.');
  process.exit(1);
}

try {
  process.kill(pid, 0);
} catch {
  console.error('ERROR: The active E2E serve process is no longer running.');
  console.error(`  pid: ${String(pid)}`);
  console.error('Restart `pnpm test:e2e:serve` before rerunning tests.');
  process.exit(1);
}

// ── Health check ───────────────────────────────────────────────────────────────

function httpCheck(url: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const parsed = new URL(url);
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname || '/',
        method: 'GET',
      },
      (res) => {
        finish((res.statusCode ?? 0) === 200);
        res.resume();
      },
    );
    request.setTimeout(timeoutMs, () => {
      finish(false);
      request.destroy();
    });
    request.on('error', () => finish(false));
    request.end();
  });
}

async function clearTestDataWithRetry(
  url: string,
  key: string,
  attempt = 1,
  maxRetries = 5,
): Promise<void> {
  const baseDelay = 3000;
  try {
    execFileSync(
      CONVEX_CLI,
      [
        'run',
        'testing/utilities:clearAll',
        '--admin-key',
        key,
        '--url',
        url,
        '--',
        '{"keepUsers":true}',
      ],
      {stdio: 'inherit', cwd: PROJECT_ROOT},
    );
  } catch (err: unknown) {
    console.error(`clearAll attempt ${attempt}/${maxRetries} failed.`);
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Retrying clearAll in ${delay / 1000} seconds...`);
      await sleep(delay);
      return clearTestDataWithRetry(url, key, attempt + 1, maxRetries);
    }
    throw err;
  }
}

void (async () => {
  const backendHealthUrl = `${convexUrl}/version`;
  const siteHealthUrl = `${convexSiteUrl}/api/auth/convex/jwks`;
  const frontendHealthUrl = `http://127.0.0.1:${String(e2ePort)}`;

  const [backendOk, siteOk, frontendOk] = await Promise.all([
    httpCheck(backendHealthUrl),
    httpCheck(siteHealthUrl),
    httpCheck(frontendHealthUrl),
  ]);

  if (!backendOk || !siteOk || !frontendOk) {
    console.error(
      'ERROR: The E2E workspace points at a backend/frontend pair that is not healthy.',
    );
    console.error(`  E2E port:        ${String(e2ePort)}`);
    console.error(`  Convex URL:      ${convexUrl}`);
    console.error(`  Convex Site URL: ${convexSiteUrl}`);
    console.error(
      `  Backend check:   ${backendHealthUrl} — ${backendOk ? 'OK' : 'FAILED'}`,
    );
    console.error(
      `  Site check:      ${siteHealthUrl} — ${siteOk ? 'OK' : 'FAILED'}`,
    );
    console.error(
      `  Frontend check:  ${frontendHealthUrl} — ${frontendOk ? 'OK' : 'FAILED'}`,
    );
    console.error(
      'Restart `pnpm test:e2e:serve` to refresh the server state before rerunning tests.',
    );
    process.exit(1);
  }

  // ── Clear database ─────────────────────────────────────────────────────────

  console.log('Clearing test data before run...');
  try {
    await clearTestDataWithRetry(convexUrl, adminKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `ERROR: Failed to clear test data after retries. Refusing to run E2E against a dirty database: ${msg}`,
    );
    process.exit(1);
  }

  // ── Run Playwright ─────────────────────────────────────────────────────────

  // Filter out bare '--' that pnpm passes through as a literal arg
  const userArgs = process.argv.slice(2).filter((a) => a !== '--');

  const result = spawnSync(
    'pnpm',
    ['--filter', 'frontend', 'exec', 'playwright', 'test', ...userArgs],
    {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        E2E_PORT: String(e2ePort),
        CONVEX_URL: convexUrl,
        CONVEX_SITE_URL: convexSiteUrl,
      },
    },
  );

  process.exit(result.status ?? 1);
})();
