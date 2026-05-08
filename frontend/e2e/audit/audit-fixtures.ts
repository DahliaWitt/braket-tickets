/**
 * Visual Audit Suite — Fixture Configuration
 *
 * Run the audit:
 *   pnpm audit:visual              # Deterministic checks only (free, fast)
 *   pnpm audit:visual:llm          # With LLM design review (~$0.02/run)
 *
 * Environment variables:
 *   AUDIT_LLM_PROVIDER   Provider for design review: 'openrouter' | 'claude' | 'skip'
 *                         Defaults to 'openrouter'. Falls back to 'skip' if no API key.
 *   OPENROUTER_API_KEY    Required for openrouter provider
 *   ANTHROPIC_API_KEY     Required for claude provider
 *   AUDIT_SUITE           Set to '1' to include audit project in Playwright (set by scripts)
 *
 * Output:
 *   frontend/e2e/audit/screenshots/  — Full-page screenshots per route per viewport
 *   frontend/e2e/audit/reports/      — JSON + HTML reports with findings
 *
 * Adding routes:
 *   Edit frontend/e2e/audit/audit-routes.ts to add new entries to AUDIT_ROUTES.
 *   Routes with :param placeholders need seedRequirements and resolvePath support
 *   in audit.e2e-spec.ts.
 */
import { test as base } from '../helpers/test-setup';

export interface AuditConfig {
  llmProvider: 'openrouter' | 'claude' | 'skip';
  screenshotDir: string;
  reportDir: string;
}

/**
 * Audit-specific fixture extensions.
 *
 * Extends the base test with `auditConfig`, which resolves the LLM provider
 * from environment variables and falls back to 'skip' when no API key is found.
 *
 * Provider selection:
 *   AUDIT_LLM_PROVIDER=openrouter (default) → requires OPENROUTER_API_KEY
 *   AUDIT_LLM_PROVIDER=claude               → requires ANTHROPIC_API_KEY
 *   AUDIT_LLM_PROVIDER=skip                 → screenshot-only, no LLM calls
 */
export const test = base.extend<{
  auditConfig: AuditConfig;
}>({
  // eslint-disable-next-line no-empty-pattern
  auditConfig: async ({}, use) => {
    const provider = (process.env.AUDIT_LLM_PROVIDER ?? 'openrouter') as
      | 'openrouter'
      | 'claude'
      | 'skip';

    const effectiveProvider: 'openrouter' | 'claude' | 'skip' =
      provider === 'openrouter' && !process.env.OPENROUTER_API_KEY
        ? 'skip'
        : provider === 'claude' && !process.env.ANTHROPIC_API_KEY
          ? 'skip'
          : provider;

    await use({
      llmProvider: effectiveProvider,
      screenshotDir: 'e2e/audit/screenshots',
      reportDir: 'e2e/audit/reports',
    });
  },
});

export { expect } from '@playwright/test';
