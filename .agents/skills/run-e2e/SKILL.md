---
name: run-e2e
description: Use when running E2E tests, checking if E2E tests pass, or validating changes with Playwright tests. Covers affected-only runs (preferred), full suite, parallel execution, and port isolation for concurrent runs.
---

# Run E2E Tests

E2E tests use Playwright + a local Convex backend. **Never run `npx playwright test` directly** — always go through the backend harness.

## Quick Reference

| Goal                                  | Command                                    |
| ------------------------------------- | ------------------------------------------ |
| **LLM-selected affected (preferred)** | `pnpm affected-e2e`                        |
| LLM-selected + auto-run               | `pnpm affected-e2e --run`                  |
| LLM-selected against specific ref     | `pnpm affected-e2e --base main`            |
| Deterministic affected (CI style)     | `tsx scripts/run-affected-e2e.ts`          |
| All tests (dev mode)                  | `pnpm test:e2e`                            |
| All tests (pre-built)                 | `pnpm test:e2e -- --build`                 |
| Specific file                         | `pnpm test:e2e -- e2e/landing.e2e-spec.ts` |
| Debug mode                            | `pnpm test:e2e -- --debug`                 |
| Via validate script                   | `./scripts/validate.sh all`                |
| **Start servers (keep alive)**        | `pnpm test:e2e:serve`                      |
| **Run against running servers**       | `pnpm test:e2e:run --grep "test name"`     |

## Capturing Output

Always pipe E2E output to a uniquely-named temp file so you can read the full log without re-running, and avoid conflicts from concurrent runs:

```bash
pnpm test:e2e 2>&1 | tee /tmp/e2e-$(date +%s).log
```

Then use Read or Grep on the log file to inspect failures. Never re-run a long E2E suite just to see a different part of the output.

## Flake Detection

Use `--repeat-each=N` to run every test N times within a single suite execution. This catches flaky tests efficiently with one backend startup:

```bash
# Run each test 3 times (catches most flakes)
pnpm test:e2e -- --repeat-each=3

# Combine with a specific file
pnpm test:e2e -- e2e/admin/check-in.e2e-spec.ts --repeat-each=3

# With serve/run workflow
pnpm test:e2e:run --repeat-each=3
```

## Iterative Development (Serve + Run)

When fixing E2E tests iteratively, avoid cold starts:

1. Start servers once: `pnpm test:e2e:serve` (background)
2. Confirm readiness with HTTP health check (see below)
3. Run tests repeatedly: `pnpm test:e2e:run --grep "test name"`

Frontend changes auto-reload via Vite HMR. Backend/schema changes can be hot-deployed without restarting:

```bash
npx convex deploy --admin-key 0135d8598650f8f5cb0f30c34ec2e2bb62793bc28717c8eb6fb577996d50be5f4281b59181095065c5d0f86a2c31ddbe9b597ec62b47ded69782cd --url "$(cat .convex-local/.e2e-convex-url)"
```

Only restart serve if you need a fresh database (new schema with incompatible data). The run command skips all startup (no deploy, no env setup, no clear) — sub-second to first test.

```bash
# Start servers (background)
pnpm test:e2e:serve > /tmp/e2e-serve.log 2>&1 &

# Confirm readiness — run this until it says READY (do NOT use log-parsing loops)
[ -f .convex-local/.e2e-port ] && [ -f .convex-local/.e2e-convex-url ] && [ -f .convex-local/.e2e-convex-site-url ] \
  && curl -sf "$(cat .convex-local/.e2e-convex-url)" > /dev/null \
  && curl -sf "http://127.0.0.1:$(cat .convex-local/.e2e-port)" > /dev/null \
  && echo "READY" || echo "NOT READY"

# Instant test runs
pnpm test:e2e:run                                    # all tests
pnpm test:e2e:run --grep "community"              # filtered
pnpm test:e2e:run -- e2e/admin/audit-logs.e2e-spec.ts  # specific file
```

### Readiness Detection Rules

**Never** use `tail -f`, `grep` on log files, `sleep` loops, or any polling approach to detect readiness. These are fragile and waste time.

**Always** use the HTTP health check above. All three conditions must pass:

1. Port files exist (`.convex-local/.e2e-port`, `.convex-local/.e2e-convex-url`, `.convex-local/.e2e-convex-site-url`)
2. Convex backend responds to HTTP (`curl -sf` the Convex URL)
3. Frontend responds to HTTP (`curl -sf` the frontend port)

If not ready, report what's missing. Don't block on waits.

## Affected Tests (Preferred)

### LLM-Selected (Local — preferred)

`select-affected-e2e.ts` uses Claude (Sonnet) to analyze the git diff and select affected specs.
No static mapping file to maintain — the spec inventory and feature dependencies are read dynamically.

```bash
# Select + print command (default)
pnpm affected-e2e

# Select + run (requires pnpm test:e2e:serve to be running)
pnpm affected-e2e --run

# Diff against specific ref
pnpm affected-e2e --base main
```

For agent-driven runs, use `pnpm affected-e2e` directly. The selector owns its
Claude prompt inline; there is no separate Claude slash command to maintain.

`validate.sh all` uses this automatically for local runs. The pre-merge-commit hook runs `validate.sh all`.
If `claude` CLI is unavailable, E2E is skipped locally — CI catches regressions.

### Deterministic (CI)

`run-affected-e2e.ts` uses `git diff` against the upstream branch to detect changed files, then applies rules:

- **Modified `*.e2e-spec.ts`** → runs only those specs
- **Changed `convex/`, `frontend/src/`, `package.json`, etc.** → runs ALL (conservative)
- **Docs, `.github/`, `.husky/`, etc.** → skipped entirely

CI uses this as a binary gate — if anything relevant changed, the full suite runs.

## Parallel Runs (Port Isolation)

All ports use OS ephemeral allocation (listen on port 0) — no range scanning, no TOCTOU races.

| Port                     | Allocation   | Override env var |
| ------------------------ | ------------ | ---------------- |
| Frontend (Angular/serve) | OS ephemeral | `E2E_PORT`       |
| Convex backend API       | OS ephemeral | `CONVEX_PORT`    |
| Convex site proxy        | OS ephemeral | —                |

Multiple parallel runs just work — each gets a unique OS-assigned port.

```bash
# Run 1 (OS assigns free ports for both backend and frontend)
pnpm test:e2e

# Run 2 in parallel (OS assigns different free ports)
pnpm test:e2e

# Manual override if needed
CONVEX_PORT=3214 pnpm test:e2e
```

Each unique Convex port gets isolated state:

- DB: `convex_shard_<port>.sqlite3`
- Storage: `convex_local_storage_<port>/`
- Log: `convex-local-backend-<port>.log`

## What the Harness Does

The TypeScript harness (`scripts/lib/ConvexBackend.ts` + `scripts/e2e.ts`) handles the full lifecycle:

1. Safety-checks that `CONVEX_URL` isn't pointing at a remote deployment
2. Reserves free ports via OS ephemeral allocation: Convex backend, site proxy, and frontend
3. Downloads and starts local Convex backend (with Docker fallback on Linux)
4. Deploys schema with `npx convex deploy` (with retry)
5. Sets env vars on backend (`IS_TEST=true`, auth keys, SMTP, Stripe)
6. Generates `frontend/public/runtime-env.js` with ephemeral Convex URLs (runtime injection)
7. Clears test data via `testing_functions:clearAll`
8. Spawns Playwright with correct env vars injected
9. Cleans up backend via `tree-kill` on exit (PID-scoped, never pkill)

## Common Mistakes

| Mistake                                          | Fix                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `npx playwright test` directly                   | Use `pnpm test:e2e` (needs backend harness)                       |
| `ng test`                                        | That's unit tests. E2E = `pnpm test:e2e`                          |
| Manually setting ports for parallel runs         | Both ports use OS ephemeral allocation — just run `pnpm test:e2e` |
| Running against remote Convex                    | Harness blocks this. Always uses local backend                    |
| `./scripts/validate.sh all` for one failing test | Use `pnpm test:e2e -- e2e/specific.e2e-spec.ts`                   |

## Environment Variables

| Variable      | Purpose                                  | Default      |
| ------------- | ---------------------------------------- | ------------ |
| `CONVEX_PORT` | Backend API port (OS ephemeral if unset) | OS ephemeral |
| `E2E_PORT`    | Frontend port (OS ephemeral if unset)    | OS ephemeral |

Note: `CONVEX_URL` and `CONVEX_SITE_URL` are injected at runtime via `frontend/public/runtime-env.js` (not baked into the build). The harness generates this file with the ephemeral backend URLs.
| `PW_WORKERS` | Playwright workers per process | `1` |
| `SKIP_BACKEND_RESET` | Don't redeploy/clear (used by serve/run) | `false` |
