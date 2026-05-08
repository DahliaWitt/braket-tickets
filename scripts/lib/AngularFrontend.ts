import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import {execFileSync, spawn} from 'child_process';

import {PROJECT_ROOT, findEphemeralPort, treeKill, sleep} from './shared';

// ── Constants ──────────────────────────────────────────────────────────────────

const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');

const FRONTEND_START_TIMEOUT_MS = parseInt(
  process.env['FRONTEND_START_TIMEOUT_MS'] ?? '120000',
  10,
);

const FRONTEND_POLL_INTERVAL_MS = 1000;

// ── Public interface ───────────────────────────────────────────────────────────

export interface FrontendOptions {
  convexUrl: string;
  convexSiteUrl: string;
  /** Port to listen on. 0 = allocate an ephemeral port. */
  port?: number;
  configuration: 'development' | 'e2e';
}

// ── AngularFrontend ────────────────────────────────────────────────────────────

export class AngularFrontend {
  private readonly _convexUrl: string;
  private readonly _convexSiteUrl: string;
  private readonly _requestedPort: number;
  private readonly _configuration: 'development' | 'e2e';

  private _port: number | null = null;
  private _pid: number | null = null;
  private _exited = false;
  private _exitCode: number | null = null;

  constructor(opts: FrontendOptions) {
    this._convexUrl = opts.convexUrl;
    this._convexSiteUrl = opts.convexSiteUrl;
    this._requestedPort = opts.port ?? 0;
    this._configuration = opts.configuration;
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  get url(): string {
    if (this._port === null) {
      throw new Error('Frontend not started — url is not yet available');
    }
    return `http://127.0.0.1:${this._port}`;
  }

  get frontendPid(): number | null {
    return this._pid;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Resolve port
    if (this._requestedPort === 0) {
      this._port = await findEphemeralPort();
    } else {
      this._port = this._requestedPort;
    }

    const port = this._port;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CONVEX_URL: this._convexUrl,
      CONVEX_SITE_URL: this._convexSiteUrl,
    };

    // Build docs manifest (optional — best-effort; skip in E2E for faster startup)
    if (this._configuration !== 'e2e') {
      const docsManifestScript = path.join(
        PROJECT_ROOT,
        'scripts',
        'build-docs-manifest.ts',
      );
      if (fs.existsSync(docsManifestScript)) {
        console.log('[AngularFrontend] Building docs manifest...');
        try {
          execFileSync('tsx', ['../scripts/build-docs-manifest.ts'], {
            cwd: FRONTEND_DIR,
            env,
            stdio: 'inherit',
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[AngularFrontend] build-docs-manifest.ts failed (non-fatal): ${msg}`,
          );
        }
      }
    }

    // Choose cache dir for Angular build cache isolation
    const ngCacheDir =
      this._configuration === 'e2e'
        ? path.join(FRONTEND_DIR, '.angular', `cache-e2e-${port}`)
        : path.join(FRONTEND_DIR, '.angular', 'cache');

    const spawnEnv: NodeJS.ProcessEnv = {
      ...env,
      NG_CACHE_DIR: ngCacheDir,
    };

    console.log(
      `[AngularFrontend] Starting ng serve (configuration=${this._configuration}, port=${port})...`,
    );

    // Spawn ng serve — do NOT await; it runs in the background
    const proc = spawn(
      'tsx',
      [
        './scripts/run-ng-with-runtime.ts',
        'serve',
        `--configuration=${this._configuration}`,
        `--port=${port}`,
        '--host=127.0.0.1',
      ],
      {
        cwd: FRONTEND_DIR,
        env: spawnEnv,
        stdio: 'inherit',
        detached: false,
      },
    );

    this._pid = proc.pid ?? null;
    this._exited = false;
    this._exitCode = null;

    proc.on('exit', (code) => {
      this._exited = true;
      this._exitCode = code;
    });

    await this._waitForReady();
    console.log(`[AngularFrontend] Ready at http://127.0.0.1:${port}`);
  }

  async stop(): Promise<void> {
    if (this._pid !== null) {
      console.log(`[AngularFrontend] Stopping frontend (pid ${this._pid})...`);
      try {
        await treeKill(this._pid);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[AngularFrontend] treeKill failed: ${msg}`);
      }
      this._pid = null;
    }
  }

  // ── Static methods ────────────────────────────────────────────────────────────

  /**
   * Build the Angular app in e2e configuration, copy the dist to a workspace
   * directory, and serve with the frontend workspace's `serve` binary.
   *
   * Used for --build mode where a pre-built static bundle is served instead of
   * a live dev server.
   */
  static async buildAndServe(
    convexUrl: string,
    convexSiteUrl: string,
    servePort: number,
    workspaceDir: string,
  ): Promise<{pid: number; port: number}> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CONVEX_URL: convexUrl,
      CONVEX_SITE_URL: convexSiteUrl,
    };

    console.log(
      '[AngularFrontend] Building e2e bundle (pnpm --filter frontend build:e2e)...',
    );
    execFileSync('pnpm', ['--filter', 'frontend', 'build:e2e'], {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit',
    });

    // Copy dist to workspace directory for isolation
    const distSrc = path.join(FRONTEND_DIR, 'dist', 'frontend', 'browser');
    const distDest = path.join(workspaceDir, 'dist');

    if (fs.existsSync(distDest)) {
      fs.rmSync(distDest, {recursive: true, force: true});
    }
    fs.mkdirSync(distDest, {recursive: true});

    execFileSync('cp', ['-r', distSrc + '/.', distDest], {stdio: 'inherit'});

    console.log(
      `[AngularFrontend] Serving static build on port ${servePort}...`,
    );

    const proc = spawn(
      'pnpm',
      [
        '--filter',
        'frontend',
        'exec',
        'serve',
        distDest,
        '-l',
        String(servePort),
        '-s',
        '--no-request-logging',
      ],
      {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        detached: false,
      },
    );

    const pid = proc.pid;
    if (pid === undefined) {
      throw new Error(
        '[AngularFrontend] Failed to spawn serve process — no PID assigned',
      );
    }

    // If readiness fails before the caller receives the PID, clean up here.
    try {
      await AngularFrontend._pollHttp(`http://127.0.0.1:${servePort}`, 60000);
    } catch (err: unknown) {
      console.warn(
        `[AngularFrontend] Static server failed readiness; stopping pid ${pid}...`,
      );
      try {
        await treeKill(pid);
      } catch (killErr: unknown) {
        const msg =
          killErr instanceof Error ? killErr.message : String(killErr);
        console.warn(`[AngularFrontend] Failed to stop static server: ${msg}`);
      }
      throw err;
    }
    console.log(
      `[AngularFrontend] Static server ready at http://127.0.0.1:${servePort}`,
    );

    return {pid, port: servePort};
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Poll http://127.0.0.1:<port> until it returns a 2xx/3xx response or times
   * out. Angular's dev server returns HTML (200) on the root path.
   *
   * Do NOT use healthCheck() here — that hits /version which Angular does not
   * serve.
   */
  private async _waitForReady(startedAt = Date.now()): Promise<void> {
    const port = this._port!;
    const isReady = await AngularFrontend._httpCheck(
      `http://127.0.0.1:${port}`,
      1500,
    );

    if (isReady) return;

    const elapsedMs = Date.now() - startedAt;

    if (this._exited) {
      throw new Error(
        `[AngularFrontend] ng serve exited unexpectedly with code ${this._exitCode} before becoming ready`,
      );
    }

    if (elapsedMs >= FRONTEND_START_TIMEOUT_MS) {
      throw new Error(
        `[AngularFrontend] Timed out waiting for frontend readiness after ${Math.round(elapsedMs / 1000)}s`,
      );
    }

    if (Math.round(elapsedMs / 1000) % 15 === 0 && elapsedMs > 0) {
      console.log(
        `[AngularFrontend] Waiting for ng serve... (${Math.round(elapsedMs / 1000)}s elapsed)`,
      );
    }

    await sleep(FRONTEND_POLL_INTERVAL_MS);
    return this._waitForReady(startedAt);
  }

  /**
   * Single HTTP GET check. Returns true if the response status is < 500
   * (includes 200 OK, 3xx redirects, 404 — anything that means the server is
   * listening). Returns false on connection error or timeout.
   */
  private static _httpCheck(url: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const parsed = new URL(url);
      const request = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || '/',
          method: 'GET',
        },
        (res) => {
          // Any response (even 4xx) means the server is up
          resolve((res.statusCode ?? 0) < 500);
          // Consume the body so the socket is released
          res.resume();
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy();
      });
      request.on('error', () => {
        resolve(false);
      });
      request.end();
    });
  }

  /**
   * Poll an HTTP endpoint until it responds successfully or times out.
   */
  private static async _pollHttp(
    url: string,
    timeoutMs: number,
    startedAt = Date.now(),
  ): Promise<void> {
    const isReady = await AngularFrontend._httpCheck(url, 1500);
    if (isReady) return;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `[AngularFrontend] Timed out waiting for ${url} after ${Math.round(elapsedMs / 1000)}s`,
      );
    }

    await sleep(FRONTEND_POLL_INTERVAL_MS);
    return AngularFrontend._pollHttp(url, timeoutMs, startedAt);
  }
}
