import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {resolveValidationBaseRef} from './lib/validation-base';

// Configuration
const E2E_DIR = 'frontend/e2e';
const GLOBAL_TRIGGERS: string[] = [
  'backend/convex/', // Backend changes affect everything
  'backend/package.json',
  'frontend/src/', // Frontend source code (conservative approach: run all)
  'package.json',
  'pnpm-lock.yaml',
  'angular.json',
  'playwright.config.ts',
];
const IGNORE_PATTERNS: string[] = [
  '.md',
  'docs/',
  '.husky/',
  '.github/',
  '.vscode/',
  '.cursor/',
  'LICENSE',
  '.gitignore',
];
// Files within global-trigger directories that are test-only infrastructure.
// Changes to these don't affect production behavior and shouldn't trigger ALL tests.
// If only these files changed, run only the directly-modified E2E specs (if any).
const TEST_ONLY_FILES: string[] = [
  'backend/convex/testing/',
  'scripts/e2e.ts',
  'scripts/run-affected-e2e.ts',
];

interface PushEvent {
  ref?: string;
  before?: string;
  after?: string;
}

interface PullRequestEvent {
  pull_request?: {
    base?: {sha?: string};
    head?: {sha?: string};
  };
}

type GithubEvent = PushEvent & PullRequestEvent;

function resolvePushCompareRef(event: PushEvent): string | null {
  const explicitRef = process.env['E2E_PUSH_BASE_REF']?.trim();
  if (explicitRef) {
    return explicitRef;
  }

  const eventRef = event.ref ?? process.env['GITHUB_REF'] ?? '';
  if (eventRef === 'refs/heads/develop') {
    // develop->main is maintained as a long-lived PR; compare against main for PR-accurate impact.
    return 'origin/main';
  }

  return null;
}

/**
 * Get list of changed files
 */
function getChangedFiles(): string[] {
  try {
    const eventName = process.env['GITHUB_EVENT_NAME'];
    const eventPath = process.env['GITHUB_EVENT_PATH'];

    if (eventName && eventPath && fs.existsSync(eventPath)) {
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as GithubEvent;

        if (eventName === 'push') {
          const before = event.before;
          const after = event.after ?? process.env['GITHUB_SHA'];
          const pushCompareRef = resolvePushCompareRef(event);

          if (pushCompareRef && after) {
            try {
              execSync(`git rev-parse --verify ${pushCompareRef}`, {stdio: 'ignore'});
              console.log(
                `Detecting push changes against '${pushCompareRef}...${after}'...`,
              );
              return execSync(`git diff --name-only ${pushCompareRef}...${after}`)
                .toString()
                .trim()
                .split('\n')
                .filter(Boolean);
            } catch {
              console.warn(
                `Push compare ref '${pushCompareRef}' unavailable, falling back to '${before}..${after}'`,
              );
            }
          }

          if (before && after && !/^0+$/.test(before)) {
            console.log(`Detecting push changes against '${before}..${after}'...`);
            return execSync(`git diff --name-only ${before} ${after}`)
              .toString()
              .trim()
              .split('\n')
              .filter(Boolean);
          }
        }

        if (eventName === 'pull_request') {
          const baseSha = event.pull_request?.base?.sha;
          const headSha = event.pull_request?.head?.sha ?? process.env['GITHUB_SHA'];

          if (baseSha && headSha) {
            console.log(`Detecting PR changes against '${baseSha}...${headSha}'...`);
            return execSync(`git diff --name-only ${baseSha}...${headSha}`)
              .toString()
              .trim()
              .split('\n')
              .filter(Boolean);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to parse CI event payload: ${msg}`);
      }
    }

    const baseRef = resolveValidationBaseRef();

    console.log(`Detecting changes against '${baseRef}'...`);

    // Check if baseRef exists
    try {
      execSync(`git rev-parse --verify ${baseRef}`, {stdio: 'ignore'});
    } catch {
      console.log(`Ref ${baseRef} not found, comparing against HEAD^`);
      return execSync('git diff --name-only HEAD^ HEAD')
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean);
    }

    const diffCommand = `git diff --name-only ${baseRef}...HEAD`; // 3-dot diff: changes in HEAD since divergence
    return execSync(diffCommand).toString().trim().split('\n').filter(Boolean);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Failed to get changed files:', msg);
    if (process.env['CI']) {
      console.error('Failing in CI - git errors must not silently skip E2E tests.');
      process.exit(1);
    }
    return [];
  }
}

interface DetermineTestsResult {
  runAll: boolean;
  specs: string[];
}

/**
 * Determine which tests to run
 */
function determineTests(changedFiles: string[]): DetermineTestsResult {
  const specsToRun = new Set<string>();
  let runAll = false;

  console.log('Changed files:');
  changedFiles.forEach((f) => console.log(` - ${f}`));

  for (const file of changedFiles) {
    // 1. Ignored files
    if (
      IGNORE_PATTERNS.some(
        (p) => file.endsWith(p) || file.startsWith(p) || file.includes('/' + p),
      )
    ) {
      continue;
    }

    // 2. Test-only infrastructure files (skip - they don't affect production behavior)
    if (
      TEST_ONLY_FILES.some((t) =>
        t.endsWith('/') ? file.startsWith(t) : file === t,
      )
    ) {
      console.log(`Test-only file: ${file} -> Skipping (no production impact)`);
      continue;
    }

    // 3. Global triggers
    if (GLOBAL_TRIGGERS.some((t) => file.startsWith(t) || file === t)) {
      console.log(`Global trigger found: ${file} -> Running ALL tests`);
      runAll = true;
      break;
    }

    // 4. E2E specs changed directly
    if (file.startsWith(E2E_DIR) && file.endsWith('.e2e-spec.ts')) {
      // Standardize path relative to project root
      // The e2e.ts passes files to playwright.
      // Playwright config testDir is './e2e' (relative to frontend).
      // However, we run playwright via e2e.ts which runs `pnpm --filter frontend exec playwright test ...`
      // If we pass paths, they should be relative to where playwright runs (frontend root)?
      // e2e.ts args are passed as passthroughArgs.
      // `pnpm --filter frontend exec playwright test [args]`.
      // If I pass `frontend/e2e/foo.spec.ts` (root relative), playwright inside frontend dir might get confused or handle it?
      // Usually `playwright test e2e/foo.spec.ts` works if inside frontend dir.
      // So I should strip 'frontend/' prefix.
      const relativeSpec = path.relative('frontend', file);
      specsToRun.add(relativeSpec);
      console.log(`Spec modified: ${file} -> Running ${relativeSpec}`);
      continue;
    }

    // 5. Other files in E2E dir (helpers, etc)
    if (file.startsWith(E2E_DIR)) {
      console.log(`E2E utility changed: ${file} -> Running ALL tests`);
      runAll = true;
      break;
    }

    // 6. Unknown file
    console.log(`Unknown file impact: ${file} -> Running ALL tests`);
    runAll = true;
    break;
  }

  return {runAll, specs: Array.from(specsToRun)};
}

function shellQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Get uncommitted (staged + unstaged) changed files.
 * Ensures locally-modified E2E specs are detected even without a commit.
 */
function getUncommittedFiles(): string[] {
  try {
    const staged = execSync('git diff --cached --name-only').toString().trim();
    const unstaged = execSync('git diff --name-only').toString().trim();
    const untracked = execSync('git ls-files --others --exclude-standard')
      .toString()
      .trim();
    const combined = new Set<string>([
      ...staged.split('\n').filter(Boolean),
      ...unstaged.split('\n').filter(Boolean),
      ...untracked.split('\n').filter(Boolean),
    ]);
    return Array.from(combined);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to get uncommitted files: ${msg}`);
    return [];
  }
}

// Execution
const committedChanges = getChangedFiles();
const uncommittedChanges = getUncommittedFiles();
const changedFiles = Array.from(new Set([...committedChanges, ...uncommittedChanges]));

if (changedFiles.length === 0) {
  console.log('No relevant changes detected. Skipping E2E tests.');
  process.exit(0);
}

const {runAll, specs} = determineTests(changedFiles);

// --check-only: output whether E2E should run, then exit (no test execution)
if (process.argv.includes('--check-only')) {
  const shouldRun = runAll || specs.length > 0;
  const outputFile = process.env['GITHUB_OUTPUT'];
  if (outputFile) {
    fs.appendFileSync(outputFile, `should_run=${String(shouldRun)}\n`);
  }
  console.log(`E2E check: should_run=${String(shouldRun)}`);
  process.exit(0);
}

if (!runAll && specs.length === 0) {
  console.log('Only ignored files changed (docs, etc). Skipping E2E tests.');
  process.exit(0);
}

// Construct command
let finalCmd = 'npx tsx scripts/e2e.ts --build';
const executionLabel = runAll
  ? 'Running ALL E2E tests'
  : `Running AFFECTED E2E tests: ${specs.join(', ')}`;

if (!runAll) {
  finalCmd += ` ${specs.map(shellQuote).join(' ')}`;
}

try {
  // Use stdio inherit to show output
  if (process.argv.includes('--dry-run')) {
    console.log(`[DRY RUN] Would execute: ${finalCmd}`);
  } else {
    console.log(executionLabel);
    execSync(finalCmd, {stdio: 'inherit'});
  }
} catch (e: unknown) {
  // Exit with the error code from the test run
  if (!process.argv.includes('--dry-run')) {
    const exitCode =
      e !== null &&
      typeof e === 'object' &&
      'status' in e &&
      typeof (e as {status: unknown}).status === 'number'
        ? (e as {status: number}).status
        : 1;
    process.exit(exitCode);
  }
}
