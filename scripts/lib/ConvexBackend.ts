import * as path from 'path';
import * as fs from 'fs';
import {execFileSync} from 'child_process';
import {randomBytes} from 'crypto';

import {
  ADMIN_KEY,
  CONVEX_CLI,
  LOCAL_DIR,
  PROJECT_ROOT,
  findEphemeralPort,
  healthCheck,
  sleep,
  treeKill,
  startBackendBinary,
  buildEnv,
  setAllEnvVars,
  setOneEnvVar,
  type BackendBinaryHandle,
} from './shared';

// ── Constants ──────────────────────────────────────────────────────────────────

const BACKEND_START_TIMEOUT_MS = parseInt(
  process.env['BACKEND_START_TIMEOUT_MS'] ?? '300000',
  10,
);

const BACKEND_PROGRESS_LOG_INTERVAL_MS = parseInt(
  process.env['BACKEND_PROGRESS_LOG_INTERVAL_MS'] ?? '30000',
  10,
);

// ── Public interface ───────────────────────────────────────────────────────────

export interface BackendOptions {
  mode: 'dev' | 'e2e';
}

// ── ConvexBackend ──────────────────────────────────────────────────────────────

export class ConvexBackend {
  readonly mode: 'dev' | 'e2e';
  readonly instanceId: string;
  readonly workspaceDir: string;

  private _convexPort: number | null = null;
  private _convexSitePort: number | null = null;
  private _pid: number | null = null;
  private _handle: BackendBinaryHandle | null = null;
  private _exited = false;
  private _exitCode: number | null = null;

  constructor(opts: BackendOptions) {
    this.mode = opts.mode;

    if (opts.mode === 'dev') {
      this.instanceId = 'dev';
    } else {
      const uuid = randomBytes(4).toString('hex');
      this.instanceId = `e2e-${uuid}`;
    }

    this.workspaceDir = path.join(LOCAL_DIR, this.instanceId);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get convexUrl(): string {
    if (this._convexPort === null) {
      throw new Error('Backend not started — convexUrl is not yet available');
    }
    return `http://127.0.0.1:${this._convexPort}`;
  }

  get convexSiteUrl(): string {
    if (this._convexSitePort === null) {
      throw new Error(
        'Backend not started — convexSiteUrl is not yet available',
      );
    }
    return `http://127.0.0.1:${this._convexSitePort}`;
  }

  get pid(): number | null {
    return this._pid;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(appPort: number, opts?: {fresh?: boolean}): Promise<void> {
    const fresh = opts?.fresh ?? false;

    // Resolve ports first
    await this._resolvePorts();

    // Create workspace directory
    fs.mkdirSync(this.workspaceDir, {recursive: true});

    const url = this.convexUrl;
    const isRunning = await healthCheck(url);

    if (fresh && isRunning) {
      console.log(
        `[${this.instanceId}] Fresh mode: stopping existing backend...`,
      );
      await this._stopExisting();
    }

    if (!isRunning || fresh) {
      console.log(
        `[${this.instanceId}] Starting backend on port ${this._convexPort!}...`,
      );

      if (this.mode === 'e2e' || fresh) {
        this._deleteBackendState();
      }

      await this._startProcess();
      console.log(
        `[${this.instanceId}] Backend running on port ${this._convexPort!}. Logs: ${this._logFile()}`,
      );

      // Env vars must be complete BEFORE deploy: convex.config.ts declares
      // required env vars (convex 1.39+), so the deploy itself validates them.
      console.log(
        `[${this.instanceId}] Setting minimal env vars before deploy...`,
      );
      await this._setIsTest();
      await this._setSiteUrl(appPort);

      const envEntries = Object.entries(
        buildEnv(this.mode, {
          convex: this._convexPort!,
          convexSite: this._convexSitePort!,
          app: appPort,
        }),
      ) as [string, string][];
      await setAllEnvVars(envEntries, url, this.instanceId);

      await this._deployWithRetry();

      console.log(
        `[${this.instanceId}] Waiting for backend to accept mutations...`,
      );
      await this._waitForMutationReady(appPort);

      if (this.mode === 'e2e') {
        console.log(`[${this.instanceId}] Clearing stale test data...`);
        await this.clearAll();
        await this._warmBetterAuthIndexes();
      }
    } else {
      // Reuse running backend
      console.log(`[${this.instanceId}] Backend already running, reusing...`);

      const skipReset = process.env['SKIP_BACKEND_RESET'] === 'true';
      if (skipReset) {
        console.log(
          `[${this.instanceId}] SKIP_BACKEND_RESET=true — skipping deploy, env setup, and clearAll`,
        );
        if (this.mode === 'dev') {
          await this._guardIsTestFalse();
        }
      } else {
        if (this.mode === 'dev') {
          await this._guardIsTestFalse();
        }
        // Env vars before deploy: required-var validation runs at deploy time.
        const envEntries = Object.entries(
          buildEnv(this.mode, {
            convex: this._convexPort!,
            convexSite: this._convexSitePort!,
            app: appPort,
          }),
        ) as [string, string][];
        await setAllEnvVars(envEntries, url, this.instanceId);

        await this._deployWithRetry();
        await this._waitForMutationReady(appPort);

        if (this.mode === 'e2e') {
          console.log(`[${this.instanceId}] Resetting backend data...`);
          await this.clearAll();
        }
      }
    }

    // Write workspace files (always, so callers can read them)
    this._writeWorkspaceFiles(appPort);
  }

  async stop(): Promise<void> {
    if (this._pid !== null) {
      console.log(
        `[${this.instanceId}] Stopping backend (pid ${this._pid})...`,
      );
      try {
        await treeKill(this._pid);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[${this.instanceId}] treeKill failed: ${msg}`);
      }
      this._pid = null;
      this._handle = null;
    }

    // E2E instances: remove workspace dir (dev persists state)
    if (this.mode === 'e2e') {
      try {
        if (fs.existsSync(this.workspaceDir)) {
          fs.rmSync(this.workspaceDir, {recursive: true, force: true});
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[${this.instanceId}] Failed to remove workspace dir: ${msg}`,
        );
      }
    }
  }

  async clearAll(): Promise<void> {
    await this._runClearAllWithRetry();
  }

  async deploy(): Promise<void> {
    await this._deployWithRetry();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _resolvePorts(): Promise<void> {
    if (this._convexPort !== null) return; // already resolved

    if (this.mode === 'dev') {
      this._convexPort = parseInt(process.env['CONVEX_PORT'] ?? '3210', 10);
      this._convexSitePort = this._convexPort + 1;
    } else {
      // E2E: allocate ephemeral ports
      [this._convexPort, this._convexSitePort] = await Promise.all([
        findEphemeralPort(),
        findEphemeralPort(),
      ]);
      console.log(
        `[${this.instanceId}] Reserved ports: API=${this._convexPort}, Site=${this._convexSitePort}`,
      );
    }
  }

  private _dbSpec(): string {
    return `convex_shard_${this._convexPort!}.sqlite3`;
  }

  private _storageDir(): string {
    return path.join(LOCAL_DIR, `convex_local_storage_${this._convexPort!}`);
  }

  private _logFile(): string {
    return path.join(
      LOCAL_DIR,
      `convex-local-backend-${this._convexPort!}.log`,
    );
  }

  private _printLogTail(lines = 80): void {
    const logFile = this._logFile();
    console.log(`Log tail from ${logFile}:`);
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const tail = content.split(/\r?\n/).slice(-lines).join('\n').trim();
      console.log(tail || '<log file is empty>');
    } catch {
      console.log(`Could not read ${logFile}`);
    }
  }

  private async _startProcess(): Promise<void> {
    this._exited = false;
    this._exitCode = null;

    const dbSpec = this._dbSpec();
    const storageDir = this._storageDir();

    const handle = await startBackendBinary(
      this._convexPort!,
      this._convexSitePort!,
      dbSpec ? {dbSpec, storageDir} : {storageDir},
    );
    this._handle = handle;

    const proc = handle.process;
    this._pid = proc.pid ?? null;

    proc.on('exit', (code) => {
      this._exited = true;
      this._exitCode = code;
    });

    await this._waitForReady();
  }

  private async _waitForReady(
    startedAt = Date.now(),
    iteration = 0,
    lastProgressLogAt = Date.now(),
  ): Promise<void> {
    const url = this.convexUrl;
    const isRunning = await healthCheck(url);

    if (isRunning) return;

    const elapsedMs = Date.now() - startedAt;

    if (this._exited) {
      console.error(
        `[${this.instanceId}] Backend exited unexpectedly with code ${this._exitCode}`,
      );
      this._printLogTail();
      throw new Error(`[${this.instanceId}] Backend failed to start`);
    }

    if (elapsedMs >= BACKEND_START_TIMEOUT_MS) {
      console.error(
        `[${this.instanceId}] Backend did not become healthy within ${BACKEND_START_TIMEOUT_MS}ms`,
      );
      this._printLogTail();
      throw new Error(
        `[${this.instanceId}] Timed out waiting for backend readiness after ${Math.round(elapsedMs / 1000)}s`,
      );
    }

    if (iteration % 10 === 0) {
      console.log(
        `[${this.instanceId}] Waiting for backend... (${Math.round(elapsedMs / 1000)}s elapsed)`,
      );
    }

    let nextProgressLogAt = lastProgressLogAt;
    if (Date.now() - lastProgressLogAt >= BACKEND_PROGRESS_LOG_INTERVAL_MS) {
      console.log(
        `[${this.instanceId}] Backend still not ready; recent log output follows.`,
      );
      this._printLogTail(25);
      nextProgressLogAt = Date.now();
    }

    await sleep(500);
    return this._waitForReady(startedAt, iteration + 1, nextProgressLogAt);
  }

  private async _waitForMutationReady(
    appPort: number,
    start = Date.now(),
  ): Promise<void> {
    const key = this.mode === 'e2e' ? 'IS_TEST' : 'SITE_URL';
    const value = this.mode === 'e2e' ? 'true' : `http://127.0.0.1:${appPort}`;
    const url = this.convexUrl;

    try {
      // All args are controlled internal values — not user input.
      execFileSync(
        CONVEX_CLI,
        ['env', 'set', key, '--admin-key', ADMIN_KEY, '--url', url],
        {
          input: value,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          cwd: PROJECT_ROOT,
        },
      );
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(
        `[${this.instanceId}] Backend ready for mutations (${elapsed}s)`,
      );
    } catch {
      if (Date.now() - start >= 30000) {
        console.warn(
          `[${this.instanceId}] Mutation readiness check timed out after 30s, proceeding anyway`,
        );
        return;
      }
      await sleep(500);
      return this._waitForMutationReady(appPort, start);
    }
  }

  private async _deployWithRetry(attempt = 1, maxRetries = 3): Promise<void> {
    const url = this.convexUrl;
    console.log(
      `[${this.instanceId}] Deploying schema and functions (attempt ${attempt}/${maxRetries})...`,
    );
    try {
      // All args are controlled internal values — not user input.
      execFileSync(
        CONVEX_CLI,
        ['deploy', '--admin-key', ADMIN_KEY, '--url', url],
        {stdio: 'inherit', cwd: PROJECT_ROOT},
      );
    } catch (err: unknown) {
      console.error(
        `[${this.instanceId}] Deploy attempt ${attempt}/${maxRetries} failed.`,
      );
      this._printLogTail();
      if (attempt < maxRetries) {
        console.log(`[${this.instanceId}] Retrying deploy in 5 seconds...`);
        await sleep(5000);
        return this._deployWithRetry(attempt + 1, maxRetries);
      }
      throw err;
    }
  }

  private async _runClearAllWithRetry(
    attempt = 1,
    maxRetries = 5,
  ): Promise<void> {
    const url = this.convexUrl;
    const baseDelay = 3000;
    try {
      // All args are controlled internal values — not user input.
      execFileSync(
        CONVEX_CLI,
        [
          'run',
          'testing/utilities:clearAll',
          '--admin-key',
          ADMIN_KEY,
          '--url',
          url,
        ],
        {stdio: 'inherit', cwd: PROJECT_ROOT},
      );
    } catch (err: unknown) {
      console.error(
        `[${this.instanceId}] clearAll attempt ${attempt}/${maxRetries} failed.`,
      );
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(
          `[${this.instanceId}] Retrying clearAll in ${delay / 1000} seconds...`,
        );
        await sleep(delay);
        return this._runClearAllWithRetry(attempt + 1, maxRetries);
      }
      throw err;
    }
  }

  private async _warmBetterAuthIndexes(
    attempt = 1,
    maxAttempts = 15,
  ): Promise<void> {
    if (attempt === 1) {
      console.log(
        `[${this.instanceId}] Warming up Better Auth component indexes...`,
      );
    }
    const url = this.convexUrl;
    try {
      // All args are controlled internal values — not user input.
      execFileSync(
        CONVEX_CLI,
        [
          'run',
          '--admin-key',
          ADMIN_KEY,
          '--url',
          url,
          'testing/users:verifyAccountAndUser',
          '{"email":"warmup-probe@nonexistent.test"}',
        ],
        {stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000, cwd: PROJECT_ROOT},
      );
      console.log(`[${this.instanceId}] Component indexes ready.`);
    } catch {
      if (attempt === maxAttempts) {
        console.warn(
          `[${this.instanceId}] WARNING: Component warm-up timed out after ${maxAttempts} attempts, proceeding anyway.`,
        );
        return;
      }
      await sleep(1000);
      return this._warmBetterAuthIndexes(attempt + 1, maxAttempts);
    }
  }

  private _deleteBackendState(): void {
    const dbSpec = this._dbSpec();
    const storageDir = this._storageDir();

    // Remove storage directories
    const storageDirs = [
      path.join(LOCAL_DIR, 'convex_local_storage'),
      storageDir,
    ];
    for (const dir of storageDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, {recursive: true, force: true});
          console.log(
            `[${this.instanceId}] Deleted persisted local storage: ${dir}`,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[${this.instanceId}] Failed to delete local storage: ${msg}`,
        );
      }
    }

    // Remove SQLite files
    const dbFilesToClean = dbSpec ? [dbSpec] : ['convex_local_backend.sqlite3'];
    for (const dbFile of dbFilesToClean) {
      for (const suffix of ['', '-wal', '-shm'] as const) {
        const fullPath = path.join(LOCAL_DIR, dbFile + suffix);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(
              `[${this.instanceId}] Deleted stale DB file: ${dbFile}${suffix}`,
            );
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[${this.instanceId}] Failed to delete ${dbFile}${suffix}: ${msg}`,
          );
        }
      }
    }
  }

  /**
   * Stop a backend that is already running at the current ports.
   * Reads the pid from the workspace file if not tracked in memory.
   */
  private async _stopExisting(): Promise<void> {
    const pidFile = path.join(this.workspaceDir, 'pid');
    let existingPid: number | null = this._pid;

    if (existingPid === null && fs.existsSync(pidFile)) {
      const raw = fs.readFileSync(pidFile, 'utf-8').trim();
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) existingPid = parsed;
    }

    if (existingPid !== null) {
      try {
        await treeKill(existingPid);
        await sleep(1000);
      } catch {
        // Ignore — process may already be gone
      }
    }

    // Poll until the port is actually free
    const url = this.convexUrl;
    let stillRunning = await healthCheck(url, 1000);
    let attempts = 0;
    while (stillRunning && attempts < 10) {
      await sleep(500);
      stillRunning = await healthCheck(url, 1000);
      attempts++;
    }

    this._pid = null;
    this._handle = null;
    this._exited = false;
    this._exitCode = null;
  }

  private async _setIsTest(): Promise<void> {
    const url = this.convexUrl;
    const value = this.mode === 'e2e' ? 'true' : 'false';
    try {
      await setOneEnvVar('IS_TEST', value, url);
      console.log(`[${this.instanceId}] Set IS_TEST=${value}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.instanceId}] Failed to set IS_TEST: ${msg}`);
    }
  }

  private async _setSiteUrl(appPort: number): Promise<void> {
    const url = this.convexUrl;
    const siteUrl = `http://127.0.0.1:${appPort}`;
    try {
      await setOneEnvVar('SITE_URL', siteUrl, url);
      console.log(`[${this.instanceId}] Set SITE_URL=${siteUrl}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.instanceId}] Failed to set SITE_URL: ${msg}`);
    }
  }

  /** Ensure IS_TEST=false for dev backends to prevent contamination. */
  private async _guardIsTestFalse(): Promise<void> {
    const url = this.convexUrl;
    try {
      await setOneEnvVar('IS_TEST', 'false', url);
      console.log(`[${this.instanceId}] Set IS_TEST=false`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.instanceId}] Failed to set IS_TEST=false: ${msg}`);
    }
  }

  private _writeWorkspaceFiles(appPort: number): void {
    const convexUrl = this.convexUrl;
    const convexSiteUrl = this.convexSiteUrl;
    const pid = this._pid;

    // Write instance workspace dir files
    fs.mkdirSync(this.workspaceDir, {recursive: true});
    fs.writeFileSync(
      path.join(this.workspaceDir, 'convex-url'),
      convexUrl,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(this.workspaceDir, 'convex-site-url'),
      convexSiteUrl,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(this.workspaceDir, 'admin-key'),
      ADMIN_KEY,
      'utf-8',
    );
    if (pid !== null) {
      fs.writeFileSync(
        path.join(this.workspaceDir, 'pid'),
        String(pid),
        'utf-8',
      );
    }
    fs.writeFileSync(
      path.join(this.workspaceDir, 'frontend-port'),
      String(appPort),
      'utf-8',
    );

    // Write compat files to .convex-local/ root (for scripts that read these paths)
    fs.mkdirSync(LOCAL_DIR, {recursive: true});
    if (this.mode === 'e2e') {
      fs.writeFileSync(
        path.join(LOCAL_DIR, '.e2e-convex-url'),
        convexUrl,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(LOCAL_DIR, '.e2e-convex-site-url'),
        convexSiteUrl,
        'utf-8',
      );
      fs.writeFileSync(
        path.join(LOCAL_DIR, '.e2e-port'),
        String(appPort),
        'utf-8',
      );
    }
    fs.writeFileSync(path.join(LOCAL_DIR, '.admin-key'), ADMIN_KEY, 'utf-8');
  }
}
