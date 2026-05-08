import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const TRACKED_CONVEX_GENERATED_FILES = [
  'convex/_generated/api.d.ts',
  'convex/_generated/api.js',
  'convex/_generated/dataModel.d.ts',
  'convex/_generated/server.d.ts',
  'convex/_generated/server.js',
] as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');

type CommandRunner = (command: string, args: string[]) => string;

type FileReader = (path: string) => string;

export function collectChangedFiles(
  beforeContents: Record<string, string>,
  afterContents: Record<string, string>,
): string[] {
  return TRACKED_CONVEX_GENERATED_FILES.filter(
    (file) => beforeContents[file] !== afterContents[file],
  );
}

export function checkConvexGeneratedFreshness(run: CommandRunner): {
  ok: boolean;
  changedFiles: string[];
};
export function checkConvexGeneratedFreshness(
  run: CommandRunner,
  readFile: FileReader,
): {
  ok: boolean;
  changedFiles: string[];
} {
  const beforeContents = Object.fromEntries(
    TRACKED_CONVEX_GENERATED_FILES.map((file) => [file, readFile(file)]),
  ) as Record<string, string>;

  run('pnpm', ['convex', 'codegen', '--typecheck', 'disable']);

  const afterContents = Object.fromEntries(
    TRACKED_CONVEX_GENERATED_FILES.map((file) => [file, readFile(file)]),
  ) as Record<string, string>;
  const changedFiles = collectChangedFiles(beforeContents, afterContents);

  return {
    ok: changedFiles.length === 0,
    changedFiles,
  };
}

function runCommand(command: string, args: string[]): string {
  if (!process.env['CONVEX_DEPLOYMENT']) {
    const workspaceEnvPath = resolve(REPO_ROOT, '.env.local');
    if (existsSync(workspaceEnvPath)) {
      process.loadEnvFile(workspaceEnvPath);
    }
  }

  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: command === 'pnpm' ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  });
}

function readTrackedFile(path: string): string {
  return readFileSync(resolve(BACKEND_ROOT, path), 'utf8');
}

function main(): void {
  const result = checkConvexGeneratedFreshness(runCommand, readTrackedFile);

  if (result.ok) {
    console.log('Convex generated files are up to date.');
    return;
  }

  console.error('Convex generated files are stale after `convex codegen`.');
  console.error('Changed files:');
  for (const file of result.changedFiles) {
    console.error(`- ${file}`);
  }
  console.error('');
  console.error(
    'Run `pnpm convex codegen --typecheck disable` and commit the updated generated files.',
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined) {
  const entryUrl = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === entryUrl) {
    main();
  }
}
