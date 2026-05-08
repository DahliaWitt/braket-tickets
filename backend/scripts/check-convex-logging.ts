#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const CONVEX_DIR = path.join(REPO_ROOT, 'convex');

const ALLOWED_FILES = new Set([
  path.join(CONVEX_DIR, 'lib', 'logger.ts'),
]);

const CONSOLE_CALL_RE = /\bconsole\.(log|info|warn|error)\s*\(/g;

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_generated') {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    if (entry.name.endsWith('.test.ts')) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

const violations: string[] = [];

for (const filePath of walk(CONVEX_DIR)) {
  if (ALLOWED_FILES.has(filePath)) {
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(CONSOLE_CALL_RE)) {
    const line = getLineNumber(content, match.index ?? 0);
    const relativePath = path.relative(REPO_ROOT, filePath);
    violations.push(`${relativePath}:${line} uses ${match[0]}`);
  }
}

if (violations.length > 0) {
  console.error('Convex logging check failed.');
  console.error(
    'Use `logger` from convex/lib/logger.ts instead of raw console calls:',
  );
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log('Convex logging check passed.');
