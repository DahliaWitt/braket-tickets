import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import type { AuditFinding, AuditReport, AuditRouteResult } from './audit-types';

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

export function writeJsonReport(
  results: AuditRouteResult[],
  provider: string,
  reportDir: string,
): { path: string; report: AuditReport } {
  mkdirSync(reportDir, { recursive: true });

  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const criticalCount = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'critical').length,
    0,
  );
  const seriousCount = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'serious').length,
    0,
  );

  const generatedAt = new Date().toISOString();
  const report: AuditReport = {
    generatedAt,
    provider,
    totalRoutes: results.length,
    totalFindings,
    criticalCount,
    seriousCount,
    results,
  };

  const timestamp = generatedAt.replace(/[:.]/g, '-');
  const outputPath = `${reportDir}/audit-${timestamp}.json`;
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  return { path: outputPath, report };
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  serious: '#f97316',
  moderate: '#eab308',
  minor: '#3b82f6',
  info: '#6b7280',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readScreenshotBase64(screenshotPath: string): string | null {
  try {
    if (!screenshotPath || !existsSync(screenshotPath)) return null;
    return readFileSync(screenshotPath).toString('base64');
  } catch {
    return null;
  }
}

function renderFinding(finding: AuditFinding): string {
  const color = SEVERITY_COLORS[finding.severity] ?? '#6b7280';
  return `
    <div class="finding" data-severity="${escapeHtml(finding.severity)}">
      <div class="finding-header">
        <span class="severity-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHtml(finding.severity)}</span>
        <span class="finding-check">${escapeHtml(finding.check)}</span>
      </div>
      <p class="finding-message">${escapeHtml(finding.message)}</p>
      ${finding.element ? `<code class="finding-element">${escapeHtml(finding.element)}</code>` : ''}
      ${finding.suggestion ? `<p class="finding-suggestion">Suggestion: ${escapeHtml(finding.suggestion)}</p>` : ''}
    </div>`;
}

function renderRouteCard(result: AuditRouteResult, index: number): string {
  const screenshotBase64 = readScreenshotBase64(result.screenshotPath);
  const imgSrc = screenshotBase64
    ? `data:image/png;base64,${screenshotBase64}`
    : '';
  const imgHtml = imgSrc
    ? `<img
        class="screenshot-thumb"
        src="${imgSrc}"
        alt="Screenshot of ${escapeHtml(result.route.label)}"
        onclick="toggleScreenshot(this)"
        title="Click to expand"
      />`
    : `<div class="screenshot-placeholder">No screenshot</div>`;

  const findingsHtml =
    result.findings.length > 0
      ? result.findings.map((f) => renderFinding(f)).join('')
      : `<p class="no-findings">No findings.</p>`;

  const llmBadgeHtml =
    result.llmScore !== undefined
      ? `<span class="llm-score" title="LLM design score">Score: ${result.llmScore}/10</span>`
      : '';

  const skippedBadge = result.skipped
    ? `<span class="badge badge-skipped">skipped</span>`
    : '';

  const severityCounts = result.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const severitySummary = Object.entries(severityCounts)
    .map(([sev, count]) => {
      const color = SEVERITY_COLORS[sev] ?? '#6b7280';
      return `<span class="severity-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${count} ${escapeHtml(sev)}</span>`;
    })
    .join('');

  const llmSummaryHtml = result.llmSummary
    ? `<p class="llm-summary">${escapeHtml(result.llmSummary)}</p>`
    : '';

  const cardId = `card-${index}`;
  const themeAttr = result.theme ? ` data-theme="${escapeHtml(result.theme)}"` : '';
  const themeBadge = result.theme
    ? `<span class="badge badge-theme badge-theme-${escapeHtml(result.theme)}">${escapeHtml(result.theme)}</span>`
    : '';

  return `
  <div class="route-card" id="${cardId}" data-viewport="${escapeHtml(result.viewport)}" data-role="${escapeHtml(result.route.role)}"${themeAttr}>
    <div class="card-header">
      <div class="card-title-row">
        <h2 class="card-title">${escapeHtml(result.route.label)}</h2>
        <div class="card-badges">
          <span class="badge badge-viewport">${escapeHtml(result.viewport)}</span>
          <span class="badge badge-role">${escapeHtml(result.route.role)}</span>
          ${themeBadge}
          ${skippedBadge}
          ${llmBadgeHtml}
        </div>
      </div>
      <div class="card-meta">
        <span class="card-path">${escapeHtml(result.route.path)}</span>
        <span class="card-duration">${result.durationMs}ms</span>
      </div>
      <div class="severity-row">${severitySummary}</div>
    </div>

    <div class="card-body">
      <div class="screenshot-wrap">
        ${imgHtml}
      </div>
      <div class="findings-wrap">
        ${llmSummaryHtml}
        <details open>
          <summary class="findings-toggle">
            Findings (${result.findings.length})
          </summary>
          <div class="findings-list">
            ${findingsHtml}
          </div>
        </details>
        ${
          result.consoleErrors.length > 0
            ? `<details>
              <summary class="findings-toggle console-errors-toggle">
                Console errors (${result.consoleErrors.length})
              </summary>
              <div class="findings-list">
                ${result.consoleErrors.map((e) => `<code class="console-error">${escapeHtml(e)}</code>`).join('')}
              </div>
            </details>`
            : ''
        }
      </div>
    </div>
  </div>`;
}

function buildStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f0f1a;
      --surface: #1a1a2e;
      --surface2: #1e1e35;
      --border: #2a2a4a;
      --text: #e2e2f0;
      --text-muted: #8888a8;
      --accent: #7c3aed;
      --font-sans: 'Inter', system-ui, sans-serif;
      --font-mono: 'Space Mono', 'Courier New', monospace;
    }

    html { font-size: 15px; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 0;
      min-height: 100vh;
    }

    /* ---- header ---- */
    .site-header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 1.5rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .site-header h1 {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #a78bfa;
    }

    .header-meta {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .summary-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 1rem;
    }

    .stat {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
    }

    .stat-value {
      font-size: 1.4rem;
      font-weight: 700;
      line-height: 1;
      display: block;
    }

    .stat-label {
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    /* ---- filters ---- */
    .filters {
      padding: 1rem 2rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .filter-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-right: 0.25rem;
    }

    .filter-btn {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0.3rem 0.65rem;
      transition: border-color 0.15s, background 0.15s;
    }

    .filter-btn:hover { border-color: var(--accent); }

    .filter-btn.active {
      background: #4c1d9522;
      border-color: var(--accent);
      color: #c4b5fd;
    }

    /* ---- cards ---- */
    .cards-container {
      padding: 1.5rem 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .route-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .route-card.hidden { display: none; }

    .card-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface2);
    }

    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
    }

    .card-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .card-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      flex-shrink: 0;
    }

    .badge {
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.45rem;
      text-transform: uppercase;
    }

    .badge-viewport { background: #1e3a5f; color: #7dd3fc; }
    .badge-role { background: #1a3a2a; color: #6ee7b7; }
    .badge-theme-dark { background: #1a1a3a; color: #a78bfa; }
    .badge-theme-light { background: #3a3020; color: #fde68a; }
    .badge-skipped { background: #3a1a1a; color: #fca5a5; }

    .llm-score {
      background: #2d1b4a;
      border: 1px solid #7c3aed44;
      border-radius: 4px;
      color: #c4b5fd;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0.15rem 0.45rem;
    }

    .card-meta {
      display: flex;
      gap: 1rem;
      margin-top: 0.4rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .card-path { font-family: var(--font-mono); }

    .severity-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.6rem;
    }

    .severity-badge {
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
    }

    /* ---- card body ---- */
    .card-body {
      display: flex;
      gap: 0;
    }

    .screenshot-wrap {
      flex-shrink: 0;
      width: 320px;
      background: #111;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 0.75rem;
      border-right: 1px solid var(--border);
    }

    .screenshot-thumb {
      max-width: 100%;
      height: auto;
      cursor: zoom-in;
      border-radius: 4px;
      transition: transform 0.2s;
    }

    .screenshot-thumb.expanded {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      max-width: 90vw;
      max-height: 90vh;
      z-index: 999;
      cursor: zoom-out;
      box-shadow: 0 0 0 100vmax rgba(0,0,0,0.85);
      border-radius: 6px;
    }

    .screenshot-placeholder {
      color: var(--text-muted);
      font-size: 0.8rem;
      padding: 2rem;
      text-align: center;
    }

    .findings-wrap {
      flex: 1;
      padding: 1rem 1.25rem;
      min-width: 0;
    }

    .llm-summary {
      font-size: 0.85rem;
      color: #c4b5fd;
      margin-bottom: 0.75rem;
      font-style: italic;
    }

    .findings-toggle {
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      user-select: none;
      padding: 0.35rem 0;
      list-style: none;
    }

    .findings-toggle::-webkit-details-marker { display: none; }
    .findings-toggle::before { content: '▶ '; font-size: 0.65em; }
    details[open] .findings-toggle::before { content: '▼ '; }

    .console-errors-toggle { color: #f97316; }

    .findings-list {
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .no-findings {
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    .finding {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
    }

    .finding-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }

    .finding-check {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .finding-message {
      font-size: 0.85rem;
      margin-bottom: 0.3rem;
    }

    .finding-element {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: #93c5fd;
      background: #0f172a;
      border-radius: 3px;
      padding: 0.25rem 0.4rem;
      margin-bottom: 0.3rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .finding-suggestion {
      font-size: 0.8rem;
      color: #86efac;
    }

    .console-error {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: #fca5a5;
      background: #1a0a0a;
      border-radius: 3px;
      padding: 0.25rem 0.4rem;
      overflow-x: auto;
      word-break: break-all;
      white-space: pre-wrap;
    }

    /* ---- responsive ---- */
    @media (max-width: 768px) {
      .site-header, .filters { padding: 1rem; }
      .cards-container { padding: 1rem; }
      .card-body { flex-direction: column; }
      .screenshot-wrap {
        width: 100%;
        border-right: none;
        border-bottom: 1px solid var(--border);
      }
      .card-title-row { flex-direction: column; }
    }
  `;
}

function buildScript(): string {
  return `
    // Screenshot click-to-expand
    function toggleScreenshot(img) {
      img.classList.toggle('expanded');
    }

    // Close expanded screenshot on backdrop click
    document.addEventListener('click', function(e) {
      if (e.target && e.target.classList && !e.target.classList.contains('screenshot-thumb')) {
        document.querySelectorAll('.screenshot-thumb.expanded').forEach(function(img) {
          img.classList.remove('expanded');
        });
      }
    });

    // Filter buttons
    function applyFilters() {
      var activeViewport = document.querySelector('.filter-btn[data-filter-type="viewport"].active');
      var activeRole = document.querySelector('.filter-btn[data-filter-type="role"].active');
      var activeTheme = document.querySelector('.filter-btn[data-filter-type="theme"].active');
      var activeSeverity = document.querySelector('.filter-btn[data-filter-type="severity"].active');

      var viewportVal = activeViewport ? activeViewport.getAttribute('data-filter-value') : 'all';
      var roleVal = activeRole ? activeRole.getAttribute('data-filter-value') : 'all';
      var themeVal = activeTheme ? activeTheme.getAttribute('data-filter-value') : 'all';
      var severityVal = activeSeverity ? activeSeverity.getAttribute('data-filter-value') : 'all';

      document.querySelectorAll('.route-card').forEach(function(card) {
        var vp = card.getAttribute('data-viewport');
        var role = card.getAttribute('data-role');
        var theme = card.getAttribute('data-theme');

        var vpMatch = viewportVal === 'all' || vp === viewportVal;
        var roleMatch = roleVal === 'all' || role === roleVal;
        var themeMatch = themeVal === 'all' || theme === themeVal;
        var sevMatch = true;
        if (severityVal !== 'all') {
          sevMatch = card.querySelector('.finding[data-severity="' + severityVal + '"]') !== null;
        }

        if (vpMatch && roleMatch && themeMatch && sevMatch) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    }

    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = btn.getAttribute('data-filter-type');
        // Deactivate siblings of the same type
        document.querySelectorAll('.filter-btn[data-filter-type="' + type + '"]').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        applyFilters();
      });
    });
  `;
}

export function writeHtmlReport(report: AuditReport, reportDir: string): string {
  mkdirSync(reportDir, { recursive: true });

  const hasLlm = report.results.some((r) => r.llmScore !== undefined);
  const avgLlm = hasLlm
    ? (
        report.results.filter((r) => r.llmScore !== undefined).reduce((sum, r) => sum + (r.llmScore ?? 0), 0) /
        report.results.filter((r) => r.llmScore !== undefined).length
      ).toFixed(1)
    : null;

  const moderateCount = report.results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'moderate').length,
    0,
  );
  const minorCount = report.results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'minor').length,
    0,
  );

  // Collect unique viewports, roles, themes, severities for filter buttons
  const viewports = [...new Set(report.results.map((r) => r.viewport))];
  const roles = [...new Set(report.results.map((r) => r.route.role))];
  const themes = [...new Set(report.results.map((r) => r.theme).filter((t): t is NonNullable<typeof t> => t !== undefined))];
  const severities = ['critical', 'serious', 'moderate', 'minor', 'info'];

  function filterGroup(type: string, values: string[]): string {
    const allBtn = `<button class="filter-btn active" data-filter-type="${type}" data-filter-value="all">all</button>`;
    const btns = values
      .map(
        (v) =>
          `<button class="filter-btn" data-filter-type="${type}" data-filter-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`,
      )
      .join('');
    return allBtn + btns;
  }

  const cardsHtml = report.results.map((r, i) => renderRouteCard(r, i)).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Visual Audit Report — ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</title>
  <style>${buildStyles()}</style>
</head>
<body>
  <header class="site-header">
    <h1>Visual Audit Report</h1>
    <div class="header-meta">
      Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}
      &nbsp;&middot;&nbsp; Provider: <strong>${escapeHtml(report.provider)}</strong>
    </div>
    <div class="summary-stats">
      <div class="stat">
        <span class="stat-value">${report.totalRoutes}</span>
        <span class="stat-label">routes</span>
      </div>
      <div class="stat">
        <span class="stat-value">${report.totalFindings}</span>
        <span class="stat-label">total findings</span>
      </div>
      <div class="stat">
        <span class="stat-value" style="color:#ef4444">${report.criticalCount}</span>
        <span class="stat-label">critical</span>
      </div>
      <div class="stat">
        <span class="stat-value" style="color:#f97316">${report.seriousCount}</span>
        <span class="stat-label">serious</span>
      </div>
      <div class="stat">
        <span class="stat-value" style="color:#eab308">${moderateCount}</span>
        <span class="stat-label">moderate</span>
      </div>
      <div class="stat">
        <span class="stat-value" style="color:#3b82f6">${minorCount}</span>
        <span class="stat-label">minor</span>
      </div>
      ${
        avgLlm !== null
          ? `<div class="stat">
            <span class="stat-value" style="color:#c4b5fd">${avgLlm}<span style="font-size:0.75rem;color:var(--text-muted)">/10</span></span>
            <span class="stat-label">avg LLM score</span>
          </div>`
          : ''
      }
    </div>
  </header>

  <nav class="filters">
    <span class="filter-label">Viewport:</span>
    ${filterGroup('viewport', viewports)}
    <span class="filter-label" style="margin-left:1rem">Theme:</span>
    ${filterGroup('theme', themes)}
    <span class="filter-label" style="margin-left:1rem">Role:</span>
    ${filterGroup('role', roles)}
    <span class="filter-label" style="margin-left:1rem">Severity:</span>
    ${filterGroup('severity', severities)}
  </nav>

  <main class="cards-container">
    ${cardsHtml}
  </main>

  <script>${buildScript()}</script>
</body>
</html>`;

  const timestamp = new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-');
  const outputPath = `${reportDir}/audit-${timestamp}.html`;
  writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}
