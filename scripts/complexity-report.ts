#!/usr/bin/env tsx
/**
 * Cyclomatic complexity report generator
 * Uses ESLint to analyze code complexity across the codebase
 */

import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPORTS_DIR = path.join(import.meta.dirname, '..', 'reports');
const COMPLEXITY_REPORT = path.join(REPORTS_DIR, 'complexity-report.json');
const REPO_ROOT = path.join(import.meta.dirname, '..');
const ESLINT_TARGETS = ['backend/convex', 'frontend/src', 'shared'];

interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

interface ComplexityEntry {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

interface ComplexityReport {
  timestamp: string;
  summary: {
    totalFiles: number;
    filesWithComplexityIssues: number;
    totalComplexityWarnings: number;
  };
  threshold: {
    max: number;
    error: number;
  };
  highComplexityFunctions: ComplexityEntry[];
}

function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, {recursive: true});
  }
}

function runEslintOnPath(targetPath: string): EslintFileResult[] {
  const absoluteTarget = path.join(REPO_ROOT, targetPath);
  if (!fs.existsSync(absoluteTarget)) {
    throw new Error(`ESLint target does not exist: ${targetPath}`);
  }

  try {
    const result = execSync(
      `pnpm exec eslint ${targetPath} --ext .ts --format json --max-warnings 1000`,
      {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      },
    );
    return JSON.parse(result) as EslintFileResult[];
  } catch (error: unknown) {
    // ESLint exits with non-zero if there are warnings/errors
    if (
      error !== null &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof (error as {stdout: unknown}).stdout === 'string'
    ) {
      try {
        return JSON.parse(
          (error as {stdout: string}).stdout,
        ) as EslintFileResult[];
      } catch {
        return [];
      }
    }
    return [];
  }
}

function runComplexityCheck(): void {
  console.log('🔍 Analyzing cyclomatic complexity...\n');

  // Run on different paths separately to avoid buffer issues
  const eslintOutput = ESLINT_TARGETS.flatMap((target) =>
    runEslintOnPath(target),
  );

  const complexityIssues = eslintOutput.filter(
    (item) =>
      item.messages && item.messages.some((msg) => msg.ruleId === 'complexity'),
  );

  const report: ComplexityReport = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: eslintOutput.length,
      filesWithComplexityIssues: complexityIssues.length,
      totalComplexityWarnings: complexityIssues.reduce(
        (sum, file) =>
          sum + file.messages.filter((m) => m.ruleId === 'complexity').length,
        0,
      ),
    },
    threshold: {
      max: 10,
      error: 20,
    },
    highComplexityFunctions: complexityIssues.flatMap((file) =>
      file.messages
        .filter((m) => m.ruleId === 'complexity')
        .map((m) => ({
          file: path.relative(
            path.join(import.meta.dirname, '..'),
            file.filePath,
          ),
          line: m.line,
          column: m.column,
          message: m.message,
          severity: (m.severity === 2 ? 'error' : 'warning') as
            | 'error'
            | 'warning',
        })),
    ),
  };

  // Sort by severity (errors first) then by line
  report.highComplexityFunctions.sort((a, b) => {
    if (a.severity === b.severity) return a.line - b.line;
    return a.severity === 'error' ? -1 : 1;
  });

  ensureReportsDir();
  fs.writeFileSync(COMPLEXITY_REPORT, JSON.stringify(report, null, 2));

  console.log('📊 Complexity Report');
  console.log('===================');
  console.log(`Files analyzed: ${report.summary.totalFiles}`);
  console.log(
    `Files with complexity issues: ${report.summary.filesWithComplexityIssues}`,
  );
  console.log(
    `Total complexity warnings: ${report.summary.totalComplexityWarnings}`,
  );
  console.log(
    `\nThreshold: max ${report.threshold.max} (error at ${report.threshold.error})`,
  );

  if (report.highComplexityFunctions.length > 0) {
    console.log(`\n⚠️  Functions exceeding complexity threshold:`);
    // Show top 10 to avoid overwhelming output
    report.highComplexityFunctions.slice(0, 10).forEach((fn) => {
      const icon = fn.severity === 'error' ? '🔴' : '🟡';
      console.log(`  ${icon} ${fn.file}:${fn.line} - ${fn.message}`);
    });
    if (report.highComplexityFunctions.length > 10) {
      console.log(
        `  ... and ${report.highComplexityFunctions.length - 10} more`,
      );
    }
  } else {
    console.log('\n✅ All functions within complexity threshold!');
  }

  console.log(`\n📁 Full report: ${COMPLEXITY_REPORT}`);

  // Exit with error code if there are errors (not just warnings)
  const hasErrors = report.highComplexityFunctions.some(
    (f) => f.severity === 'error',
  );
  process.exit(hasErrors ? 1 : 0);
}

runComplexityCheck();
