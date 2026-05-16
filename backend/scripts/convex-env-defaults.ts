import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {execFileSync} from 'child_process';

const DEFAULTS_BY_TYPE = {
  dev: {
    ALLOW_LOCALHOST_CORS: 'true',
    RESEND_TEST_MODE: 'true',
  },
  preview: {
    ALLOW_LOCALHOST_CORS: 'false',
    RESEND_TEST_MODE: 'true',
  },
  prod: {
    ALLOW_LOCALHOST_CORS: 'false',
    RESEND_TEST_MODE: 'false',
  },
} as const;

type DeploymentType = keyof typeof DEFAULTS_BY_TYPE;

function parseType(): DeploymentType {
  const typeArgIndex = process.argv.indexOf('--type');
  const rawType =
    typeArgIndex === -1 ? 'dev' : (process.argv[typeArgIndex + 1] ?? '');
  if (rawType === 'dev' || rawType === 'preview' || rawType === 'prod') {
    return rawType;
  }
  throw new Error(`Unsupported --type ${JSON.stringify(rawType)}`);
}

function formatEnvFile(entries: Record<string, string>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n');
}

const type = parseType();
const tmpFile = path.join(
  os.tmpdir(),
  `braket-convex-env-defaults-${type}-${process.pid}.env`,
);

fs.writeFileSync(tmpFile, `${formatEnvFile(DEFAULTS_BY_TYPE[type])}\n`, {
  mode: 0o600,
});

try {
  execFileSync(
    'pnpm',
    [
      'convex',
      'env',
      'default',
      'set',
      '--type',
      type,
      '--from-file',
      tmpFile,
      '--force',
    ],
    {
      cwd: path.resolve(import.meta.dirname, '..', '..'),
      stdio: 'inherit',
    },
  );
} finally {
  fs.rmSync(tmpFile, {force: true});
}
