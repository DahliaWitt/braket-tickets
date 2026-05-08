/**
 * select-affected-e2e.ts — LLM-based E2E test selector.
 *
 * Uses Claude (Sonnet) to analyze git diff and select affected E2E specs.
 * Designed for local development — CI uses simpler heuristics.
 *
 * Usage:
 *   pnpm affected-e2e              # select + print recommended command
 *   pnpm affected-e2e --run        # select + run via pnpm test:e2e:run
 *   pnpm affected-e2e --base main  # diff against specific ref
 */

import {execFileSync, spawnSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {PROJECT_ROOT} from './lib/shared';
import {resolveValidationBaseRef} from './lib/validation-base';

// ── Arg parsing ──────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const shouldRun = rawArgs.includes('--run');
const printSpecsOnly = rawArgs.includes('--print-specs');
const baseIdx = rawArgs.indexOf('--base');
const explicitBase = baseIdx !== -1 ? rawArgs[baseIdx + 1] : undefined;

// Args that pass through to pnpm test:e2e:run (e.g., --grep, --workers)
const passthroughArgs = rawArgs.filter(
  (a, i) =>
    a !== '--run' &&
    a !== '--print-specs' &&
    a !== '--base' &&
    a !== '--' &&
    (baseIdx === -1 || i !== baseIdx + 1),
);

// In --print-specs mode, send informational messages to stderr so stdout
// contains only spec paths (one per line) for machine consumption.
const log = printSpecsOnly
  ? (...args: unknown[]) => console.error(...args)
  : console.log.bind(console);

// ── Paths ────────────────────────────────────────────────────────────────────────

const E2E_DIR = path.join(PROJECT_ROOT, 'frontend', 'e2e');

const IGNORE_PATTERNS = [
  /\.md$/,
  /^\.github\//,
  /^\.husky\//,
  /^\.vscode\//,
  /^\.cursor\//,
  /^\.claude\//,
  /^\.agents\//,
  /^docs\//,
  /^LICENSE$/,
  /^\.gitignore$/,
];

// ── Git helpers ──────────────────────────────────────────────────────────────────

function getChangedFiles(baseRef: string): string[] {
  const results = new Set<string>();

  // Committed changes since divergence from base
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', `${baseRef}...HEAD`],
      {cwd: PROJECT_ROOT},
    )
      .toString()
      .trim();
    for (const f of out.split('\n')) if (f) results.add(f);
  } catch {
    // Base ref may not exist locally
  }

  // Unstaged
  const unstaged = execFileSync('git', ['diff', '--name-only'], {
    cwd: PROJECT_ROOT,
  })
    .toString()
    .trim();
  for (const f of unstaged.split('\n')) if (f) results.add(f);

  // Staged
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: PROJECT_ROOT,
  })
    .toString()
    .trim();
  for (const f of staged.split('\n')) if (f) results.add(f);

  return Array.from(results);
}

function getGitDiff(baseRef: string): string {
  const parts: string[] = [];

  // Committed diff
  try {
    parts.push(
      execFileSync(
        'git',
        [
          'diff',
          `${baseRef}...HEAD`,
          '--minimal',
          '--ignore-all-space',
          '--diff-filter=ACMR',
          '--',
          '.',
          ':(exclude)pnpm-lock.yaml',
        ],
        {cwd: PROJECT_ROOT, maxBuffer: 5 * 1024 * 1024},
      ).toString(),
    );
  } catch {
    // Base ref may not exist locally
  }

  // Uncommitted diff (staged + unstaged)
  parts.push(
    execFileSync(
      'git',
      [
        'diff',
        'HEAD',
        '--minimal',
        '--ignore-all-space',
        '--',
        '.',
        ':(exclude)pnpm-lock.yaml',
      ],
      {cwd: PROJECT_ROOT, maxBuffer: 5 * 1024 * 1024},
    ).toString(),
  );

  return parts.filter(Boolean).join('\n');
}

// ── Spec inventory ───────────────────────────────────────────────────────────────

interface SpecEntry {
  /** Path relative to project root, e.g. "frontend/e2e/admin/check-in.e2e-spec.ts" */
  path: string;
  /** First N lines showing imports + describe block */
  preview: string;
}

function collectSpecs(): SpecEntry[] {
  const specs: SpecEntry[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip audit suite (excluded by playwright config)
        if (entry.name === 'audit') continue;
        walk(full);
      } else if (entry.name.endsWith('.e2e-spec.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n').slice(0, 15);
        specs.push({
          path: path.relative(PROJECT_ROOT, full),
          preview: lines.join('\n'),
        });
      }
    }
  }

  walk(E2E_DIR);
  return specs.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Prompt construction ──────────────────────────────────────────────────────────

function buildPrompt(
  diff: string,
  changedFiles: string[],
  specs: SpecEntry[],
): string {
  const specSection = specs
    .map((s) => `### ${s.path}\n\`\`\`typescript\n${s.preview}\n\`\`\``)
    .join('\n\n');

  // Truncate diff to keep token cost reasonable
  const maxDiffChars = 50_000;
  const truncatedDiff =
    diff.length > maxDiffChars
      ? diff.slice(0, maxDiffChars) +
        '\n\n... [diff truncated — see changed files list for full scope]'
      : diff;

  return `You are an E2E test selector for a ticketing platform (Angular frontend, Convex backend, Playwright E2E tests).

Analyze the git diff and changed files. Select which E2E specs should run.

## Selection rules

1. ONLY select specs listed in "Available Specs" below.
2. Bias toward OVER-INCLUSION. When in doubt, include the test.
3. Look at each spec's imports — CDK harness imports reveal which Angular features the spec exercises.
4. Match backend Convex module names to related specs (e.g. backend/convex/payments* → payments/ specs, backend/convex/events* → events/ + admin/ specs).
5. Match frontend feature dirs to E2E dirs (e.g. features/admin/ → e2e/admin/ specs).

## Always-include rules

Include ALL smoke-tagged specs (@smoke) if changes touch ANY of:
- frontend/src/app/core/
- frontend/src/app/ui/
- frontend/src/app/layout/
- frontend/src/app/app.routes.ts
- backend/convex/lib/
- backend/convex/auth/** or backend/convex/lib/better_auth.ts

Include ALL specs if changes touch ANY of:
- backend/convex/schema.ts
- backend/convex/convex.config.ts
- frontend/playwright.config.ts
- frontend/e2e/global.setup.ts
- frontend/e2e/helpers/ (any file)
- frontend/e2e/test-utils/ (any file)
- package.json (root or frontend)
- pnpm-lock.yaml

## Smoke-tagged specs (for reference)
- frontend/e2e/auth/registration-flow.e2e-spec.ts
- frontend/e2e/auth/verification-flow.e2e-spec.ts
- frontend/e2e/admin/check-in.e2e-spec.ts
- frontend/e2e/payments/purchase-flow.e2e-spec.ts

## Available Specs

${specSection}

## Changed Files

${changedFiles.join('\n')}

## Git Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

Respond with ONLY a JSON array of spec file paths. No explanation. No markdown fences. Example:
["frontend/e2e/auth/registration-flow.e2e-spec.ts","frontend/e2e/payments/purchase-flow.e2e-spec.ts"]

If no specs should run, respond: []`;
}

// ── Claude invocation ────────────────────────────────────────────────────────────

function invokeClaude(prompt: string): string[] | null {
  // Verify claude CLI is available
  try {
    execFileSync('claude', ['--version'], {stdio: 'ignore'});
  } catch {
    console.error('ERROR: `claude` CLI not found. Install Claude Code first.');
    return null;
  }

  log('Asking Claude (Sonnet) to select affected E2E specs...\n');

  const result = spawnSync(
    'claude',
    [
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--tools',
      '',
    ],
    {
      input: prompt,
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    console.error('Claude invocation failed:', stderr.slice(0, 500));
    return null;
  }

  const stdout = result.stdout.toString();
  return parseClaudeResponse(stdout);
}

function parseClaudeResponse(raw: string): string[] | null {
  // With --output-format json, response is {"result": "...", ...}
  try {
    const envelope = JSON.parse(raw) as {result?: string; is_error?: boolean};

    if (envelope.is_error) {
      console.error(
        'Claude returned an error:',
        envelope.result?.slice(0, 300),
      );
      return null;
    }

    const text = envelope.result ?? raw;
    return extractJsonArray(text);
  } catch {
    // Maybe raw output without envelope
    return extractJsonArray(raw);
  }
}

function extractJsonArray(text: string): string[] | null {
  // Find the first JSON array in the text
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) {
    console.error('No JSON array found in Claude response.');
    console.error('Raw:', text.slice(0, 300));
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    console.error('Failed to parse JSON array:', match[0].slice(0, 200));
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────────

const baseRef = resolveValidationBaseRef(explicitBase);
log(`Base ref: ${baseRef}`);

const changedFiles = getChangedFiles(baseRef);
if (changedFiles.length === 0) {
  log('No changes detected. Nothing to run.');
  process.exit(0);
}

log(`Changed files: ${String(changedFiles.length)}`);

// Quick skip: docs/config-only changes
const hasSourceChanges = changedFiles.some(
  (f) => !IGNORE_PATTERNS.some((p) => p.test(f)),
);

if (!hasSourceChanges) {
  log('Only docs/config files changed. Skipping E2E.');
  process.exit(0);
}

const diff = getGitDiff(baseRef);
if (!diff.trim()) {
  log('Empty diff. Nothing to analyze.');
  process.exit(0);
}

const specs = collectSpecs();
log(`Spec inventory: ${String(specs.length)} specs\n`);

const prompt = buildPrompt(diff, changedFiles, specs);
const selected = invokeClaude(prompt);

if (selected === null) {
  console.error('\nFallback: run ALL specs (Claude selection failed).');
  if (shouldRun) {
    const result = spawnSync('pnpm', ['test:e2e:run', ...passthroughArgs], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
    });
    process.exit(result.status ?? 1);
  }
  // Exit 2 so callers can distinguish "Claude failed" from "no specs"
  process.exit(printSpecsOnly ? 2 : 1);
}

if (selected.length === 0) {
  log('No affected specs selected. Skipping E2E.');
  process.exit(0);
}

// Validate paths exist and convert to Playwright-relative paths
const validSpecs: string[] = [];
for (const spec of selected) {
  const absolute = path.join(PROJECT_ROOT, spec);
  if (fs.existsSync(absolute)) {
    // Strip "frontend/" prefix for Playwright
    validSpecs.push(spec.replace(/^frontend\//, ''));
  } else {
    console.warn(`  ⚠ Skipping non-existent spec: ${spec}`);
  }
}

if (validSpecs.length === 0) {
  log('No valid specs after path validation. Skipping E2E.');
  process.exit(0);
}

log(`Selected ${String(validSpecs.length)}/${String(specs.length)} specs:`);
for (const s of validSpecs) {
  log(`  ✓ ${s}`);
}

// --print-specs: output spec paths to stdout for machine consumption, then exit
if (printSpecsOnly) {
  for (const s of validSpecs) {
    process.stdout.write(s + '\n');
  }
  process.exit(0);
}

if (!shouldRun) {
  log(`\nTo run:\n  pnpm test:e2e:run -- ${validSpecs.join(' ')}`);
  log('\nOr rerun with --run to execute automatically.');
  process.exit(0);
}

// Run via pnpm test:e2e:run
log('\nRunning selected specs...\n');
const testResult = spawnSync(
  'pnpm',
  ['test:e2e:run', '--', ...validSpecs, ...passthroughArgs],
  {stdio: 'inherit', cwd: PROJECT_ROOT},
);

process.exit(testResult.status ?? 1);
