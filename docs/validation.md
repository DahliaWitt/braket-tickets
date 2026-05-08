---
title: Validation
category: Development
order: 2
description: Layered validation — automatic and manual checks
access: public
---

# Validation Workflow

This project uses layered validation: automatic checks run continuously, manual checks run before marking work complete.

## Automatic (No Action Required)

| Layer                 | Trigger      | Blocks? | Details                                                                 |
| --------------------- | ------------ | ------- | ----------------------------------------------------------------------- |
| VS Code TypeScript    | As you type  | No      | Red squiggles in Problems panel                                         |
| Pre-commit hook       | `git commit` | Yes     | Frontend + Convex typecheck (<5s)                                       |
| Pre-merge-commit hook | `git merge`  | Yes     | Full `validate.sh all`: lint, typecheck, tests, build, LLM-selected E2E |
| GitHub Actions CI     | Push / PR    | Yes     | Lint, unit tests, Stripe sandbox contracts, build; affected E2E on PRs  |

**Setup**: Git hooks are installed automatically by Husky when you run `pnpm install`.

## Manual (Run Explicitly)

### Full Validation (before marking tasks complete)

```bash
pnpm validate               # lint + typecheck + tests + build
./scripts/validate.sh all   # pnpm validate + LLM-selected E2E (local) or affected E2E (CI)
./scripts/validate.sh full  # all + full E2E suite (all specs)
./scripts/validate.sh fast   # staged-scope realtime guard + typecheck(s)
./scripts/validate.sh test   # unit tests only (frontend + convex, parallel)
pnpm affected-e2e            # LLM-selected E2E only (standalone, requires Claude CLI)
```

### Unit Tests

```bash
pnpm test:unit       # Both suites (parallel, fast-fail)
pnpm test:convex     # Backend only
pnpm test:convex:sandbox  # Stripe sandbox contract lane (requires sandbox env vars)
pnpm test:frontend   # Frontend only
```

### E2E Tests

Use the serve/run split when iterating (avoids ~30s cold start per run):

```bash
# One-shot (cold start — use for single validation only)
pnpm test:e2e

# Iterative (start servers once, run tests repeatedly)
pnpm test:e2e:serve              # Start backend + frontend, keep alive
pnpm test:e2e:run --grep "test"  # Run against already-running servers
```

Do NOT run `npx playwright test` directly — it bypasses the backend harness.

### LLM-Selected E2E (Local)

Uses Claude (Sonnet) to analyze the git diff and select only affected specs:

```bash
pnpm affected-e2e              # Select + print command
pnpm affected-e2e --run        # Select + run (requires serve running)
pnpm affected-e2e --base main  # Diff against specific ref
```

This is also used by `validate.sh all` locally (and the pre-merge-commit hook).
If the `claude` CLI is unavailable, E2E is skipped locally — CI catches regressions.

For agent-driven runs, use `pnpm affected-e2e` directly. The selector owns its
Claude prompt inline; there is no separate Claude slash command to maintain.

### Browser Testing

```bash
cd frontend && pnpm start
# Open http://localhost:4200
```

## validate.sh Modes

| Mode         | What it runs                                                                    | Parallel?                  |
| ------------ | ------------------------------------------------------------------------------- | -------------------------- |
| `lint`       | Linter only                                                                     | No                         |
| `dead-flags` | Dead feature flag check only                                                    | No                         |
| `fast`       | Staged-scope realtime guard + typecheck(s)                                      | Yes (frontend + convex)    |
| `typecheck`  | Typecheck only                                                                  | Yes (frontend + convex)    |
| `test`       | Unit tests only                                                                 | Yes (frontend + convex)    |
| `build`      | Production build                                                                | No                         |
| `e2e`        | E2E tests (requires build)                                                      | No                         |
| `affected`   | Affected E2E tests only                                                         | No                         |
| `all`        | lint + typecheck + tests + build + LLM-selected E2E (local) / affected E2E (CI) | Yes (then build, then E2E) |
| `core`       | lint + typecheck + tests + build                                                | Yes (then build)           |
| `full`       | all + full E2E suite                                                            | Yes (then build, then E2E) |

## CI Structure

```
ci.yml
├── lint (ESLint + tsc + Convex generated files + sanitized logging + file coupling)
│   └── stripe-contracts (runs against Stripe sandbox)
├── test (frontend + convex unit suites)
├── build (frontend production build with bundle analysis)
├── e2e-check (affected test detector)
│   └── e2e (conditional on e2e-check output)
```

**Job Details**:

- `lint`: Checks Convex generated files are fresh, runs lint, typecheck, enforces Convex sanitized logging, and checks file coupling (ifttt-lint)
- `stripe-contracts`: Runs `pnpm test:convex:sandbox` against Stripe sandbox; needs `lint` to pass
- `e2e-check`: Detects affected E2E tests; needs `lint`, `test`, and `build` to pass
- `e2e`: Runs only if `e2e-check` determines tests are needed

## Troubleshooting

**Pre-commit hook not running**: Re-run `pnpm install` to let Husky reinstall hooks, then verify `.husky/` directory exists and hooks are executable.

**TypeScript errors not showing**: Reload VS Code window (`Cmd+Shift+P` → "Reload Window").
