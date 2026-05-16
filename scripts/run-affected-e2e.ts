import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {pathToFileURL} from 'url';
import {resolveValidationBaseRef} from './lib/validation-base';

// Configuration
const E2E_DIR = 'frontend/e2e';
const GLOBAL_TRIGGERS: string[] = [
  'backend/convex/schema.ts',
  'backend/convex/convex.config.ts',
  'backend/convex/auth.config.ts',
  'backend/convex/http.ts',
  'backend/package.json',
  'frontend/angular.json',
  'frontend/package.json',
  'frontend/playwright.config.ts',
  'frontend/e2e/global.setup.ts',
  'frontend/e2e/helpers/',
  'frontend/e2e/test-utils/',
  'package.json',
  'pnpm-lock.yaml',
];
const SMOKE_SPECS = [
  'e2e/admin/check-in.e2e-spec.ts',
  'e2e/auth/registration-flow.e2e-spec.ts',
  'e2e/auth/verification-flow.e2e-spec.ts',
  'e2e/payments/purchase-flow.e2e-spec.ts',
] as const;
const ADMIN_SPECS = [
  'e2e/admin/admin-community-manage.e2e-spec.ts',
  'e2e/admin/admin-trust-links.e2e-spec.ts',
  'e2e/admin/application-review.e2e-spec.ts',
  'e2e/admin/audit-logs.e2e-spec.ts',
  'e2e/admin/check-in.e2e-spec.ts',
  'e2e/admin/community-crud.e2e-spec.ts',
  'e2e/admin/comprehensive-event-management.e2e-spec.ts',
  'e2e/admin/event-lifecycle.e2e-spec.ts',
  'e2e/admin/event-manage-invalid-id.e2e-spec.ts',
  'e2e/admin/member-removal-controls.e2e-spec.ts',
  'e2e/admin/member-review-actions.e2e-spec.ts',
  'e2e/admin/rbac-community-scoping.e2e-spec.ts',
  'e2e/admin/root-admin-community-manage.e2e-spec.ts',
  'e2e/admin/scanner-community-scoping.e2e-spec.ts',
  'e2e/admin/stripe-connect-onboarding.e2e-spec.ts',
  'e2e/admin/vetting-notifications.e2e-spec.ts',
] as const;
const AUTH_SPECS = [
  'e2e/account.e2e-spec.ts',
  'e2e/auth/password-reset.e2e-spec.ts',
  'e2e/auth/registration-flow.e2e-spec.ts',
  'e2e/auth/verification-flow.e2e-spec.ts',
  'e2e/email-delivery.e2e-spec.ts',
  'e2e/security/rls-enforcement.e2e-spec.ts',
] as const;
const COMMUNITY_SPECS = [
  'e2e/admin/admin-community-manage.e2e-spec.ts',
  'e2e/admin/admin-trust-links.e2e-spec.ts',
  'e2e/admin/application-review.e2e-spec.ts',
  'e2e/admin/community-crud.e2e-spec.ts',
  'e2e/admin/member-removal-controls.e2e-spec.ts',
  'e2e/admin/member-review-actions.e2e-spec.ts',
  'e2e/admin/rbac-community-scoping.e2e-spec.ts',
  'e2e/admin/root-admin-community-manage.e2e-spec.ts',
  'e2e/admin/scanner-community-scoping.e2e-spec.ts',
  'e2e/admin/vetting-notifications.e2e-spec.ts',
  'e2e/events/community-filter.e2e-spec.ts',
  'e2e/invite/magic-link-flow.e2e-spec.ts',
  'e2e/landing-public-events.e2e-spec.ts',
  'e2e/shared-vetting-journey.e2e-spec.ts',
  'e2e/vetting.e2e-spec.ts',
] as const;
const EVENT_SPECS = [
  'e2e/admin/audit-logs.e2e-spec.ts',
  'e2e/admin/check-in.e2e-spec.ts',
  'e2e/admin/comprehensive-event-management.e2e-spec.ts',
  'e2e/admin/event-lifecycle.e2e-spec.ts',
  'e2e/admin/event-manage-invalid-id.e2e-spec.ts',
  'e2e/events/community-filter.e2e-spec.ts',
  'e2e/events/dashboard-upcoming-cutoff.e2e-spec.ts',
  'e2e/events/resale-day-of.e2e-spec.ts',
  'e2e/events/sold-out.e2e-spec.ts',
  'e2e/events/ticket-limits.e2e-spec.ts',
  'e2e/landing-public-events.e2e-spec.ts',
  'e2e/marketing-email.e2e-spec.ts',
  'e2e/payments/purchase-flow.e2e-spec.ts',
  'e2e/payments/refund-flow.e2e-spec.ts',
  'e2e/payments/tiered-purchase.e2e-spec.ts',
  'e2e/resale.e2e-spec.ts',
] as const;
const PAYMENT_SPECS = [
  'e2e/admin/stripe-connect-onboarding.e2e-spec.ts',
  'e2e/events/sold-out.e2e-spec.ts',
  'e2e/events/ticket-limits.e2e-spec.ts',
  'e2e/payments/purchase-flow.e2e-spec.ts',
  'e2e/payments/refund-flow.e2e-spec.ts',
  'e2e/payments/tiered-purchase.e2e-spec.ts',
  'e2e/resale.e2e-spec.ts',
  'e2e/tickets.e2e-spec.ts',
] as const;
const RESALE_SPECS = [
  'e2e/events/resale-day-of.e2e-spec.ts',
  'e2e/events/sold-out.e2e-spec.ts',
  'e2e/payments/refund-flow.e2e-spec.ts',
  'e2e/resale.e2e-spec.ts',
] as const;
const MARKETING_EMAIL_SPECS = [
  'e2e/email-delivery.e2e-spec.ts',
  'e2e/marketing-email.e2e-spec.ts',
  'e2e/static-pages.e2e-spec.ts',
] as const;
const PUBLIC_PAGE_SPECS = [
  'e2e/accessibility.e2e-spec.ts',
  'e2e/footer-feedback.e2e-spec.ts',
  'e2e/landing-public-events.e2e-spec.ts',
  'e2e/static-pages.e2e-spec.ts',
] as const;
const SECURITY_SPECS = [
  ...SMOKE_SPECS,
  'e2e/admin/admin-community-manage.e2e-spec.ts',
  'e2e/admin/rbac-community-scoping.e2e-spec.ts',
  'e2e/security/rls-enforcement.e2e-spec.ts',
] as const;

interface SpecMapping {
  prefix: string;
  specs: readonly string[];
}

const FRONTEND_PREFIX_SPEC_MAP: SpecMapping[] = [
  {prefix: 'frontend/src/app/features/admin/', specs: ADMIN_SPECS},
  {prefix: 'frontend/src/app/features/auth/', specs: AUTH_SPECS},
  {prefix: 'frontend/src/app/features/communities/', specs: COMMUNITY_SPECS},
  {prefix: 'frontend/src/app/features/dashboard/', specs: EVENT_SPECS},
  {
    prefix: 'frontend/src/app/features/invite/',
    specs: ['e2e/invite/magic-link-flow.e2e-spec.ts'],
  },
  {
    prefix: 'frontend/src/app/features/invite-redeem/',
    specs: ['e2e/invite/magic-link-flow.e2e-spec.ts'],
  },
  {prefix: 'frontend/src/app/features/landing/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/legal/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/support/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/help/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/contact/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/about/', specs: PUBLIC_PAGE_SPECS},
  {prefix: 'frontend/src/app/features/tickets/', specs: PAYMENT_SPECS},
  {prefix: 'frontend/src/app/features/vetting/', specs: COMMUNITY_SPECS},
  {
    prefix: 'frontend/src/app/app.routes.ts',
    specs: [...SMOKE_SPECS, ...PUBLIC_PAGE_SPECS],
  },
  {prefix: 'frontend/src/environments/', specs: SMOKE_SPECS},
];

const BACKEND_PREFIX_SPEC_MAP: SpecMapping[] = [
  {prefix: 'backend/convex/auth/', specs: AUTH_SPECS},
  {prefix: 'backend/convex/users/', specs: AUTH_SPECS},
  {prefix: 'backend/convex/communities/', specs: COMMUNITY_SPECS},
  {prefix: 'backend/convex/events/', specs: EVENT_SPECS},
  {prefix: 'backend/convex/guest_sessions/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/marketing/', specs: MARKETING_EMAIL_SPECS},
  {
    prefix: 'backend/convex/email/',
    specs: [...AUTH_SPECS, ...MARKETING_EMAIL_SPECS],
  },
  {
    prefix: 'backend/convex/http/',
    specs: [...AUTH_SPECS, ...MARKETING_EMAIL_SPECS, ...PAYMENT_SPECS],
  },
  {prefix: 'backend/convex/orders/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/payments/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/resale/', specs: RESALE_SPECS},
  {prefix: 'backend/convex/root_admin/', specs: ADMIN_SPECS},
  {
    prefix: 'backend/convex/storage/',
    specs: [...ADMIN_SPECS, ...PUBLIC_PAGE_SPECS],
  },
  {prefix: 'backend/convex/stripe/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/tickets/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/applications/', specs: COMMUNITY_SPECS},
  {
    prefix: 'backend/convex/lib/audience/',
    specs: [...MARKETING_EMAIL_SPECS, ...COMMUNITY_SPECS],
  },
  {prefix: 'backend/convex/lib/communities/', specs: COMMUNITY_SPECS},
  {prefix: 'backend/convex/lib/events/', specs: EVENT_SPECS},
  {prefix: 'backend/convex/lib/guest_sessions/', specs: PAYMENT_SPECS},
  {
    prefix: 'backend/convex/lib/magic_links/',
    specs: ['e2e/invite/magic-link-flow.e2e-spec.ts'],
  },
  {
    prefix: 'backend/convex/lib/marketing_emails/',
    specs: MARKETING_EMAIL_SPECS,
  },
  {prefix: 'backend/convex/lib/orders/', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/payments/', specs: PAYMENT_SPECS},
  {
    prefix: 'backend/convex/lib/users/',
    specs: [...AUTH_SPECS, ...COMMUNITY_SPECS],
  },
  {prefix: 'backend/convex/lib/access', specs: SECURITY_SPECS},
  {prefix: 'backend/convex/lib/auth', specs: SECURITY_SPECS},
  {prefix: 'backend/convex/lib/better_auth', specs: AUTH_SPECS},
  {prefix: 'backend/convex/lib/inventory', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/management_limits', specs: EVENT_SPECS},
  {prefix: 'backend/convex/lib/payment', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/resale', specs: RESALE_SPECS},
  {prefix: 'backend/convex/lib/stripe', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/ticket', specs: PAYMENT_SPECS},
  {prefix: 'backend/convex/lib/timezone', specs: EVENT_SPECS},
  {prefix: 'backend/convex/lib/trust_links', specs: COMMUNITY_SPECS},
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
        const event = JSON.parse(
          fs.readFileSync(eventPath, 'utf8'),
        ) as GithubEvent;

        if (eventName === 'push') {
          const before = event.before;
          const after = event.after ?? process.env['GITHUB_SHA'];
          const pushCompareRef = resolvePushCompareRef(event);

          if (pushCompareRef && after) {
            try {
              execSync(`git rev-parse --verify ${pushCompareRef}`, {
                stdio: 'ignore',
              });
              console.log(
                `Detecting push changes against '${pushCompareRef}...${after}'...`,
              );
              return execSync(
                `git diff --name-only ${pushCompareRef}...${after}`,
              )
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
            console.log(
              `Detecting push changes against '${before}..${after}'...`,
            );
            return execSync(`git diff --name-only ${before} ${after}`)
              .toString()
              .trim()
              .split('\n')
              .filter(Boolean);
          }
        }

        if (eventName === 'pull_request') {
          const baseSha = event.pull_request?.base?.sha;
          const headSha =
            event.pull_request?.head?.sha ?? process.env['GITHUB_SHA'];

          if (baseSha && headSha) {
            console.log(
              `Detecting PR changes against '${baseSha}...${headSha}'...`,
            );
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
      console.error(
        'Failing in CI - git errors must not silently skip E2E tests.',
      );
      process.exit(1);
    }
    return [];
  }
}

export interface DetermineTestsResult {
  runAll: boolean;
  specs: string[];
}

function addSpecs(
  specsToRun: Set<string>,
  specs: readonly string[],
  file: string,
  reason: string,
): void {
  for (const spec of specs) {
    specsToRun.add(spec);
  }
  console.log(`${reason}: ${file} -> Running ${specs.join(', ')}`);
}

function isIgnoredFile(file: string): boolean {
  return IGNORE_PATTERNS.some(
    (p) => file.endsWith(p) || file.startsWith(p) || file.includes('/' + p),
  );
}

function isTestOnlyFile(file: string): boolean {
  return (
    file.endsWith('.test.ts') ||
    file.endsWith('.spec.ts') ||
    TEST_ONLY_FILES.some((t) =>
      t.endsWith('/') ? file.startsWith(t) : file === t,
    )
  );
}

function findMapping(
  file: string,
  mappings: readonly SpecMapping[],
): SpecMapping | null {
  return mappings.find((mapping) => file.startsWith(mapping.prefix)) ?? null;
}

/**
 * Determine which tests to run
 */
export function determineTests(changedFiles: string[]): DetermineTestsResult {
  const specsToRun = new Set<string>();
  let runAll = false;

  console.log('Changed files:');
  changedFiles.forEach((f) => console.log(` - ${f}`));

  for (const file of changedFiles) {
    // 1. Ignored files
    if (isIgnoredFile(file)) {
      continue;
    }

    // 2. E2E specs changed directly
    if (file.startsWith(E2E_DIR) && file.endsWith('.e2e-spec.ts')) {
      const relativeSpec = path.relative('frontend', file);
      specsToRun.add(relativeSpec);
      console.log(`Spec modified: ${file} -> Running ${relativeSpec}`);
      continue;
    }

    // 3. Test-only files can be ignored after direct E2E specs are handled.
    if (isTestOnlyFile(file)) {
      console.log(`Test-only file: ${file} -> Skipping (no production impact)`);
      continue;
    }

    // 4. Global triggers
    if (GLOBAL_TRIGGERS.some((t) => file.startsWith(t) || file === t)) {
      console.log(`Global trigger found: ${file} -> Running ALL tests`);
      runAll = true;
      break;
    }

    // 5. Other files in E2E dir (helpers, etc)
    if (file.startsWith(E2E_DIR)) {
      console.log(`E2E utility changed: ${file} -> Running ALL tests`);
      runAll = true;
      break;
    }

    const frontendMapping = findMapping(file, FRONTEND_PREFIX_SPEC_MAP);
    if (frontendMapping !== null) {
      addSpecs(specsToRun, frontendMapping.specs, file, 'Frontend mapping');
      continue;
    }

    const backendMapping = findMapping(file, BACKEND_PREFIX_SPEC_MAP);
    if (backendMapping !== null) {
      addSpecs(specsToRun, backendMapping.specs, file, 'Backend mapping');
      continue;
    }

    // 6. Unknown production files keep the previous fail-safe behavior.
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

function main(): void {
  const committedChanges = getChangedFiles();
  const uncommittedChanges = getUncommittedFiles();
  const changedFiles = Array.from(
    new Set([...committedChanges, ...uncommittedChanges]),
  );

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
  let finalCmd = 'pnpm exec tsx scripts/e2e.ts --build';
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
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
