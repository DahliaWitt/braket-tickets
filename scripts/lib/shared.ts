import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {execSync, execFile, execFileSync, spawn} from 'child_process';
import type {ChildProcess} from 'child_process';
import {generateKeyPairSync} from 'crypto';
import {fileURLToPath} from 'url';
import treeKillLib from 'tree-kill';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Hardcoded admin key for the local Convex backend only.
 * This is intentionally committed — it has no production access.
 * It is generated for CONVEX_LOCAL_BACKEND_INSTANCE_NAME and
 * CONVEX_LOCAL_BACKEND_INSTANCE_SECRET below.
 */
export const ADMIN_KEY =
  process.env['CONVEX_LOCAL_BACKEND_ADMIN_KEY'] ??
  'carnitas|019cb1e9d2a276fed585622e93d15bb5a3a61d278d6d4ca11b0b7a3f87e5c3635843e8c5e7';

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const BACKEND_ROOT = path.join(PROJECT_ROOT, 'backend');
export const CONVEX_CLI = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  'convex',
);

export const LOCAL_DIR = path.join(PROJECT_ROOT, '.convex-local');
export const DEFAULT_CONVEX_LOCAL_BACKEND_RELEASE =
  'precompiled-2026-07-03-b7209ce';
export const CONVEX_LOCAL_BACKEND_RELEASE =
  process.env['CONVEX_LOCAL_BACKEND_RELEASE'] ??
  DEFAULT_CONVEX_LOCAL_BACKEND_RELEASE;
export const CONVEX_LOCAL_BACKEND_INSTANCE_NAME =
  process.env['CONVEX_LOCAL_BACKEND_INSTANCE_NAME'] ?? 'carnitas';
export const CONVEX_LOCAL_BACKEND_INSTANCE_SECRET =
  process.env['CONVEX_LOCAL_BACKEND_INSTANCE_SECRET'] ??
  '4361726e697461732c206c69746572616c6c79206d65616e696e6720226c6974';

// ── sleep ──────────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── isLocalUrl ─────────────────────────────────────────────────────────────────

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url);
}

// ── findEphemeralPort ──────────────────────────────────────────────────────────

export function findEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() =>
          reject(new Error('Could not determine ephemeral port')),
        );
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ── healthCheck ────────────────────────────────────────────────────────────────

export function healthCheck(url: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/version',
        method: 'GET',
      },
      (res) => {
        resolve(res.statusCode === 200);
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('backend health check timeout'));
    });
    request.on('error', () => {
      resolve(false);
    });
    request.end();
  });
}

// ── treeKill ───────────────────────────────────────────────────────────────────

export function treeKill(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKillLib(pid, 'SIGTERM', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// ── convexRun ──────────────────────────────────────────────────────────────────

/** Parse the JSON return value out of `convex run` stdout. */
function parseConvexRunOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;

  // Try parsing the whole output first (works for single-line returns)
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to multi-line extraction
  }

  // Find the last closing brace/bracket and extract the JSON block
  const lastClose = Math.max(
    trimmed.lastIndexOf('}'),
    trimmed.lastIndexOf(']'),
  );
  if (lastClose === -1) {
    // Try parsing as a primitive (string, number, boolean, null)
    try {
      const lastLine = trimmed.split('\n').pop();
      return lastLine ? JSON.parse(lastLine.trim()) : undefined;
    } catch {
      return undefined;
    }
  }

  const closeChar = trimmed[lastClose] as '}' | ']';
  const openChar = closeChar === '}' ? '{' : '[';

  // Scan backwards to find the matching opener
  let depth = 0;
  for (let i = lastClose; i >= 0; i--) {
    if (trimmed[i] === closeChar) depth++;
    if (trimmed[i] === openChar) depth--;
    if (depth === 0) {
      try {
        return JSON.parse(trimmed.slice(i, lastClose + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export interface ConvexRunOpts {
  url?: string;
  adminKey?: string;
  cwd?: string;
}

export function convexRun(
  fnName: string,
  args?: Record<string, unknown>,
  opts?: ConvexRunOpts,
): unknown {
  const cmd: string[] = ['run', fnName];
  if (args !== undefined) {
    cmd.push(JSON.stringify(args));
  }
  if (opts?.url) {
    cmd.push('--url', opts.url);
  }
  if (opts?.adminKey) {
    cmd.push('--admin-key', opts.adminKey);
  }

  const result = execFileSync(CONVEX_CLI, cmd, {
    cwd: opts?.cwd ?? PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return parseConvexRunOutput(result);
}

// ── ensureDopplerEnv ───────────────────────────────────────────────────────────

/**
 * Replaces scripts/run-with-local-env.sh.
 *
 * If CI or DOPPLER_INJECTED is set for the requested config, returns
 * immediately.
 * Otherwise, re-executes the current process through `doppler run`.
 *
 * CRITICAL: Sets DOPPLER_INJECTED=1 BEFORE exec'ing into doppler run to
 * prevent infinite recursion (~19 levels, hitting API rate limits).
 *
 * Shell features are required here for argument passing.
 * Input is controlled (process.execPath, argv, project/config from env with
 * safe defaults) — no user-supplied strings are interpolated without sanitization.
 */
export function ensureDopplerEnv(): void {
  const dopplerProject = process.env['DOPPLER_PROJECT'] ?? 'braket-tickets';
  const dopplerConfig = process.env['DOPPLER_CONFIG'] ?? 'local';
  const activeDopplerConfig = process.env['DOPPLER_ACTIVE_CONFIG'];

  if (
    process.env['CI'] ||
    (process.env['DOPPLER_INJECTED'] &&
      (activeDopplerConfig === undefined ||
        activeDopplerConfig === dopplerConfig))
  ) {
    return;
  }

  // Verify doppler is in PATH
  try {
    execFileSync('doppler', ['--version'], {stdio: 'pipe'});
  } catch {
    process.stderr.write(
      'ERROR: Doppler CLI not found and DOPPLER_INJECTED is not set.\n\n' +
        'Two options:\n' +
        "  1. Install Doppler and run 'doppler login' (core team)\n" +
        '  2. Use .env.local (external contributors):\n' +
        '       cp .env.example .env.local\n' +
        '       set -a; source .env.local; set +a\n' +
        '       pnpm dev\n\n' +
        'See docs/environment.md for details.\n',
    );
    process.exit(1);
  }

  // CRITICAL: Set the re-entry guard BEFORE exec'ing into doppler run.
  // Without this, validate.sh → doppler run → validate.sh creates ~19-level
  // recursion, each level adding a doppler API call (rate limit: 120 req/min).
  process.env['DOPPLER_INJECTED'] = '1';
  process.env['DOPPLER_ACTIVE_CONFIG'] = dopplerConfig;

  // Shell is required to pass process.argv correctly through doppler run.
  // All interpolated values are controlled: process.execPath (Node.js binary
  // path), dopplerProject/dopplerConfig (env vars with safe defaults, not
  // user input), and process.argv (the current process arguments).
  const argv = process.argv
    .slice(1)
    .map((a) => JSON.stringify(a))
    .join(' ');
  const execArgv = process.execArgv.map((a) => JSON.stringify(a)).join(' ');
  const cmd =
    `doppler run --project ${dopplerProject} --config ${dopplerConfig} -- ` +
    `${process.execPath} ${execArgv} ${argv}`;
  try {
    // execSync is acceptable here: shell features are required for argument
    // passing and all interpolated values are controlled internal variables.
    execSync(cmd, {stdio: 'inherit'});
  } catch (err: unknown) {
    const exitCode =
      err !== null &&
      typeof err === 'object' &&
      'status' in err &&
      typeof (err as {status: unknown}).status === 'number'
        ? (err as {status: number}).status
        : 1;
    process.exit(exitCode);
  }
  // doppler run replaces this process; if we reach here, exit cleanly
  process.exit(0);
}

// ── buildEnv ───────────────────────────────────────────────────────────────────

interface BackendPorts {
  convex: number;
  convexSite: number;
  app: number;
}

interface E2EJwtKeyMaterial {
  privateKey: string;
  jwks: string;
}

let e2eJwtKeyMaterial: E2EJwtKeyMaterial | null = null;

function getE2EJwtKeyMaterial(): E2EJwtKeyMaterial {
  if (e2eJwtKeyMaterial !== null) {
    return e2eJwtKeyMaterial;
  }

  const {privateKey, publicKey} = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const publicJwk = publicKey.export({format: 'jwk'});

  if (typeof publicJwk.n !== 'string' || typeof publicJwk.e !== 'string') {
    throw new Error('Generated E2E RSA key is missing public JWK parameters');
  }

  const material: E2EJwtKeyMaterial = {
    privateKey: String(
      privateKey.export({
        format: 'pem',
        type: 'pkcs8',
      }),
    ),
    jwks: JSON.stringify({
      keys: [
        {
          kty: 'RSA',
          n: publicJwk.n,
          e: publicJwk.e,
          kid: 'e2e-runtime-key-1',
          alg: 'RS256',
          use: 'sig',
        },
      ],
    }),
  };

  e2eJwtKeyMaterial = material;

  return material;
}

/**
 * Assembles env vars to configure the Convex backend.
 *
 * - mode 'e2e': includes runtime-only test JWT key material and matching JWKS
 * - mode 'dev': passes through real env var keys from process.env
 */
export function buildEnv(
  mode: 'dev' | 'e2e',
  ports: BackendPorts,
): Record<string, string> {
  if (mode === 'e2e') {
    const jwtKeyMaterial = getE2EJwtKeyMaterial();

    return {
      IS_TEST: 'true',
      SITE_URL: `http://127.0.0.1:${ports.app}`,
      E2E_CONVEX_SITE_URL: `http://127.0.0.1:${ports.convexSite}`,
      SMTP_HOST: process.env['SMTP_HOST'] ?? 'smtp.ethereal.email',
      SMTP_PORT: process.env['SMTP_PORT'] ?? '587',
      SMTP_USER: process.env['SMTP_USER'] ?? '',
      SMTP_PASS: process.env['SMTP_PASS'] ?? '',
      SMTP_FROM: process.env['SMTP_FROM'] ?? '',
      EMAIL_FROM: process.env['EMAIL_FROM'] ?? '',
      EMAIL_REPLY_TO: process.env['EMAIL_REPLY_TO'] ?? '',
      RESEND_API_KEY: process.env['RESEND_API_KEY'] ?? '',
      RESEND_WEBHOOK_SECRET: process.env['RESEND_WEBHOOK_SECRET'] ?? '',
      JWT_PRIVATE_KEY: jwtKeyMaterial.privateKey,
      JWKS: jwtKeyMaterial.jwks,
      BETTER_AUTH_SECRET:
        process.env['BETTER_AUTH_SECRET'] ??
        'test-secret-for-local-e2e-only-not-secure',
      TOKEN_DIGEST_SECRET:
        process.env['TOKEN_DIGEST_SECRET'] ??
        'test-token-digest-secret-for-local-e2e-only-not-secure',
    };
  }

  // mode === 'dev'
  const env: Record<string, string> = {
    SITE_URL: `http://127.0.0.1:${ports.app}`,
    // Better Auth expects a stable site URL for /api/auth/* endpoints.
    CONVEX_SITE_URL: `http://127.0.0.1:${ports.convexSite}`,
    AUTH_BASE_URL: `http://127.0.0.1:${ports.convexSite}`,
    // Avoid surprising auth boot failures when BETTER_AUTH_SECRET isn't set locally.
    BETTER_AUTH_SECRET:
      process.env['BETTER_AUTH_SECRET'] ??
      'local-dev-only-not-secure-change-me',
    // Declared as required in convex.config.ts, so it must exist before deploy.
    TOKEN_DIGEST_SECRET:
      process.env['TOKEN_DIGEST_SECRET'] ??
      'local-dev-token-digest-secret-not-secure-change-me',
  };

  // Mirror scripts/sync-convex-env.js, but only set keys that exist to avoid
  // clobbering previously configured values.
  const passthroughKeys = [
    'ALLOW_LOCALHOST_CORS',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
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

  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (typeof value === 'string' && value !== '') {
      env[key] = value;
    }
  }

  return env;
}

// ── startBackendBinary ─────────────────────────────────────────────────────────

export interface BackendBinaryHandle {
  process: ChildProcess;
  logFile: string;
}

const SUPPORTED_LOCAL_NODE_MAJORS = new Set([18, 20, 22, 24]);

function parseNodeMajor(version: string): number | null {
  const match = /^v(\d+)\./.exec(version.trim());
  return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

function isSupportedLocalNodeVersion(version: string): boolean {
  const major = parseNodeMajor(version);
  return major !== null && SUPPORTED_LOCAL_NODE_MAJORS.has(major);
}

function candidateNodePaths(): string[] {
  const home = os.homedir();
  const candidates = new Set<string>();

  candidates.add(process.execPath);

  try {
    const whichNode = execFileSync('which', ['node'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (whichNode) candidates.add(whichNode);
  } catch {
    // ignore
  }

  for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
    for (const major of [24, 22, 20, 18]) {
      candidates.add(path.join(prefix, `node@${major}`, 'bin', 'node'));
    }
  }

  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir).sort().reverse();
      for (const version of versions) {
        candidates.add(path.join(nvmVersionsDir, version, 'bin', 'node'));
      }
    } catch {
      // ignore
    }
  }

  return [...candidates];
}

function findSupportedLocalNodeBinary(): {
  nodePath: string;
  version: string;
} | null {
  for (const nodePath of candidateNodePaths()) {
    if (!fs.existsSync(nodePath)) continue;
    try {
      const version = execFileSync(nodePath, ['-v'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (isSupportedLocalNodeVersion(version)) {
        return {nodePath, version};
      }
    } catch {
      // ignore candidate
    }
  }
  return null;
}

/**
 * Detects OS/arch and returns the correct convex-local-backend zip package name.
 * Returns null if the platform is unsupported.
 */
function detectBackendPackage(): string | null {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'darwin') {
    if (arch === 'arm64')
      return 'convex-local-backend-aarch64-apple-darwin.zip';
    if (arch === 'x64') return 'convex-local-backend-x86_64-apple-darwin.zip';
  } else if (platform === 'linux' && arch === 'x64') {
    return 'convex-local-backend-x86_64-unknown-linux-gnu.zip';
  }
  return null;
}

/**
 * Downloads the convex-local-backend binary into targetDir.
 * Skips download if the pinned binary already exists and is executable.
 */
async function downloadBackendBinary(targetDir: string): Promise<string> {
  const pkg = detectBackendPackage();
  if (!pkg) {
    throw new Error(
      'Download or build the convex-local-backend: https://github.com/get-convex/convex-backend',
    );
  }

  fs.mkdirSync(targetDir, {recursive: true});

  const binaryPath = path.join(targetDir, 'convex-local-backend');
  const releaseMarkerPath = path.join(
    targetDir,
    'convex-local-backend.release',
  );

  if (
    fs.existsSync(binaryPath) &&
    (fs.statSync(binaryPath).mode & 0o111) !== 0 &&
    fs.existsSync(releaseMarkerPath) &&
    fs.readFileSync(releaseMarkerPath, 'utf-8').trim() ===
      CONVEX_LOCAL_BACKEND_RELEASE
  ) {
    // Already downloaded and executable
    return binaryPath;
  }

  const zipPath = path.join(targetDir, pkg);
  const downloadUrl = `https://github.com/get-convex/convex-backend/releases/download/${CONVEX_LOCAL_BACKEND_RELEASE}/${pkg}`;

  console.log(
    `Downloading convex-local-backend ${CONVEX_LOCAL_BACKEND_RELEASE} (${pkg})...`,
  );
  execFileSync(
    'curl',
    [
      '-fL',
      '--retry',
      '3',
      '--retry-delay',
      '2',
      '--connect-timeout',
      '15',
      '--max-time',
      '300',
      '-o',
      zipPath,
      downloadUrl,
    ],
    {stdio: 'inherit'},
  );

  execFileSync('unzip', ['-o', zipPath, '-d', targetDir], {stdio: 'inherit'});
  fs.chmodSync(binaryPath, 0o755);
  fs.writeFileSync(releaseMarkerPath, `${CONVEX_LOCAL_BACKEND_RELEASE}\n`);

  return binaryPath;
}

/**
 * On Linux, probes the binary for GLIBC compatibility errors.
 * Returns true if Docker fallback should be used.
 */
function shouldUseDocker(binaryPath: string): boolean {
  if (os.platform() !== 'linux') return false;

  const mode = process.env['CONVEX_LOCAL_BACKEND_MODE'] ?? 'auto';
  if (mode === 'docker') return true;
  if (mode !== 'auto') return false;

  try {
    // execFileSync throws if exit code is non-zero; capture both stdout+stderr
    execFileSync(binaryPath, ['--version'], {stdio: 'pipe'});
    return false;
  } catch (err: unknown) {
    // Check stderr/stdout of the failed process for GLIBC errors
    const output =
      err !== null && typeof err === 'object'
        ? [
            (err as {stdout?: unknown}).stdout,
            (err as {stderr?: unknown}).stderr,
          ]
            .filter(Boolean)
            .join('\n')
        : '';
    if (/GLIBC|GLIBCXX|CXXABI/.test(output)) {
      console.log(
        'convex-local-backend requires newer host libraries; using Docker fallback.',
      );
      return true;
    }
    return false;
  }
}

/**
 * Starts the convex-local-backend via Docker container.
 * Only supported on Linux (DinD / CI environments).
 *
 * Shell features (glob, redirection, inline sh -c scripts) are required here.
 * All interpolated values are controlled internal variables — not user input.
 */
function startWithDocker(
  binaryPath: string,
  args: string[],
  containerName: string,
  logFile: string,
): ChildProcess {
  if (os.platform() !== 'linux') {
    throw new Error('Docker fallback is only supported on Linux.');
  }

  // Verify docker is available
  try {
    execFileSync('docker', ['--version'], {stdio: 'pipe'});
  } catch {
    throw new Error(
      `Docker is required for CONVEX_LOCAL_BACKEND_MODE=docker but was not found.`,
    );
  }

  const cwd = PROJECT_ROOT;

  // Remove any existing container with this name
  // Shell required: redirection and || are shell features.
  // containerName is internal (hostname + port), not user input.
  execSync(`docker rm -f ${containerName} >/dev/null 2>&1 || true`, {
    cwd,
    stdio: 'pipe',
  });

  // In DinD (socket-mount) setups, container removal can be async.
  // Wait until the name is actually freed before docker create.
  for (let i = 0; i < 5; i++) {
    try {
      execFileSync('docker', ['inspect', containerName], {stdio: 'pipe'});
      // Container still exists — wait and retry
      execFileSync('sleep', ['1']);
    } catch {
      break; // inspect failed → container is gone
    }
  }

  // Ensure stale local backend state is removed even if previous runs wrote
  // root-owned files through Docker fallback.
  // Shell required: glob expansion for *.sqlite3 wildcard patterns.
  // cwd is PROJECT_ROOT — controlled, not user input.
  execSync(
    `docker run --rm -v "${cwd}/.convex-local":/workspace ubuntu:24.04 sh -c '` +
      `rm -rf /workspace/convex_local_storage /workspace/convex_local_storage_* ` +
      `/workspace/convex_local_backend.sqlite3 ` +
      `/workspace/convex_local_backend.sqlite3-wal ` +
      `/workspace/convex_local_backend.sqlite3-shm ` +
      `/workspace/convex_shard_*.sqlite3 ` +
      `/workspace/convex_shard_*.sqlite3-wal ` +
      `/workspace/convex_shard_*.sqlite3-shm` +
      `' >/dev/null 2>&1 || true`,
    {cwd, stdio: 'pipe'},
  );

  // Network: when the runner itself is a Docker container (DinD via socket
  // mount), --network host puts ports on the real host, which is unreachable
  // from the runner at 127.0.0.1. Share the runner container's network
  // namespace instead so port 3210 stays local.
  const isInDocker = fs.existsSync('/.dockerenv');
  const networkArg = isInDocker ? `container:${os.hostname()}` : 'host';

  // Use tmpfs for the database working directory to avoid SQLite
  // SQLITE_READONLY_DBMOVED (error 1032) on Docker bind mounts.
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;

  // docker create: shell needed to compose the full argument list cleanly.
  // All values (containerName, networkArg, uid, gid, cwd, args) are controlled
  // internal variables — not user-supplied strings.
  execSync(
    [
      'docker create',
      `--name ${containerName}`,
      `--network ${networkArg}`,
      `--user ${uid}:${gid}`,
      `-v "${cwd}/.convex-local":/workspace`,
      '--tmpfs /data:rw,exec,size=1g',
      '-w /data',
      'ubuntu:24.04',
      '/opt/convex-local-backend',
      ...args,
    ].join(' '),
    {cwd, stdio: 'pipe'},
  );

  // Copy the binary into the container
  execFileSync(
    'docker',
    ['cp', binaryPath, `${containerName}:/opt/convex-local-backend`],
    {stdio: 'pipe'},
  );

  // The backend's node executor needs Node.js to analyze deployed functions.
  // Copy to both common locations in case the backend hardcodes a path.
  try {
    const nodeBin = execFileSync('which', ['node'], {encoding: 'utf-8'}).trim();
    if (nodeBin) {
      execFileSync(
        'docker',
        ['cp', nodeBin, `${containerName}:/usr/local/bin/node`],
        {
          stdio: 'pipe',
        },
      );
      execFileSync(
        'docker',
        ['cp', nodeBin, `${containerName}:/usr/bin/node`],
        {
          stdio: 'pipe',
        },
      );
    }
  } catch {
    // node not found — not fatal
  }

  // Copy CA certs from the runner (not a bind mount — in DinD via socket
  // mount, bind paths reference the Docker host, not the runner container).
  if (fs.existsSync('/etc/ssl/certs')) {
    execFileSync(
      'docker',
      ['cp', '/etc/ssl/certs', `${containerName}:/etc/ssl/`],
      {
        stdio: 'pipe',
      },
    );
  }

  const logStream = fs.createWriteStream(logFile, {flags: 'a'});
  const proc = spawn('docker', ['start', '--attach', containerName], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  return proc;
}

/**
 * Downloads the convex-local-backend binary (if needed) and starts it.
 * On Linux with GLIBC issues, falls back to Docker.
 */
export async function startBackendBinary(
  port: number,
  sitePort: number,
  opts?: {dbSpec?: string; storageDir?: string},
): Promise<BackendBinaryHandle> {
  const binaryPath = await downloadBackendBinary(LOCAL_DIR);
  const logFile = path.join(LOCAL_DIR, `convex-local-backend-${port}.log`);

  const dbSpec = opts?.dbSpec ?? `convex_shard_${port}.sqlite3`;
  const storageDir =
    opts?.storageDir ?? path.join(LOCAL_DIR, `convex_local_storage_${port}`);

  const backendArgs = [
    '--port',
    String(port),
    '--site-proxy-port',
    String(sitePort),
    '--instance-secret',
    CONVEX_LOCAL_BACKEND_INSTANCE_SECRET,
    '--instance-name',
    CONVEX_LOCAL_BACKEND_INSTANCE_NAME,
    '--local-storage',
    storageDir,
    dbSpec,
  ];

  if (shouldUseDocker(binaryPath)) {
    const containerName =
      process.env['CONVEX_LOCAL_BACKEND_CONTAINER'] ??
      `convex-local-backend-${port}-${os.hostname()}`;

    const proc = startWithDocker(
      binaryPath,
      backendArgs,
      containerName,
      logFile,
    );
    return {process: proc, logFile};
  }

  // Native binary path: run from LOCAL_DIR so SQLite files land there
  const logStream = fs.createWriteStream(logFile, {flags: 'a'});
  const supportedNode = findSupportedLocalNodeBinary();
  const backendEnv: NodeJS.ProcessEnv = {...process.env};

  if (supportedNode !== null) {
    const nodeDir = path.dirname(supportedNode.nodePath);
    backendEnv['PATH'] = backendEnv['PATH']
      ? `${nodeDir}:${backendEnv['PATH']}`
      : nodeDir;
    console.log(
      `Using local Node runtime ${supportedNode.version} for Convex backend child process (${supportedNode.nodePath})`,
    );
  }

  const proc = spawn(binaryPath, backendArgs, {
    cwd: LOCAL_DIR,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  return {process: proc, logFile};
}

// ── setOneEnvVar ───────────────────────────────────────────────────────────────

/**
 * Sets a single Convex env var by piping the value via stdin to `convex env set`.
 * Returns the key name on success.
 */
export function setOneEnvVar(
  key: string,
  value: string,
  url: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile defaults to piped stdio; 'stdio' is not in its Options type.
    const child = execFile(
      CONVEX_CLI,
      ['env', 'set', key, '--admin-key', ADMIN_KEY, '--url', url],
      {cwd: PROJECT_ROOT},
      (error: Error | null) => (error ? reject(error) : resolve(key)),
    );
    child.stdin?.write(value);
    child.stdin?.end();
  });
}

// ── setAllEnvVars ──────────────────────────────────────────────────────────────

/**
 * Double-quotes a value for .env file syntax. Always quotes to avoid edge
 * cases with unquoted parsing (# as comments, whitespace trimming, etc.).
 * Escapes backslashes and double-quotes per the dotenv spec.
 */
function formatEnvValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Sets multiple Convex env vars in a single CLI call via `convex env set --from-file`.
 *
 * Env vars share a single system document, so sequential `env set` calls are
 * slow (~500ms each) and concurrent calls cause OCC failures. The `--from-file`
 * flag sets all vars atomically in one request.
 */
export async function setAllEnvVars(
  entries: [string, string][],
  url: string,
  label = 'backend',
): Promise<void> {
  if (entries.length === 0) return;
  console.log(`Setting ${entries.length} ${label} environment variables...`);

  const envContent = entries
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
    .join('\n');

  // Write to OS temp dir (not repo tree) to avoid leaking secrets on crash
  const tmpFile = path.join(
    os.tmpdir(),
    `.convex-env-bulk-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tmpFile, envContent, {mode: 0o600});

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        CONVEX_CLI,
        [
          'env',
          'set',
          '--from-file',
          tmpFile,
          '--force',
          '--admin-key',
          ADMIN_KEY,
          '--url',
          url,
        ],
        {cwd: PROJECT_ROOT},
        (error: Error | null) => (error ? reject(error) : resolve()),
      );
    });
    for (const [key] of entries) {
      console.log(`\u2714 Set ${key}`);
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Best-effort cleanup; OS cleans /tmp on reboot
    }
  }
}
