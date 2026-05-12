import * as fs from 'node:fs';
import {execSync} from 'node:child_process';
import {resolveValidationBaseRef} from './lib/validation-base';

export interface FrontendBuildImpact {
  needsBuild: boolean;
  reasons: string[];
}

const EXPLICIT_BUILD_TRIGGERS = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'frontend/package.json',
  'frontend/angular.json',
  'frontend/tsconfig.json',
  'frontend/tsconfig.app.json',
  'frontend/src/index.html',
  'frontend/public/_headers',
  'frontend/public/_routes.json',
  'scripts/build-docs-manifest.ts',
  'scripts/with-env.ts',
]);

const GENERATED_OR_IGNORED_PREFIXES = [
  'frontend/.angular/',
  'frontend/dist/',
  'coverage/',
  'reports/',
];

const GENERATED_OR_IGNORED_FILES = new Set([
  'frontend/public/docs/manifest.json',
]);

const FRONTEND_BUILD_SCRIPT_PREFIXES = [
  'frontend/functions/',
  'frontend/scripts/',
  'shared/',
];

const FRONTEND_BUILD_CONTENT_PREFIXES = ['frontend/src/', 'frontend/public/'];

const NON_BUILD_PREFIXES = [
  'backend/',
  'docs/',
  '.github/',
  '.claude/',
  '.agents/',
  '.zed/',
  'frontend/.storybook/',
  'frontend/e2e/',
  'frontend/playwright/',
  'frontend/src/testing/',
];

const NON_BUILD_EXACT_FILES = new Set([
  '.gitignore',
  'AGENTS.md',
  '.mcp.json',
  '.vscode/mcp.json',
  'opencode.json',
  'vitest.config.ts',
  'scripts/validate.sh',
  'scripts/e2e.ts',
  'scripts/e2e-run.ts',
  'scripts/e2e-serve.ts',
  'scripts/run-affected-e2e.ts',
  'frontend/vitest.config.ts',
  'frontend/playwright.config.ts',
  'frontend/src/test-setup.ts',
  'frontend/eslint.config.mjs',
  'frontend/tsconfig.spec.json',
  'frontend/tsconfig.storybook.json',
  'frontend/verification.png',
]);

function isFrontendTestOnlyFile(file: string): boolean {
  return (
    file.startsWith('frontend/e2e/') ||
    file.endsWith('.spec.ts') ||
    file.endsWith('.stories.ts') ||
    file.endsWith('.harness.ts')
  );
}

function isGeneratedOrIgnoredFile(file: string): boolean {
  return (
    GENERATED_OR_IGNORED_FILES.has(file) ||
    GENERATED_OR_IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

export function filterGeneratedOrIgnoredFiles(
  changedFiles: string[],
): string[] {
  return changedFiles.filter((file) => !isGeneratedOrIgnoredFile(file));
}

function requiresFrontendBuild(file: string): boolean {
  if (file === '') return false;
  if (isGeneratedOrIgnoredFile(file)) return false;
  if (EXPLICIT_BUILD_TRIGGERS.has(file)) return true;
  if (NON_BUILD_EXACT_FILES.has(file)) return false;
  if (NON_BUILD_PREFIXES.some((prefix) => file.startsWith(prefix)))
    return false;
  if (FRONTEND_BUILD_SCRIPT_PREFIXES.some((prefix) => file.startsWith(prefix)))
    return true;

  if (
    FRONTEND_BUILD_CONTENT_PREFIXES.some((prefix) => file.startsWith(prefix))
  ) {
    return !isFrontendTestOnlyFile(file);
  }

  if (file.startsWith('scripts/')) {
    return false;
  }

  if (file.startsWith('frontend/')) {
    return true;
  }

  return false;
}

export function determineFrontendBuildRequirement(
  changedFiles: string[],
): FrontendBuildImpact {
  const reasons = changedFiles.filter(requiresFrontendBuild);

  return {
    needsBuild: reasons.length > 0,
    reasons,
  };
}

function splitLines(raw: string): string[] {
  return raw
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function shell(command: string): string[] {
  return splitLines(
    execSync(command, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}),
  );
}

export function getLocalChangedFiles(): string[] {
  const changed = new Set<string>();

  for (const file of shell(
    'git diff --cached --name-only --diff-filter=ACMR',
  )) {
    changed.add(file);
  }
  for (const file of shell('git diff --name-only --diff-filter=ACMR')) {
    changed.add(file);
  }
  for (const file of shell('git ls-files --others --exclude-standard')) {
    changed.add(file);
  }

  return filterGeneratedOrIgnoredFiles(Array.from(changed)).sort();
}

export function getBranchChangedFiles(): string[] {
  const baseRef = resolveValidationBaseRef();

  try {
    execSync(`git rev-parse --verify ${baseRef}`, {stdio: 'ignore'});
    return shell(`git diff --name-only ${baseRef}...HEAD`);
  } catch {
    return shell('git diff --name-only HEAD^ HEAD');
  }
}

function getCiChangedFiles(): string[] {
  const eventName = process.env['GITHUB_EVENT_NAME'];
  const eventPath = process.env['GITHUB_EVENT_PATH'];

  if (!eventName || !eventPath) {
    return getBranchChangedFiles();
  }

  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as {
      before?: string;
      after?: string;
      pull_request?: {
        base?: {sha?: string};
        head?: {sha?: string};
      };
    };

    if (eventName === 'pull_request') {
      const baseSha = event.pull_request?.base?.sha;
      const headSha =
        event.pull_request?.head?.sha ?? process.env['GITHUB_SHA'];
      if (baseSha && headSha) {
        return shell(`git diff --name-only ${baseSha}...${headSha}`);
      }
    }

    if (eventName === 'push') {
      const before = event.before;
      const after = event.after ?? process.env['GITHUB_SHA'];
      if (before && after && !/^0+$/.test(before)) {
        return shell(`git diff --name-only ${before} ${after}`);
      }
    }
  } catch {
    return getBranchChangedFiles();
  }

  return getBranchChangedFiles();
}

export function getChangedFilesForValidation(): string[] {
  const localChangedFiles = getLocalChangedFiles();
  if (localChangedFiles.length > 0) {
    return localChangedFiles;
  }

  if (process.env['CI']) {
    return getCiChangedFiles();
  }

  return getBranchChangedFiles();
}

function runCli(): void {
  const changedFiles = getChangedFilesForValidation();
  const impact = determineFrontendBuildRequirement(changedFiles);

  if (process.argv.includes('--decision')) {
    process.stdout.write(impact.needsBuild ? 'run\n' : 'skip\n');
    process.exit(0);
  }

  if (process.argv.includes('--reasons')) {
    if (impact.reasons.length === 0) {
      process.stdout.write('No frontend build required.\n');
    } else {
      process.stdout.write(`${impact.reasons.join('\n')}\n`);
    }
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify(
      {
        changedFiles,
        needsBuild: impact.needsBuild,
        reasons: impact.reasons,
      },
      null,
      2,
    ) + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
