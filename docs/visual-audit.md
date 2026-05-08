---
title: Visual Audit Suite
category: Testing
order: 2
description: How to run the Playwright-based visual audit that checks every route for accessibility, overflow, touch targets, and design quality
access: public
---

# Visual Audit Suite

A Playwright-based audit that visits every route in the application and runs a battery of automated checks — accessibility, layout, touch targets, and optional AI-powered design review. Results are captured as full-page screenshots and written to an HTML report.

## What it does

For every route in `frontend/e2e/audit/audit-routes.ts`, the suite:

1. Seeds a realistic demo dataset (users, events, communities, uploaded images) into the test backend
2. Navigates to the route with the correct authentication fixture (`anon`, `user`, `communityAdmin`, `rootAdmin`, or `scanner`)
3. Repeats the run in two viewports: **desktop** (1440 × 900) and **mobile** (390 × 844)
4. Repeats again in **dark** and **light** themes — four variants per route total
5. Waits for loading skeletons to clear before running checks
6. Runs the check pipeline (see below)
7. Takes a full-page screenshot
8. Optionally sends the screenshot to an LLM for design review
9. After all routes finish, writes a JSON report and a self-contained HTML report

## How to run

### One-shot (deterministic checks only, no LLM)

From the project root:

```bash
pnpm audit:visual
```

This sets `AUDIT_LLM_PROVIDER=skip` and runs the audit Playwright project cold (starts the backend and frontend). Expect it to take several minutes.

### One-shot with LLM design review

```bash
OPENROUTER_API_KEY=<your-key> pnpm audit:visual:llm
```

Or with the Claude provider:

```bash
ANTHROPIC_API_KEY=<your-key> AUDIT_LLM_PROVIDER=claude pnpm audit:visual:llm
```

Without a valid API key the suite falls back to `skip` automatically — it will not error.

### Iterative (faster when running repeatedly)

Start the servers once and keep them alive:

```bash
pnpm test:e2e:serve
```

Then run the audit spec against the already-running servers (no 30 s cold-start penalty):

```bash
pnpm test:e2e:run -- frontend/e2e/audit/audit.e2e-spec.ts
```

Run a single route label to focus on a specific page:

```bash
pnpm test:e2e:run -- frontend/e2e/audit/audit.e2e-spec.ts --grep "Event Management"
```

## Output locations

All paths are relative to `frontend/` (the Playwright working directory):

| Path | Contents |
|------|----------|
| `e2e/audit/screenshots/` | Full-page PNG screenshots — one per route × viewport × theme |
| `e2e/audit/reports/audit-<timestamp>.html` | Self-contained HTML report with embedded screenshots and findings |
| `e2e/audit/reports/audit-<timestamp>.json` | Machine-readable JSON of the same data |

Open the HTML report in a browser:

```bash
open frontend/e2e/audit/reports/audit-*.html
```

## What checks are run

Each check runs in order after the page has fully loaded and skeletons have cleared.

### axe-core (WCAG 2.1 AA)

Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

Violations are mapped to `AuditFinding` severity by axe impact level: `critical → critical`, `serious → serious`, `moderate → moderate`, `minor → minor`. Each finding includes the CSS selector of the first affected node and axe's remediation hint.

### Heading hierarchy

Checks that the page has at least one `<h1>` and that heading levels do not skip (for example, going from `<h2>` directly to `<h4>`). Severity: `serious`.

### Touch target sizes (WCAG 2.2 SC 2.5.8)

All interactive elements (`button`, `a[href]`, `input`, `select`, `textarea`, `[role="button"]`, `[role="link"]`) are measured against two thresholds:

- **Primary CTA buttons** (purchase, checkout, log in, register, etc.): minimum 36 × 36 px — severity `critical`
- **All other interactive elements**: minimum 24 × 24 px — severity `serious` if below 16 px, `moderate` otherwise

Exceptions are applied per the WCAG 2.5.8 spec:
- Inline text links inside `<p>`, `<li>`, `<td>`, and similar prose elements are exempt
- Elements that pass the spacing exception (no neighbor target overlaps within 24 px) are exempt
- Visually hidden and sr-only elements are skipped

### Viewport overflow

Finds layout elements (`section`, `nav`, `header`, `div`, etc.) whose bounding box extends past the viewport width. Catches fixed-width children that cause unwanted horizontal scroll on mobile. Severity: `serious`.

Smart exclusions prevent noise:
- Elements with CSS `transform` or `translate` (off-screen drawers, slide-overs)
- Elements inside `overflow-x: auto/scroll` containers (intentional scroll regions)

### Text overflow

Finds `<p>`, `<h1>–<h6>`, `<span>`, `<a>`, `<li>`, `<td>`, `<th>`, `<label>`, and similar text elements where `scrollWidth > clientWidth`. Elements that already use `text-overflow: ellipsis` or `overflow: hidden` are skipped, as are elements inside a truncating ancestor. Severity: `moderate`.

### Broken images

`<img>` elements where `naturalWidth === 0` and `complete === true` (failed to load). Severity: `serious`.

### Missing alt text

`<img>` elements with no `alt` attribute at all (not even `alt=""`). Severity: `serious`.

### Empty buttons and links

`<button>` and `<a href>` elements with no accessible label — no text content, no `aria-label`, no `aria-labelledby`, no `title`. Severity: `serious`.

### Console errors

JavaScript errors logged to the browser console during the page load are collected and displayed in a separate collapsible section per route card. Common Convex WebSocket reconnect noise and Angular dev-mode warnings are filtered out automatically.

### LLM design review (optional)

When an LLM provider is configured, the full-page screenshot is sent with the contents of `.impeccable.md` (the project design spec) as context. The model returns:

- An `overallScore` (1–10)
- A `summary` paragraph
- Per-finding objects with `severity`, `area`, `issue`, and `suggestion`

Findings are tagged `llm-design-review` in the report. The LLM score appears as a badge on each route card and is averaged in the summary header.

Provider configuration:

| Environment variable | Effect |
|----------------------|--------|
| `AUDIT_LLM_PROVIDER=openrouter` (default) | Uses Gemini via OpenRouter. Requires `OPENROUTER_API_KEY`. |
| `AUDIT_LLM_PROVIDER=claude` | Uses `claude-sonnet-4-6` via the Anthropic SDK. Requires `ANTHROPIC_API_KEY`. |
| `AUDIT_LLM_PROVIDER=skip` | No LLM calls. Screenshots and deterministic checks only. |

## False positives — read this before acting on findings

The audit produces a **high rate of false positives**. Do not file bugs or make changes based solely on audit output. Always verify each finding manually in a browser.

Known false positive categories:

**axe color contrast**
axe flags semi-transparent backgrounds such as `bg-card/80` as contrast failures because it measures the alpha channel without compositing against the actual rendered background. Decorative borders and subtle overlays frequently trigger this. Confirm the finding in browser DevTools color picker against the true rendered colors before acting on it.

**Viewport overflow**
Drawers, sheet components, and other elements that are in the DOM but translated off-screen with `translate-x-full` are excluded, but some edge cases (CSS custom properties, indirect ancestor transforms) may slip through. Inspect the screenshot first — if the element is not visually present, it is a false positive.

**Touch targets**
Desktop-only hover targets (icon buttons that appear only on hover), floating action labels, and very small decorative interactive elements may be flagged. Check whether the element is reachable on touch (i.e., visible on mobile) before adding padding.

**LLM scoring**
Scores vary across runs with no code changes. A score of 6 on one run and 8 on the next is normal variance. Do not use scores as pass/fail thresholds. Use the commentary as a prompt for manual review, not as authoritative findings.

## Reading the HTML report

The report opens to a sticky header showing summary statistics: total routes audited, total findings, and counts broken down by severity (critical, serious, moderate, minor). If LLM scoring was enabled, an average design score is shown.

Below the header is a filter bar. Use the buttons to narrow cards by:
- **Viewport**: desktop / mobile
- **Theme**: dark / light
- **Role**: anon / user / communityAdmin / rootAdmin / scanner
- **Severity**: show only cards that contain at least one finding of the selected level

Each route card shows:
- Route label, path, viewport, theme, and role badges
- A severity summary row (count of findings per level)
- A thumbnail screenshot (click to expand to full-screen overlay)
- A collapsible **Findings** section listing every check result with selector, message, and suggestion
- A collapsible **Console errors** section (only shown when errors were captured)
- The LLM summary paragraph and score badge (only when LLM was enabled)

## Adding new routes

Edit `frontend/e2e/audit/audit-routes.ts` and add an entry to `AUDIT_ROUTES`.

Each route has this shape:

```typescript
{
  label: string;          // Human-readable label shown in the report
  path: string;           // URL path — may contain :param placeholders
  role: AuditRole;        // 'anon' | 'user' | 'communityAdmin' | 'rootAdmin' | 'scanner'
  readyLocator: string;   // Playwright locator waited on before checks run
  postNavAction?: PostNavAction;        // Optional tab click or other post-navigation setup
  seedRequirements?: string[];          // Seed data keys required to resolve :param paths
}
```

For routes with `:param` placeholders (e.g., `/events/:eventId`), list the required seed key in `seedRequirements` and add a corresponding `.replace()` call to the `resolvePath()` function in `audit.e2e-spec.ts`. The seed data is provided by `seedAllDemoData()`, which returns IDs keyed as `publishedEvent`, `communityAdminEvent`, etc.

Choose a `readyLocator` that signals meaningful content has loaded — not just the route shell. For pages with a loading skeleton, prefer a `data-testid` on a stat card or data element that only appears after the Convex subscription delivers data (see the `Event Management` route's use of `[data-testid="purchase-count"]` as an example).
