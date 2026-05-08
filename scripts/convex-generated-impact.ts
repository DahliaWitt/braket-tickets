import {getChangedFilesForValidation} from './frontend-build-impact';

export interface ConvexGeneratedImpact {
  needsCheck: boolean;
  reasons: string[];
}

const EXPLICIT_CHECK_TRIGGERS = new Set([
  'backend/package.json',
  'pnpm-lock.yaml',
]);

function requiresConvexGeneratedCheck(file: string): boolean {
  if (file === '') return false;
  if (EXPLICIT_CHECK_TRIGGERS.has(file)) return true;
  if (!file.startsWith('backend/convex/')) return false;
  if (file.startsWith('backend/convex/_generated/')) return false;
  if (!file.endsWith('.ts')) return false;
  if (file.endsWith('.test.ts')) return false;
  return true;
}

export function determineConvexGeneratedRequirement(
  changedFiles: string[],
): ConvexGeneratedImpact {
  const reasons = changedFiles.filter(requiresConvexGeneratedCheck);
  return {
    needsCheck: reasons.length > 0,
    reasons,
  };
}

function runCli(): void {
  const changedFiles = getChangedFilesForValidation();
  const impact = determineConvexGeneratedRequirement(changedFiles);

  if (process.argv.includes('--decision')) {
    process.stdout.write(impact.needsCheck ? 'run\n' : 'skip\n');
    process.exit(0);
  }

  if (process.argv.includes('--reasons')) {
    if (impact.reasons.length === 0) {
      process.stdout.write('No Convex generated freshness check required.\n');
    } else {
      process.stdout.write(`${impact.reasons.join('\n')}\n`);
    }
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify(
      {
        changedFiles,
        needsCheck: impact.needsCheck,
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
