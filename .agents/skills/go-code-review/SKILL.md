---
name: go-code-review
description: Use when reviewing implementation diffs, PRs, commits, branches, or working-tree changes before handoff, merge, or follow-up implementation
---

# Go Code Review

Strict review for code changes. Be blunt. Treat it like Claude Opus wrote it. Prove correctness, simplicity, tests, and debt-free handoff.

## Non-Negotiables

Report every reject gate, even P2/P3. Pass notes are mandatory. Angular services/specs/templates require Pass 5. Any frontend UI/style/mock/story/harness/visual-affordance change requires Pass 6 with `frontend-skill`, `frontend-design`, `color-expert`, and `critique`.

## Pressure-Test Gate

RED/GREEN: baseline skips guidance/debt; with-skill runs passes and rejects debt. Known RED: Stripe dark-mode review accepted a feature-local brand palette and off-brand mock typography; reject equivalent token SSOT, contrast, or visual-fidelity drift.

## Scope

Review ONLY task changes. Inspect `git status --short`, `git diff --stat`, and relevant diffs; leave unrelated dirty files alone. Adjacent helpers/types/harnesses are in scope. Ask if unclear. Review-only means no edits. Review-and-fix means fix every finding/nit, then rerun checks. Do not spawn subagents unless asked.

## Required Passes

Run every pass in order. Mark irrelevant passes `N/A - reason`. Do not merge.

1. Convex Best Practices: for Convex/contracts, read `backend/convex/_generated/ai/guidelines.md`; use `convex-best-practices`/`convex-functions`.
2. Convex Security: for auth/authz/PII/payments/admin/writes, use `convex-security-audit`/`convex-security-check`; expect `backend/convex/lib/access.ts`.
3. Convex Performance: for queries/mutations/subscriptions/pagination/bulk/hot paths, use `convex-performance-audit`.
4. Code Review: always check correctness, regressions, states, errors, tests, dead code, and needless abstractions.
5. Angular Best Practices: for Angular/templates/tests, use current Angular guidance, generated Convex types, CDK Harnesses.
6. Frontend Design: for UI/copy/layout/interaction/styles/mocks/stories/harnesses, use `frontend-skill`, `frontend-design`, `color-expert`, and `critique`; load `.impeccable.md`. Check project fit, hierarchy, utility copy, dark/light contrast, token/brand SSOT, typography, responsive states, accessibility, and mock/story/screenshot fidelity. N/A only for non-frontend diffs.

## Reject Gates

Reject until fixed: missed behavior, enabled no-op UI, feature-local authz, weak tests, raw DOM where harnesses belong, type gymnastics, competing helpers/types/routes/validators/policies, duplicate theme/color/brand palettes, mock/story/screenshot typography or contrast drift, TODOs, temp paths, stale comments/docs, skipped tests, or manual follow-up. Never accept handwritten frontend Convex args/returns; expect `FunctionArgs<typeof api.x.y>` and `FunctionReturnType<typeof api.x.y>`.

## Red Flags

- "This is my code, cleanup can wait" -> Opus wrote it. Fix debt now.
- "Tests pass, review is done" -> Finish every pass.
- "This abstraction might help later" -> Remove it unless current behavior and repo patterns justify it.
- "Many dirty files, review all" -> Review only scoped changes.
- "I know Convex/Angular well enough" -> Use repo guidance and current framework sources.
- "Only P0/P1" or "no pass notes" -> Refuse; report all reject gates and pass notes.
- "I skipped because user asked" -> Skill failure; patch and re-test.

## Output

Lead with findings by severity. Each finding needs file/line, broken behavior, risk, and required fix. If limited to P0/P1 or no pass notes, start: "I can't honor that limit; this review requires all reject gates and pass notes."

Pass notes are mandatory even if forbidden: each pass is `Completed` or `N/A - reason`. If clean, say so and list verification gaps/residual risk. For review-and-fix, finish with patch summary and targeted verification. For review-only, do not modify files.
