import {spawnSync} from 'node:child_process';

import {
  createAngularDefineArgs,
  type FrontendRuntimeMode,
} from './runtime-config';
import {syncHelpCenterShipping} from './help-center-shipping';

const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  process.stderr.write(
    'Usage: tsx ./scripts/run-ng-with-runtime.ts <ng-args...>\n',
  );
  process.exit(1);
}

function readConfiguration(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg.startsWith('--configuration=')) {
      return arg.slice('--configuration='.length);
    }

    if (arg === '--configuration' || arg === '-c') {
      return args[index + 1] ?? null;
    }
  }

  return null;
}

function resolveMode(args: string[]): FrontendRuntimeMode {
  const command = args[0];
  const configuration = readConfiguration(args);

  if (configuration === 'preview') return 'preview';
  if (configuration === 'production') return 'production';
  if (configuration === 'test') return 'test';
  if (configuration === 'e2e') return 'e2e';
  if (configuration === 'development') return 'development';

  if (command === 'build') {
    return 'production';
  }

  return 'development';
}

const mode = resolveMode(rawArgs);

syncHelpCenterShipping();

const result = spawnSync(
  'npx',
  ['ng', ...rawArgs, ...createAngularDefineArgs(mode, process.env)],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
