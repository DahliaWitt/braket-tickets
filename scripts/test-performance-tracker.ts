#!/usr/bin/env tsx
/**
 * Test performance tracker
 * Analyzes test results and tracks performance trends over time
 */

import fs from 'node:fs';
import path from 'node:path';

const REPORTS_DIR = path.join(import.meta.dirname, '..', 'reports');
const PERFORMANCE_HISTORY = path.join(REPORTS_DIR, 'test-performance-history.json');
const CONVEX_RESULTS = path.join(REPORTS_DIR, 'test-results.json');
const FRONTEND_RESULTS = path.join(
  import.meta.dirname,
  '..',
  'frontend',
  'reports',
  'test-results.json',
);

interface AssertionResult {
  status: 'passed' | 'failed' | 'skipped';
}

interface TestSuiteResult {
  startTime: number;
  endTime: number;
  assertionResults: AssertionResult[];
}

interface JestResults {
  testResults: TestSuiteResult[];
}

interface SuiteStats {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  avgTestDuration: number;
}

interface RunData {
  timestamp: string;
  convex: SuiteStats | null;
  frontend: SuiteStats | null;
}

interface PerformanceHistory {
  runs: RunData[];
}

function loadJson(filePath: string): JestResults | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as JestResults;
  } catch {
    return null;
  }
}

function loadHistory(): PerformanceHistory {
  if (!fs.existsSync(PERFORMANCE_HISTORY)) {
    return {runs: []};
  }
  try {
    return JSON.parse(fs.readFileSync(PERFORMANCE_HISTORY, 'utf-8')) as PerformanceHistory;
  } catch {
    return {runs: []};
  }
}

function saveHistory(history: PerformanceHistory): void {
  fs.writeFileSync(PERFORMANCE_HISTORY, JSON.stringify(history, null, 2));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function analyzeResults(results: JestResults | null, suiteName: string): SuiteStats | null {
  if (!results || !results.testResults) return null;

  const testResults = results.testResults;
  const totalTests = testResults.reduce((sum, tr) => sum + tr.assertionResults.length, 0);
  const passed = testResults.reduce(
    (sum, tr) => sum + tr.assertionResults.filter((r) => r.status === 'passed').length,
    0,
  );
  const failed = testResults.reduce(
    (sum, tr) => sum + tr.assertionResults.filter((r) => r.status === 'failed').length,
    0,
  );
  const skipped = testResults.reduce(
    (sum, tr) => sum + tr.assertionResults.filter((r) => r.status === 'skipped').length,
    0,
  );

  const duration = testResults.reduce((sum, tr) => sum + (tr.endTime - tr.startTime), 0);

  return {
    suite: suiteName,
    total: totalTests,
    passed,
    failed,
    skipped,
    duration,
    avgTestDuration: totalTests > 0 ? duration / totalTests : 0,
  };
}

function generateReport(): void {
  console.log('🧪 Analyzing test performance...\n');

  const convexResults = loadJson(CONVEX_RESULTS);
  const frontendResults = loadJson(FRONTEND_RESULTS);
  const history = loadHistory();

  const convexStats = analyzeResults(convexResults, 'convex');
  const frontendStats = analyzeResults(frontendResults, 'frontend');

  const runData: RunData = {
    timestamp: new Date().toISOString(),
    convex: convexStats,
    frontend: frontendStats,
  };

  // Keep last 50 runs for trend analysis
  history.runs.push(runData);
  if (history.runs.length > 50) {
    history.runs = history.runs.slice(-50);
  }
  saveHistory(history);

  // Display current run
  console.log('📊 Test Performance Report');
  console.log('==========================');
  console.log(`Timestamp: ${new Date().toLocaleString()}`);
  console.log();

  let totalTests = 0;
  let totalDuration = 0;

  if (convexStats) {
    console.log('🎯 Convex Tests');
    console.log(
      `   Total: ${convexStats.total} | ✅ ${convexStats.passed} | ❌ ${convexStats.failed} | ⏭️  ${convexStats.skipped}`,
    );
    console.log(`   Duration: ${formatDuration(convexStats.duration)}`);
    console.log(`   Avg per test: ${formatDuration(convexStats.avgTestDuration)}`);
    console.log();
    totalTests += convexStats.total;
    totalDuration += convexStats.duration;
  }

  if (frontendStats) {
    console.log('🅰️  Frontend Tests');
    console.log(
      `   Total: ${frontendStats.total} | ✅ ${frontendStats.passed} | ❌ ${frontendStats.failed} | ⏭️  ${frontendStats.skipped}`,
    );
    console.log(`   Duration: ${formatDuration(frontendStats.duration)}`);
    console.log(`   Avg per test: ${formatDuration(frontendStats.avgTestDuration)}`);
    console.log();
    totalTests += frontendStats.total;
    totalDuration += frontendStats.duration;
  }

  if (totalTests > 0) {
    console.log('📈 Combined Summary');
    console.log(`   Total tests: ${totalTests}`);
    console.log(`   Total duration: ${formatDuration(totalDuration)}`);
    console.log(`   Average per test: ${formatDuration(totalDuration / totalTests)}`);
  }

  // Trend analysis (compare with previous run)
  if (history.runs.length > 1) {
    const prev = history.runs[history.runs.length - 2];
    const curr = history.runs[history.runs.length - 1];

    console.log('\n📉 Trend Analysis (vs previous run)');

    if (prev.convex && curr.convex) {
      const durationDiff = curr.convex.duration - prev.convex.duration;
      const icon = durationDiff > 0 ? '📈' : '📉';
      console.log(
        `   Convex: ${icon} ${formatDuration(Math.abs(durationDiff))} ${durationDiff > 0 ? 'slower' : 'faster'}`,
      );
    }

    if (prev.frontend && curr.frontend) {
      const durationDiff = curr.frontend.duration - prev.frontend.duration;
      const icon = durationDiff > 0 ? '📈' : '📉';
      console.log(
        `   Frontend: ${icon} ${formatDuration(Math.abs(durationDiff))} ${durationDiff > 0 ? 'slower' : 'faster'}`,
      );
    }
  }

  console.log(`\n📁 Performance history: ${PERFORMANCE_HISTORY}`);

  // Exit with error if tests failed
  const hasFailures =
    (convexStats && convexStats.failed > 0) || (frontendStats && frontendStats.failed > 0);
  process.exit(hasFailures ? 1 : 0);
}

generateReport();
