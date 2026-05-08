/** Roles that map to seed-demo.js users */
export type AuditRole = 'anon' | 'user' | 'communityAdmin' | 'rootAdmin' | 'scanner';

export type PostNavAction = 'click-register-tab';

export interface AuditRoute {
  /** Human-readable label for reports */
  label: string;
  /** URL path (may contain :param placeholders resolved at runtime) */
  path: string;
  /** Which role is needed to access this route */
  role: AuditRole;
  /** Locator string to wait for before considering the page "ready" */
  readyLocator: string;
  /** Optional setup action after navigation (e.g., clicking a tab) */
  postNavAction?: PostNavAction;
  /** Optional: data that must be seeded before visiting (event IDs, etc.) */
  seedRequirements?: string[];
}

export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'info';

export interface AuditFinding {
  /** Check identifier, e.g. 'axe-color-contrast', 'heading-hierarchy', 'llm-design-review' */
  check: string;
  severity: Severity;
  message: string;
  /** CSS selector or description of affected element */
  element?: string;
  /** How to fix */
  suggestion?: string;
}

export interface AuditRouteResult {
  route: AuditRoute;
  viewport: 'desktop' | 'mobile';
  theme?: 'dark' | 'light';
  timestamp: string;
  screenshotPath: string;
  /** Populated at report generation time */
  screenshotBase64?: string;
  consoleErrors: string[];
  findings: AuditFinding[];
  /** 1-10, only if LLM provider is not 'skip' */
  llmScore?: number;
  llmSummary?: string;
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface AuditReport {
  generatedAt: string;
  provider: string;
  totalRoutes: number;
  totalFindings: number;
  criticalCount: number;
  seriousCount: number;
  results: AuditRouteResult[];
}

export interface LlmDesignReview {
  overallScore: number; // 1-10
  findings: Array<{
    severity: Severity;
    area: string;
    issue: string;
    suggestion: string;
  }>;
  summary: string;
}
