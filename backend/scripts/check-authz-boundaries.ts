import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

type Check = {
  description: string;
  pattern: string;
  excludedFiles?: string[];
};

function normalizeFilePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function collectConvexSourceFiles(
  directory = 'convex',
  readDir: typeof readdirSync = readdirSync,
): string[] {
  const files: string[] = [];

  for (const entry of readDir(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectConvexSourceFiles(entryPath, readDir));
      continue;
    }

    if (
      !entry.isFile() ||
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts')
    ) {
      continue;
    }

    files.push(normalizeFilePath(entryPath));
  }

  return files.sort();
}

export function findCheckMatches(
  check: Check,
  files = collectConvexSourceFiles(),
  readFile: (filePath: string) => string = (filePath) =>
    readFileSync(filePath, 'utf8'),
): string {
  const excludedFiles = new Set(
    ['convex/lib/authz.ts', ...(check.excludedFiles ?? [])].map(
      normalizeFilePath,
    ),
  );
  const matcher = new RegExp(check.pattern);
  const matches: string[] = [];

  for (const filePath of files) {
    const normalizedFilePath = normalizeFilePath(filePath);
    if (excludedFiles.has(normalizedFilePath)) continue;

    const lines = readFile(filePath).split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (!matcher.test(line)) continue;
      matches.push(`${normalizedFilePath}:${index + 1}:${line}`);
    }
  }

  return matches.join('\n');
}

const checks: Check[] = [
  {
    description:
      'direct `components.authz.rebac.*` usage outside convex/lib/authz.ts',
    pattern: 'components\\.authz\\.rebac\\.',
  },
  {
    description:
      'duplicate `canWithGlobalFallback` implementations outside convex/lib/permissions.ts',
    pattern: '(function|const)\\s+canWithGlobalFallback\\b',
    excludedFiles: ['convex/lib/permissions.ts'],
  },
  {
    description: 'direct `event:purchase` checks outside the access layer',
    pattern: '["\']event:purchase["\']',
    excludedFiles: ['convex/lib/access.ts', 'convex/lib/access/purchase.ts'],
  },
  {
    description: 'raw public-event purchase inference outside the access layer',
    pattern: 'event\\.visibility\\s*===\\s*["\']public["\']',
    excludedFiles: ['convex/lib/access.ts', 'convex/lib/access/purchase.ts'],
  },
  {
    description:
      'no-vetting fallback purchase inference outside the access layer',
    pattern:
      'vettingQuestions\\?\\.length\\s*\\?\\s*["\']direct["\']\\s*:\\s*["\']open_access["\']',
    excludedFiles: ['convex/lib/access.ts', 'convex/lib/access/purchase.ts'],
  },
];

export function runChecks(activeChecks = checks): boolean {
  let failed = false;

  for (const check of activeChecks) {
    const matches = findCheckMatches(check);
    if (!matches) continue;

    failed = true;
    console.error(`Authz boundary check failed: ${check.description}`);
    console.error(matches);
    console.error('');
  }

  return failed;
}

if (import.meta.main) {
  if (runChecks()) {
    process.exit(1);
  }

  console.log('Authz boundary checks passed');
}
